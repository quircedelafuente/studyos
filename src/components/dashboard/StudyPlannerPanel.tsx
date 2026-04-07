"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ImportantDeadline, StudyPlan } from "@/types/dashboard";
import {
  getGoogleEventColorStyle,
  normalizeGoogleEventColorId,
} from "@/lib/google-calendar-event-colors";
import {
  DEADLINES_CHANGED_EVENT,
  DEADLINES_STORAGE_KEY,
  loadImportantDeadlines,
  saveImportantDeadlines,
} from "@/lib/deadlines-storage";
import {
  loadStudyPlans,
  saveStudyPlans,
  STUDY_PLANS_CHANGED_EVENT,
  STUDY_PLANS_STORAGE_KEY,
} from "@/lib/study-plans-storage";
import { IconPlus, IconStudyPlanner } from "@/components/dashboard/icons";
import { StudyPlanChatView } from "@/components/dashboard/StudyPlanChatView";

function formatPlanDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDeadlineOptionLabel(d: ImportantDeadline): string {
  const parts = d.date.split("-").map(Number);
  const [y, m, day] = parts;
  const dt = y && m && day ? new Date(y, m - 1, day) : null;
  const dateStr =
    dt && !Number.isNaN(dt.getTime())
      ? dt.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })
      : d.date;
  return `${d.title} · ${dateStr}${d.time ? ` · ${d.time}` : ""}`;
}

function LinkedDeadlineColorDot({
  deadlineId,
  deadlines,
}: {
  deadlineId: string;
  deadlines: ImportantDeadline[];
}) {
  const dl = deadlines.find((d) => d.id === deadlineId);
  const cs = getGoogleEventColorStyle(normalizeGoogleEventColorId(dl?.calendarColorId));
  return (
    <span
      className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10"
      style={{ backgroundColor: cs.borderLeft }}
      title="Color del examen o fecha en calendario"
      aria-hidden
    />
  );
}

type StudyPlannerPanelProps = {
  /** Desde Exámenes y fechas: abre el modal «Nuevo plan» con este deadline preseleccionado. */
  navCreateDeadlineId?: string | null;
  /** Desde Exámenes y fechas: abre el chat de este plan. */
  navOpenPlanId?: string | null;
};

