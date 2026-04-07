"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type {
  ImportantDeadline,
  StudyPlan,
  StudyPlanAISchedule,
  StudyPlanChatTurn,
} from "@/types/dashboard";
import { loadStudyPlans, patchStudyPlan } from "@/lib/study-plans-storage";
import {
  DEADLINES_CHANGED_EVENT,
  DEADLINES_STORAGE_KEY,
  loadImportantDeadlines,
  saveImportantDeadlines,
} from "@/lib/deadlines-storage";
import { MarkdownMathContent } from "@/components/dashboard/MarkdownMathContent";
import { StudyPlanPreviewPanel } from "@/components/dashboard/StudyPlanPreviewPanel";
import {
  countSpanishStudyDayBlocks,
  formatLocalYmd,
  parseLooseDaysFromAssistant,
  splitFocusIntoItems,
} from "@/lib/study-plan-loose-parse";
import {
  alignScheduleDaysToStartHint,
  inferPreferredStartYmdFromConversation,
} from "@/lib/study-plan-start-date";

type Props = {
  plan: StudyPlan;
  onBack: () => void;
  onPlansChanged: () => void;
};

function sanitizeAiSchedule(s: StudyPlanAISchedule): StudyPlanAISchedule {
  return {
    ...s,
    savedAt: typeof s.savedAt === "string" ? s.savedAt : "",
    methodNote: typeof s.methodNote === "string" ? s.methodNote : "",
    totalHoursEstimated: s.totalHoursEstimated ?? null,
    days: s.days.map((d) => {
      const dateOk = typeof d.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.date);
      const date = dateOk ? d.date : formatLocalYmd(new Date());
      const h = Number(d.studyHours);
      const studyHours = Number.isFinite(h) ? Math.max(0.25, Math.min(24, h)) : 2;
      const focus = typeof d.focus === "string" ? d.focus : "";
      const st = typeof d.sessionTitle === "string" ? d.sessionTitle.trim() : "";
      return {
        date,
        studyHours,
        focus,
        ...(st ? { sessionTitle: st } : {}),
      };
    }),
  };
}

function formatDeadlineSelectLabel(d: ImportantDeadline): string {
  const parts = d.date.split("-").map(Number);
  const [y, m, day] = parts;
  const dt = y && m && day ? new Date(y, m - 1, day) : null;
  const dateStr =
    dt && !Number.isNaN(dt.getTime())
      ? dt.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })
      : d.date;
  const timeStr = d.time ? ` · ${d.time}` : "";
  return `${d.title} · ${dateStr}${timeStr}`;
}