export function StudyPlannerPanel({
  navCreateDeadlineId = null,
  navOpenPlanId = null,
}: StudyPlannerPanelProps = {}) {
  const [plans, setPlans] = useState<StudyPlan[]>([]);
  const [deadlines, setDeadlines] = useState(() =>
    loadImportantDeadlines().filter((d) => !d.id.startsWith("study-")),
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newTargetDeadlineId, setNewTargetDeadlineId] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [chatPlanId, setChatPlanId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setPlans(loadStudyPlans());
  }, []);

  useEffect(() => {
    function bumpDeadlines() {
      setDeadlines(loadImportantDeadlines().filter((d) => !d.id.startsWith("study-")));
    }
    bumpDeadlines();
    window.addEventListener(DEADLINES_CHANGED_EVENT, bumpDeadlines);
    function onStorage(e: StorageEvent) {
      if (e.key === DEADLINES_STORAGE_KEY) bumpDeadlines();
    }
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(DEADLINES_CHANGED_EVENT, bumpDeadlines);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    refresh();
    function bump() {
      refresh();
    }
    window.addEventListener(STUDY_PLANS_CHANGED_EVENT, bump);
    function onStorage(e: StorageEvent) {
      if (e.key === STUDY_PLANS_STORAGE_KEY) bump();
    }
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(STUDY_PLANS_CHANGED_EVENT, bump);
      window.removeEventListener("storage", onStorage);
    };
  }, [refresh]);

  useEffect(() => {
    if (chatPlanId && !plans.some((p) => p.id === chatPlanId)) {
      setChatPlanId(null);
    }
  }, [chatPlanId, plans]);

  useEffect(() => {
    if (!navCreateDeadlineId) return;
    setChatPlanId(null);
    setNewTargetDeadlineId(navCreateDeadlineId);
    setNewTitle("");
    setCreateError(null);
    setCreateOpen(true);
  }, [navCreateDeadlineId]);

  useEffect(() => {
    if (!navOpenPlanId) return;
    setCreateOpen(false);
    setChatPlanId(navOpenPlanId);
  }, [navOpenPlanId]);

  const sortedPlans = useMemo(() => {
    return [...plans].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [plans]);

  const sortedDeadlines = useMemo(() => {
    return [...deadlines].sort((a, b) => {
      const c = a.date.localeCompare(b.date);
      if (c !== 0) return c;
      const ta = a.time ?? "";
      const tb = b.time ?? "";
      if (ta !== tb) return ta.localeCompare(tb);
      return a.title.localeCompare(b.title, "es");
    });
  }, [deadlines]);

  function openCreateModal() {
    setNewTitle("");
    setNewTargetDeadlineId("");
    setCreateError(null);
    setCreateOpen(true);
  }

  function closeCreateModal() {
    setCreateOpen(false);
    setNewTitle("");
    setNewTargetDeadlineId("");
    setCreateError(null);
  }

  function submitNewPlan() {
    const t = newTitle.trim();
    if (!t) {
      setCreateError("Escribe un nombre para el plan.");
      return;
    }
    if (sortedDeadlines.length === 0) {
      setCreateError(
        "Primero añade al menos un examen o fecha en la pestaña «Exámenes y fechas».",
      );
      return;
    }
    if (!newTargetDeadlineId.trim()) {
      setCreateError("Selecciona el evento para el que te preparas.");
      return;
    }
    const deadlineOk = loadImportantDeadlines().some(
      (d) => d.id === newTargetDeadlineId && !d.id.startsWith("study-"),
    );
    if (!deadlineOk) {
      setCreateError("El evento elegido ya no existe. Elige otro.");
      return;
    }
    const now = new Date().toISOString();
    const next: StudyPlan = {
      id: crypto.randomUUID(),
      title: t,
      createdAt: now,
      updatedAt: now,
      targetDeadlineId: newTargetDeadlineId,
    };
    saveStudyPlans([...loadStudyPlans(), next]);
    closeCreateModal();
    setChatPlanId(next.id);
  }

  function deletePlan(plan: StudyPlan) {
    if (
      !window.confirm(
        `¿Eliminar el plan «${plan.title}»? Se borrará el chat, el calendario IA del plan y las sesiones de estudio asociadas en «Exámenes y fechas».`,
      )
    ) {
      return;
    }
    const studyPrefix = `study-${plan.id}-`;
    const withoutPlanSessions = loadImportantDeadlines().filter(
      (d) => !d.id.startsWith(studyPrefix),
    );
    saveImportantDeadlines(withoutPlanSessions);
    saveStudyPlans(loadStudyPlans().filter((p) => p.id !== plan.id));
    refresh();
    if (chatPlanId === plan.id) setChatPlanId(null);
  }

  const chatPlan = chatPlanId ? plans.find((p) => p.id === chatPlanId) : undefined;

  if (chatPlanId && chatPlan) {
    return (
      <div className="flex min-h-0 flex-1 flex-col px-3 py-4 md:px-6 md:py-5">
        <StudyPlanChatView
          plan={chatPlan}
          onBack={() => setChatPlanId(null)}
          onPlansChanged={refresh}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 px-3 py-4 md:px-6 md:py-5">
      <header className="shrink-0 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-[var(--ink)] md:text-2xl">
            Study Planner
          </h1>
          <p className="max-w-2xl text-sm text-[var(--ink-muted)]">
            Cada plan debe ir ligado a un evento de{" "}
            <strong className="text-[var(--ink)]">Exámenes y fechas</strong>. Abre un plan para
            chatear con el asistente (Gemini vía OpenRouter) y planificar hasta esa fecha.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-xl bg-[var(--ink)] px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 sm:self-center"
        >
          <IconPlus className="h-5 w-5" />
          Crear plan de estudio
        </button>
      </header>

      <section className="min-h-0 flex-1">
        <h2 className="mb-3 text-sm font-semibold text-[var(--ink)]">Tus planes</h2>
        {sortedPlans.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center">
            <IconStudyPlanner className="mx-auto h-12 w-12 text-[var(--ink-faint)]" />
            <p className="mt-4 text-sm font-medium text-[var(--ink)]">Aún no hay planes</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-[var(--ink-muted)]">
              Pulsa <strong className="text-[var(--ink)]">Crear plan de estudio</strong> para añadir
              el primero.
            </p>
            <button
              type="button"
              onClick={openCreateModal}
              className="mt-6 inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-4 py-2 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
            >
              <IconPlus className="h-4 w-4" />
              Crear plan de estudio
            </button>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sortedPlans.map((p) => (
              <li
                key={p.id}
                className="flex min-w-0 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => setChatPlanId(p.id)}
                  className="flex min-w-0 flex-1 flex-col gap-1 p-4 text-left transition hover:bg-[var(--surface-muted)]"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {p.targetDeadlineId ? (
                      <LinkedDeadlineColorDot deadlineId={p.targetDeadlineId} deadlines={deadlines} />
                    ) : null}
                    <span className="min-w-0 truncate font-semibold text-[var(--ink)]">{p.title}</span>
                  </span>
                  <span className="text-xs text-[var(--ink-muted)]">
                    Actualizado {formatPlanDate(p.updatedAt)}
                    {p.aiSchedule?.days?.length ? ` · Plan IA (${p.aiSchedule.days.length} días)` : ""}
                  </span>
                  {p.targetDeadlineId ? (
                    <span className="line-clamp-2 text-[11px] text-[var(--ink-muted)]">
                      Objetivo:{" "}
                      {deadlines.find((d) => d.id === p.targetDeadlineId)?.title ??
                        "evento no encontrado"}
                    </span>
                  ) : null}
                  <span className="text-[11px] font-medium text-[var(--ink-muted)]">
                    Abrir asistente de planificación →
                  </span>
                </button>
                <div className="flex w-12 shrink-0 items-center justify-center border-l border-[var(--border)] bg-[var(--canvas)] sm:w-14">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      deletePlan(p);
                    }}
                    className="rounded-xl p-2.5 text-red-600 transition hover:bg-red-50"
                    title="Eliminar plan"
                    aria-label="Eliminar plan"
                  >
                    <svg
                      className="mx-auto h-5 w-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6" />
                    </svg>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {createOpen ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center">
          <button
            type="button"
            aria-label="Cerrar"
            className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
            onClick={closeCreateModal}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-plan-title"
            className="relative z-10 w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xl"
          >
            <div className="border-b border-[var(--border)] px-5 py-4">
              <h2 id="create-plan-title" className="text-lg font-bold text-[var(--ink)]">
                Nuevo plan de estudio
              </h2>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                Debes elegir un evento de «Exámenes y fechas» y un nombre para el plan.
              </p>
            </div>
            <div className="space-y-4 px-5 py-4">
              {createError ? (
                <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-800">
                  {createError}
                </p>
              ) : null}
              <div>
                <label
                  htmlFor="study-plan-target-deadline-new"
                  className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]"
                >
                  Evento <span className="text-red-600">*</span>
                </label>
                <select
                  id="study-plan-target-deadline-new"
                  value={newTargetDeadlineId}
                  onChange={(e) => setNewTargetDeadlineId(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submitNewPlan();
                    }
                  }}
                  required
                  autoFocus
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none"
                >
                  <option value="" disabled>
                    — Elige un examen o fecha —
                  </option>
                  {sortedDeadlines.map((d) => (
                    <option key={d.id} value={d.id}>
                      {formatDeadlineOptionLabel(d)}
                    </option>
                  ))}
                </select>
                {sortedDeadlines.length === 0 ? (
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    No hay eventos. Añade uno en la pestaña{" "}
                    <strong className="text-[var(--ink)]">Exámenes y fechas</strong>.
                  </p>
                ) : null}
              </div>
              <div>
                <label
                  htmlFor="study-plan-title"
                  className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]"
                >
                  Nombre del plan
                </label>
                <input
                  id="study-plan-title"
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submitNewPlan();
                    }
                  }}
                  placeholder="Ej. Parciales mayo, Repaso Q2…"
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--ink)] focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeCreateModal}
                  className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={submitNewPlan}
                  disabled={sortedDeadlines.length === 0}
                  className="rounded-xl bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Crear
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