/** Días enteros entre hoy (local) y la fecha YYYY-MM-DD (local); negativo si ya pasó. */
function calendarDaysUntilYmd(ymd: string): number | null {
  const parts = ymd.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [y, m, d] = parts;
  const eventDay = new Date(y!, m! - 1, d!);
  if (Number.isNaN(eventDay.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((eventDay.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

function mergeExtractWithFallback(
  extracted: StudyPlanAISchedule | null,
  turns: StudyPlanChatTurn[],
  todayYmd: string,
  examYmd: string | null | undefined,
): StudyPlanAISchedule | null {
  const startHint = inferPreferredStartYmdFromConversation(turns, todayYmd, examYmd ?? null);

  /** Solo corrige JSON del modelo; el parser del texto del chat no necesita alineación por hint. */
  const applyAlignIfFromApi = (s: StudyPlanAISchedule): StudyPlanAISchedule => {
    if (!s.days?.length || !startHint) return s;
    return {
      ...s,
      days: alignScheduleDaysToStartHint(s.days, startHint, examYmd ?? null),
    };
  };

  const lastAssistant = [...turns].reverse().find((m) => m.role === "model");
  const lastText = lastAssistant?.content?.trim() ?? "";
  const loose =
    lastText && todayYmd
      ? parseLooseDaysFromAssistant(
          lastText,
          todayYmd,
          examYmd ?? undefined,
          startHint,
        )
      : [];

  const spanishStudyDays = lastText ? countSpanishStudyDayBlocks(lastText) : 0;
  /**
   * Si el coach usa "Domingo, 06 de abril de 2026 (2.5 horas)" por día, el borrador debe seguir
   * ese texto (una tarjeta por cabecera). El JSON del extractor a menudo fusiona días: lo ignoramos aquí.
   */
  const preferLooseFromChat = loose.length > 0 && spanishStudyDays > 0;

  if (extracted) {
    const days = extracted.days ?? [];
    if (days.length > 0 && !preferLooseFromChat) {
      return applyAlignIfFromApi({ ...extracted, days, savedAt: extracted.savedAt || "" });
    }
    if (loose.length > 0) {
      return {
        ...extracted,
        days: loose,
        methodNote: extracted.methodNote ?? "",
        savedAt: extracted.savedAt || "",
      };
    }
    return { ...extracted, days: [], savedAt: extracted.savedAt || "" };
  }

  if (loose.length > 0) {
    return {
      totalHoursEstimated: null,
      methodNote: "",
      days: loose,
      savedAt: "",
    };
  }
  return null;
}

function ChevronLeft({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

export function StudyPlanChatView({ plan, onBack, onPlansChanged }: Props) {
  // Referencia estable al array inicial de mensajes para que el useEffect de extracción
  // pueda distinguir "mismo array del mount" de "nuevo mensaje añadido".
  const initialMessages = plan.chatMessages ?? [];
  const [messages, setMessages] = useState<StudyPlanChatTurn[]>(initialMessages);
  const [planTitleDraft, setPlanTitleDraft] = useState(plan.title);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [previewUpdating, setPreviewUpdating] = useState(false);
  const [previewSchedule, setPreviewSchedule] = useState<StudyPlanAISchedule | null>(() =>
    plan.aiSchedule ? sanitizeAiSchedule(plan.aiSchedule) : null,
  );
  const [deadlines, setDeadlines] = useState<ImportantDeadline[]>(() => loadImportantDeadlines());
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  /** Evita que respuestas antiguas de extract sobrescriban un borrador más reciente. */
  const previewExtractGenerationRef = useRef(0);
  /**
   * Snapshot del array `messages` en el momento del último guardado ("Añadir/Actualizar calendario")
   * o, si el plan ya tiene savedAt al montar, el array inicial de mensajes.
   * Si el useEffect de extracción se dispara con la misma referencia de array (sin mensajes nuevos),
   * es un re-run por cambio de deps indirecto y no debe sobreescribir las ediciones manuales.
   * Se inicializa con `initialMessages` cuando el plan ya está guardado (savedAt no vacío)
   * para que el primer useEffect del mount también salte la extracción.
   */
  const messagesRefAtLastSave = useRef<StudyPlanChatTurn[]>(
    plan.aiSchedule?.savedAt?.trim() ? initialMessages : [],
  );

  useEffect(() => {
    function loadD() {
      setDeadlines(loadImportantDeadlines());
    }
    loadD();
    window.addEventListener(DEADLINES_CHANGED_EVENT, loadD);
    function onStorage(e: StorageEvent) {
      if (e.key === DEADLINES_STORAGE_KEY) loadD();
    }
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(DEADLINES_CHANGED_EVENT, loadD);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    setMessages(plan.chatMessages ?? []);
    setPlanTitleDraft(plan.title);
    setPreviewSchedule(plan.aiSchedule ? sanitizeAiSchedule(plan.aiSchedule) : null);
    // Solo plan.id: tras patchStudyPlan el padre refresca y `plan` trae referencias nuevas; depender de
    // plan.title / plan.aiSchedule / plan.chatMessages pisa el estado local y los inputs controlados fallan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id]);

  const selectedDeadline = useMemo(() => {
    const id = plan.targetDeadlineId;
    if (!id) return null;
    return deadlines.find((d) => d.id === id) ?? null;
  }, [deadlines, plan.targetDeadlineId]);

  const studyCalendarPrefix = useMemo(() => `study-${plan.id}-`, [plan.id]);
  const hasStudyBlocksOnCalendar = useMemo(
    () => deadlines.some((d) => d.id.startsWith(studyCalendarPrefix)),
    [deadlines, studyCalendarPrefix],
  );
  const calendarLinkedSaved = Boolean(previewSchedule?.savedAt?.trim());
  const showRemoveCalendarButton = calendarLinkedSaved || hasStudyBlocksOnCalendar;

  const targetEventPayload = useMemo(() => {
    if (!selectedDeadline) return undefined;
    return {
      id: selectedDeadline.id,
      title: selectedDeadline.title,
      date: selectedDeadline.date,
      time: selectedDeadline.time,
    };
  }, [selectedDeadline]);

  const deadlinePlazoLine = useMemo(() => {
    if (!selectedDeadline) return null;
    const n = calendarDaysUntilYmd(selectedDeadline.date);
    if (n === null) return null;
    if (n < 0) return `Plazo: la fecha del evento ya pasó (${Math.abs(n)} día(s)).`;
    if (n === 0) return "Plazo: hoy es el día del examen o entrega.";
    return `Plazo: faltan ${n} día(s) calendario hasta el día del evento.`;
  }, [selectedDeadline]);

  const todayLocalYmd = useMemo(() => formatLocalYmd(new Date()), []);
  /** Estabilizado como string constante para evitar cambios de tamaño en el array de deps de useEffect. */
  const examYmd = selectedDeadline?.date ?? null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const persistMessages = useCallback(
    (next: StudyPlanChatTurn[]) => {
      patchStudyPlan(plan.id, {
        chatMessages: next,
        updatedAt: new Date().toISOString(),
      });
      onPlansChanged();
    },
    [plan.id, onPlansChanged],
  );

  const extractScheduleFromMessages = useCallback(
    async (turns: StudyPlanChatTurn[], forPersist: boolean): Promise<StudyPlanAISchedule | null> => {
      if (turns.length === 0) return null;
      const startHint = inferPreferredStartYmdFromConversation(turns, todayLocalYmd, examYmd);
      const res = await fetch("/api/study-planner/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "extract_schedule",
          planTitle: plan.title,
          messages: turns.map((m) => ({ role: m.role, content: m.content })),
          targetEvent: targetEventPayload,
          todayLocal: todayLocalYmd,
          ...(startHint ? { startDateHint: startHint } : {}),
        }),
      });
      const data = (await res.json()) as {
        schedule?: StudyPlanAISchedule;
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        throw new Error(data.detail ?? data.error ?? "No se pudo extraer el plan");
      }
      const s = data.schedule;
      if (!s || typeof s !== "object") return null;
      const days = Array.isArray(s.days) ? s.days : [];
      return {
        totalHoursEstimated:
          typeof s.totalHoursEstimated === "number" || s.totalHoursEstimated === null
            ? s.totalHoursEstimated
            : null,
        methodNote: typeof s.methodNote === "string" ? s.methodNote : "",
        days,
        savedAt: forPersist ? new Date().toISOString() : "",
      };
    },
    [plan.title, targetEventPayload, todayLocalYmd, examYmd],
  );

  useEffect(() => {
    const hasAssistant = messages.some((m) => m.role === "model");
    // `extracting` no va en las deps: si cambia (p.ej. tras guardar) sin que haya un mensaje nuevo,
    // el efecto no debe re-ejecutarse y sobreescribir los días con el parse anterior del chat.
    if (!hasAssistant || sending) return;
    // Si el efecto se disparó pero `messages` es la misma referencia que había cuando el usuario
    // guardó manualmente, significa que no llegó ningún mensaje nuevo — el re-run lo provocó un cambio
    // de deps indirecto (deadlines → targetEventPayload → extractScheduleFromMessages).
    // En ese caso no sobreescribimos las ediciones manuales del widget.
    if (messages === messagesRefAtLastSave.current) return;
    const fb = mergeExtractWithFallback(null, messages, todayLocalYmd, examYmd);
    if (fb) {
      setPreviewSchedule((prev) => {
        // Siempre seguimos al chat, pero conservamos el savedAt del plan ya fijado.
        const keepSaved = prev?.savedAt?.trim() ? prev.savedAt : "";
        if (fb.days.length > 0) return { ...fb, savedAt: keepSaved };
        if (prev && prev.days.length > 0) return prev;
        return { ...fb, savedAt: keepSaved };
      });
    }

    const timeout = window.setTimeout(async () => {
      const myGen = ++previewExtractGenerationRef.current;
      setPreviewUpdating(true);
      try {
        const raw = await extractScheduleFromMessages(messages, false);
        if (myGen !== previewExtractGenerationRef.current) return;
        const schedule = mergeExtractWithFallback(raw, messages, todayLocalYmd, examYmd);
        if (schedule) {
          setPreviewSchedule((prev) => {
            const keepSaved = prev?.savedAt?.trim() ? prev.savedAt : "";
            return { ...schedule, savedAt: keepSaved };
          });
        }
      } catch {
        if (myGen === previewExtractGenerationRef.current) {
          const fallbackOnly = mergeExtractWithFallback(
            null,
            messages,
            todayLocalYmd,
            examYmd,
          );
          if (fallbackOnly) {
            setPreviewSchedule((prev) => {
              const keepSaved = prev?.savedAt?.trim() ? prev.savedAt : "";
              return { ...fallbackOnly, savedAt: keepSaved };
            });
          }
        }
      } finally {
        if (myGen === previewExtractGenerationRef.current) {
          setPreviewUpdating(false);
        }
      }
    }, 420);
    return () => window.clearTimeout(timeout);
  }, [messages, sending, extractScheduleFromMessages, todayLocalYmd, examYmd]);

  const handleScheduleChange = useCallback(
    (next: StudyPlanAISchedule) => {
      const clean = sanitizeAiSchedule(next);
      setPreviewSchedule(clean);
      patchStudyPlan(plan.id, {
        aiSchedule: clean,
        updatedAt: new Date().toISOString(),
      });
      // If the plan was already saved to calendar (savedAt set), keep calendar
      // in sync: remove deadline entries for days that no longer exist.
      if (clean.savedAt?.trim()) {
        const studyPrefix = `study-${plan.id}-`;
        const validDates = new Set((clean.days ?? []).map((d) => d.date));
        const allDeadlines = loadImportantDeadlines();
        const synced = allDeadlines.filter((d) => {
          if (!d.id.startsWith(studyPrefix)) return true;
          return validDates.has(d.id.slice(studyPrefix.length));
        });
        if (synced.length !== allDeadlines.length) {
          saveImportantDeadlines(synced);
        }
      }
      onPlansChanged();
    },
    [plan.id, onPlansChanged],
  );

  const handlePlanTitleChange = useCallback(
    (title: string) => {
      setPlanTitleDraft(title);
      const trimmed = title.trim();
      patchStudyPlan(plan.id, {
        title: trimmed || "(Sin título)",
        updatedAt: new Date().toISOString(),
      });
      onPlansChanged();
    },
    [plan.id, onPlansChanged],
  );

  const addScheduleToCalendar = useCallback(
    (schedule: StudyPlanAISchedule) => {
      const now = new Date().toISOString();
      const studyPrefix = `study-${plan.id}-`;
      const all = loadImportantDeadlines();

      // Index existing study-session deadlines by id so we can preserve any
      // manual time / duration adjustments the user made in the calendar.
      const existingById = new Map(
        all.filter((d) => d.id.startsWith(studyPrefix)).map((d) => [d.id, d]),
      );
      const prev = all.filter((d) => !d.id.startsWith(studyPrefix));

      const newItems: ImportantDeadline[] = [];
      const planLabel = planTitleDraft.trim() || plan.title;
      const inheritedColorId = selectedDeadline?.calendarColorId ?? "10";

      for (const day of schedule.days) {
        const focusItems = splitFocusIntoItems(day.focus);
        const summary = focusItems.join(" · ").slice(0, 160);
        const durationMinutes = Math.round(day.studyHours * 60);
        const id = `${studyPrefix}${day.date}`;
        const sessionHead = day.sessionTitle?.trim()
          ? `${day.sessionTitle.trim()}: `
          : "";
        const title = `📚 ${planLabel}: ${sessionHead}${summary || `${day.studyHours}h`}`;

        // Preserve time and duration if the user already moved/resized this session.
        const existing = existingById.get(id);
        newItems.push({
          id,
          title: title.slice(0, 200),
          date: existing?.date ?? day.date,
          time: existing?.time ?? "09:00",
          durationMinutes: Math.max(30, durationMinutes),
          courseId: null,
          tagIds: existing?.tagIds ?? [],
          calendarColorId: inheritedColorId,
          createdAt: existing?.createdAt ?? now,
        });
      }

      const merged = [...prev, ...newItems].sort((a, b) => a.date.localeCompare(b.date));
      saveImportantDeadlines(merged);
    },
    [plan.id, plan.title, planTitleDraft, selectedDeadline?.calendarColorId],
  );

  const removeScheduleFromCalendar = useCallback(() => {
    const studyPrefix = `study-${plan.id}-`;
    const remaining = loadImportantDeadlines().filter((d) => !d.id.startsWith(studyPrefix));
    saveImportantDeadlines(remaining);
  }, [plan.id]);

  async function sendUserMessage() {
    const text = draft.trim();
    if (!text || sending) return;
    setError(null);
    const userTurn: StudyPlanChatTurn = {
      role: "user",
      content: text,
      at: new Date().toISOString(),
    };
    const previous = messages;
    const history = [...messages, userTurn];
    setMessages(history);
    setDraft("");
    setSending(true);
    try {
      const res = await fetch("/api/study-planner/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat",
          planTitle: plan.title,
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          targetEvent: targetEventPayload,
        }),
      });
      const data = (await res.json()) as { text?: string; error?: string; detail?: string };
      if (!res.ok) {
        throw new Error(data.detail ?? data.error ?? "No se pudo obtener respuesta");
      }
      const assistantText = data.text?.trim() ?? "";
      if (!assistantText) throw new Error("Respuesta vacía");
      const modelTurn: StudyPlanChatTurn = {
        role: "model",
        content: assistantText,
        at: new Date().toISOString(),
      };
      const full = [...history, modelTurn];
      setMessages(full);
      persistMessages(full);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
      setMessages(previous);
    } finally {
      setSending(false);
    }
  }

  async function saveScheduleToApp() {
    if (extracting) return;
    const schedule = previewSchedule;
    if (!schedule?.days?.length) {
      setError("Aún no hay un plan con días en el borrador. Sigue conversando para que aparezca.");
      return;
    }
    setError(null);
    setExtracting(true);
    try {
      const normalized: StudyPlanAISchedule = {
        ...schedule,
        savedAt: new Date().toISOString(),
      };
      patchStudyPlan(plan.id, {
        aiSchedule: normalized,
        updatedAt: new Date().toISOString(),
      });
      addScheduleToCalendar(normalized);
      /** Invalida extract en vuelo para que no pise `savedAt` al reabrir el efecto. */
      previewExtractGenerationRef.current += 1;
      /** Guarda el snapshot de messages actual: el useEffect de extracción lo usará para detectar
       * re-runs provocados por cambios de deps (no por mensajes nuevos) y saltar sin sobreescribir. */
      messagesRefAtLastSave.current = messages;
      const clean = sanitizeAiSchedule(normalized);
      /** Sin flushSync: al hacer `setExtracting(false)` el efecto de extracción corre en el mismo tick
       * y el `setPreviewSchedule` del efecto puede ver un `prev` sin `savedAt` todavía → el widget
       * sigue como borrador aunque el calendario ya esté bien. */
      flushSync(() => {
        setPreviewSchedule(clean);
        setExtracting(false);
      });
      onPlansChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar el plan");
      flushSync(() => {
        setExtracting(false);
      });
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-3 md:px-6">
        <div className="flex flex-wrap items-center gap-2 gap-y-2">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1.5 text-sm font-medium text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
          >
            <ChevronLeft className="h-4 w-4" />
            Planes
          </button>
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="min-w-0 max-w-full shrink truncate text-base font-semibold text-[var(--ink)] md:text-lg">
              {planTitleDraft.trim() || plan.title}
            </h1>
            {selectedDeadline ? (
              <span
                className="min-w-0 max-w-full shrink text-sm font-medium text-[var(--ink-muted)] md:text-base"
                title={formatDeadlineSelectLabel(selectedDeadline)}
              >
                {formatDeadlineSelectLabel(selectedDeadline)}
              </span>
            ) : plan.targetDeadlineId ? (
              <span className="text-sm text-amber-800">Evento no encontrado en «Exámenes y fechas»</span>
            ) : null}
          </div>
        </div>
        {deadlinePlazoLine ? (
          <p className="mt-1.5 text-[11px] font-medium text-[var(--ink-muted)]">{deadlinePlazoLine}</p>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4 md:px-6">
            {messages.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-6 text-center text-sm text-[var(--ink-muted)]">
                Primer mensaje: pega el contenido del examen (temario, sesiones, PDF…), las horas totales
                (ej. 15 h) y la fecha en que empiezas a estudiar. El examen queda fijado por el evento de
                arriba.
              </p>
            ) : null}
            {messages.map((m, i) => (
              <div
                key={`${m.at}-${i}`}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[min(100%,42rem)] rounded-2xl px-4 py-2.5 text-sm ${
                    m.role === "user"
                      ? "bg-[var(--ink)] text-white"
                      : "border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)]"
                  }`}
                >
                  {m.role === "model" ? (
                    <MarkdownMathContent
                      content={m.content}
                      compact
                      className="prose prose-sm max-w-none"
                    />
                  ) : (
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  )}
                </div>
              </div>
            ))}
            {sending ? (
              <div className="flex justify-start">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm text-[var(--ink-muted)]">
                  Pensando…
                </div>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>

          {error ? (
            <div className="shrink-0 border-t border-red-200/80 bg-red-50/90 px-3 py-2 text-sm text-red-900 md:px-6">
              {error}
            </div>
          ) : null}

          <div className="shrink-0 space-y-2 border-t border-[var(--border)] bg-[var(--surface)] p-3 md:px-6 md:py-4">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={saveScheduleToApp}
                disabled={!previewSchedule?.days?.length || extracting || sending}
                className="rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {extracting
                  ? "Añadiendo…"
                  : calendarLinkedSaved
                    ? "Actualizar calendario"
                    : "Añadir plan al calendario"}
              </button>
              {showRemoveCalendarButton ? (
                <button
                  type="button"
                  onClick={() => {
                    removeScheduleFromCalendar();
                    const diskPlan = loadStudyPlans().find((sp) => sp.id === plan.id);
                    const source = previewSchedule ?? diskPlan?.aiSchedule;
                    if (source) {
                      const cleared: StudyPlanAISchedule = { ...source, savedAt: "" };
                      setPreviewSchedule(cleared.days?.length ? cleared : null);
                      patchStudyPlan(plan.id, {
                        aiSchedule: cleared,
                        updatedAt: new Date().toISOString(),
                      });
                    }
                    onPlansChanged();
                  }}
                  disabled={extracting || sending}
                  className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Borrar del calendario
                </button>
              ) : null}
            </div>
            <div className="flex gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendUserMessage();
                  }
                }}
                placeholder="Escribe tu mensaje… (Enter envía, Mayús+Enter salto)"
                rows={3}
                disabled={sending}
                className="min-h-[4.5rem] flex-1 resize-y rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--ink)] focus:outline-none disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => void sendUserMessage()}
                disabled={!draft.trim() || sending}
                className="self-end rounded-xl bg-[var(--ink)] px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Enviar
              </button>
            </div>
          </div>
        </div>

        <StudyPlanPreviewPanel
          schedule={previewSchedule}
          planTitle={planTitleDraft}
          draftMode
          liveUpdating={previewUpdating}
          hasAssistantReply={messages.some((m) => m.role === "model")}
          onScheduleChange={handleScheduleChange}
          onPlanTitleChange={handlePlanTitleChange}
          className="max-h-[min(46vh,22rem)] w-full border-t border-[var(--border)] lg:max-h-none lg:min-h-0 lg:w-[min(100%,380px)] lg:shrink-0 xl:w-[min(100%,420px)] lg:border-l lg:border-t-0"
        />
      </div>
    </div>
  );
}
