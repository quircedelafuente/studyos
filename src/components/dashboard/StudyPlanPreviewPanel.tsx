"use client";

import type { StudyPlanAISchedule, StudyPlanDayEntry } from "@/types/dashboard";
import { formatLocalYmd, splitFocusIntoItems } from "@/lib/study-plan-loose-parse";

function formatDayLabel(iso: string): string {
  const parts = iso.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return iso;
  const [y, m, d] = parts;
  const date = new Date(y!, m! - 1, d!);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("es", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

function formatShortDate(iso: string): string {
  const parts = iso.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return iso;
  const [y, m, d] = parts;
  const date = new Date(y!, m! - 1, d!);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("es", { day: "numeric", month: "short" });
}

function addOneCalendarDayYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const next = new Date(y, m - 1, d + 1, 12, 0, 0, 0);
  return formatLocalYmd(next);
}

function emptySchedule(savedAt: string): StudyPlanAISchedule {
  return {
    totalHoursEstimated: null,
    methodNote: "",
    days: [],
    savedAt,
  };
}

function PlanDayCardReadOnly({
  day,
  maxHours,
  showDraftBadge,
}: {
  day: StudyPlanDayEntry;
  maxHours: number;
  showDraftBadge: boolean;
}) {
  const pct = Math.min(100, (day.studyHours / maxHours) * 100);
  const items = splitFocusIntoItems(day.focus);
  const titleLine = day.sessionTitle?.trim() || formatDayLabel(day.date);

  return (
    <li className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
      <div className="flex items-start justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-muted)]/60 px-3 py-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--ink-muted)]">
              {formatShortDate(day.date)}
            </p>
            {showDraftBadge ? (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-900">
                Borrador
              </span>
            ) : null}
          </div>
          <p className="text-xs font-semibold text-[var(--ink)]">{titleLine}</p>
          {day.sessionTitle?.trim() ? (
            <p className="text-[10px] capitalize text-[var(--ink-muted)]">{formatDayLabel(day.date)}</p>
          ) : null}
        </div>
        <span className="shrink-0 rounded-lg bg-[var(--ink)] px-2 py-1 text-xs font-bold tabular-nums text-white">
          {day.studyHours % 1 === 0 ? day.studyHours : day.studyHours.toFixed(1)} h
        </span>
      </div>
      <div className="px-3 py-2">
        <div
          className="h-1.5 overflow-hidden rounded-full bg-[var(--border)]"
          title={`${day.studyHours} h`}
        >
          <div
            className="h-full rounded-full bg-[var(--ink)]/85 transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-snug text-[var(--ink)] marker:text-[var(--ink-muted)]">
          {items.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </div>
    </li>
  );
}

function PlanDayCardEditable({
  day,
  index,
  maxHours,
  showDraftBadge,
  onPatch,
  onRemove,
}: {
  day: StudyPlanDayEntry;
  index: number;
  maxHours: number;
  showDraftBadge: boolean;
  onPatch: (patch: Partial<StudyPlanDayEntry>) => void;
  onRemove: () => void;
}) {
  const pct = Math.min(100, (day.studyHours / maxHours) * 100);

  return (
    <li className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
      <div className="space-y-2 border-b border-[var(--border)] bg-[var(--surface-muted)]/60 px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {showDraftBadge ? (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-900">
                Borrador
              </span>
            ) : null}
            <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--ink-muted)]">
              Sesión {index + 1}
            </span>
          </div>
          <button
            type="button"
            onClick={onRemove}
            className="shrink-0 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700 transition hover:bg-red-100"
          >
            Quitar día
          </button>
        </div>
        <label className="block">
          <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
            Título
          </span>
          <input
            type="text"
            value={day.sessionTitle ?? ""}
            onChange={(e) => onPatch({ sessionTitle: e.target.value })}
            placeholder="Ej. Repaso tema 3"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--canvas)] px-2 py-1.5 text-sm text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--ink)] focus:outline-none"
          />
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <label className="min-w-0 flex-1 sm:min-w-[8.5rem]">
            <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Fecha
            </span>
            <input
              type="date"
              value={
                typeof day.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day.date) ? day.date : ""
              }
              onChange={(e) => onPatch({ date: e.target.value })}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--canvas)] px-2 py-1.5 text-sm text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none"
            />
          </label>
          <label className="w-full sm:w-[6.5rem] sm:shrink-0">
            <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Horas
            </span>
            <input
              type="number"
              min={0.25}
              max={24}
              step={0.25}
              value={Number.isFinite(day.studyHours) ? day.studyHours : 2}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isFinite(v)) return;
                onPatch({ studyHours: Math.max(0.25, Math.min(24, v)) });
              }}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--canvas)] px-2 py-1.5 text-sm tabular-nums text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none"
            />
          </label>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-[var(--border)]"
          title={`${day.studyHours} h`}
        >
          <div
            className="h-full rounded-full bg-[var(--ink)]/85 transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="px-3 py-2">
        <label className="block">
          <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
            Contenido / tareas
          </span>
          <textarea
            value={day.focus}
            onChange={(e) => onPatch({ focus: e.target.value })}
            rows={4}
            placeholder="Bloques, temas, ejercicios… (puedes separar con punto y coma)"
            className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--canvas)] px-2 py-1.5 text-xs leading-relaxed text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--ink)] focus:outline-none"
          />
        </label>
      </div>
    </li>
  );
}

type Props = {
  schedule: StudyPlanAISchedule | null | undefined;
  planTitle: string;
  liveUpdating?: boolean;
  draftMode?: boolean;
  hasAssistantReply?: boolean;
  className?: string;
  /** Si se define, el panel permite editar título del plan, fechas, horas y contenido por sesión. */
  onScheduleChange?: (next: StudyPlanAISchedule) => void;
  onPlanTitleChange?: (title: string) => void;
};

export function StudyPlanPreviewPanel({
  schedule,
  planTitle,
  liveUpdating = false,
  draftMode = false,
  hasAssistantReply = false,
  className = "",
  onScheduleChange,
  onPlanTitleChange,
}: Props) {
  const editable = Boolean(onScheduleChange);
  const days = schedule?.days ?? [];
  const hasCalendarDays = days.length > 0;
  const maxHours = hasCalendarDays ? Math.max(...days.map((d) => d.studyHours), 0.25) : 1;
  const sumHours = hasCalendarDays ? days.reduce((s, d) => s + d.studyHours, 0) : 0;
  const isLiveDraft = draftMode && !schedule?.savedAt?.trim();
  const showDraftBadge = isLiveDraft;

  function pushSchedule(next: StudyPlanAISchedule) {
    onScheduleChange?.(next);
  }

  function patchDay(i: number, patch: Partial<StudyPlanDayEntry>) {
    if (!schedule || !onScheduleChange) return;
    const nextDays = schedule.days.map((d, j) => (j === i ? { ...d, ...patch } : d));
    pushSchedule({ ...schedule, days: nextDays });
  }

  function removeDay(i: number) {
    if (!schedule || !onScheduleChange) return;
    const nextDays = schedule.days.filter((_, j) => j !== i);
    pushSchedule({ ...schedule, days: nextDays });
  }

  function addDay() {
    const savedAt = schedule?.savedAt ?? "";
    const base = schedule ?? emptySchedule(savedAt);
    const last = base.days[base.days.length - 1];
    const nextDate = last ? addOneCalendarDayYmd(last.date) : formatLocalYmd(new Date());
    const nextDay: StudyPlanDayEntry = {
      date: nextDate,
      studyHours: 2,
      focus: "",
      sessionTitle: "",
    };
    pushSchedule({ ...base, days: [...base.days, nextDay] });
  }

  const showEmpty = !hasCalendarDays;

  return (
    <aside
      className={`flex min-h-0 flex-col bg-[var(--canvas)] ${className}`}
      aria-label="Vista previa del plan de estudio"
    >
      <div className="shrink-0 border-b border-[var(--border)] px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          {draftMode ? "Borrador del plan" : "Plan de estudio"}
        </p>
        {onPlanTitleChange ? (
          <label className="mt-1 block">
            <span className="sr-only">Nombre del plan</span>
            <input
              type="text"
              value={planTitle}
              onChange={(e) => onPlanTitleChange(e.target.value)}
              className="w-full truncate rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm font-semibold text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none"
            />
          </label>
        ) : (
          <h2 className="mt-0.5 truncate text-sm font-semibold text-[var(--ink)]" title={planTitle}>
            {planTitle}
          </h2>
        )}
        {liveUpdating ? (
          <p className="mt-1 text-[10px] text-[var(--ink-muted)]">Sincronizando con el chat…</p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {editable && showEmpty ? (
          <div className="mb-4 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-6 text-center">
            <p className="text-sm font-medium text-[var(--ink)]">Sin sesiones aún</p>
            <p className="mx-auto mt-1 max-w-[16rem] text-xs text-[var(--ink-muted)]">
              Añade días a mano o conversa con el asistente para rellenar el plan.
            </p>
            <button
              type="button"
              onClick={addDay}
              className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
            >
              Añadir sesión manualmente
            </button>
          </div>
        ) : null}

        {!hasCalendarDays && !editable ? (
          <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-8 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--surface-muted)] text-lg font-semibold text-[var(--ink-muted)]">
              ◈
            </div>
            {draftMode && hasAssistantReply && liveUpdating ? (
              <>
                <p className="text-sm font-medium text-[var(--ink)]">Generando tarjetas por día…</p>
                <p className="mx-auto mt-2 max-w-[18rem] text-xs leading-relaxed text-[var(--ink-muted)]">
                  Estamos extrayendo sesiones y duraciones del chat. En unos segundos verás un bloque
                  por cada día con el listado de tareas.
                </p>
              </>
            ) : draftMode && hasAssistantReply ? (
              <>
                <p className="text-sm font-medium text-[var(--ink)]">Sin días estructurados aún</p>
                <p className="mx-auto mt-2 max-w-[18rem] text-xs leading-relaxed text-[var(--ink-muted)]">
                  Pide al asistente un reparto <strong className="text-[var(--ink)]">día a día</strong>{" "}
                  (o con viñetas por día). Así podremos mostrar tarjetas con duración y tareas.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-[var(--ink)]">
                  {draftMode ? "Empieza el chat" : "Aún no hay plan"}
                </p>
                <p className="mx-auto mt-2 max-w-[18rem] text-xs leading-relaxed text-[var(--ink-muted)]">
                  {draftMode ? (
                    <>
                      Escribe a la izquierda: aquí aparecerá{" "}
                      <strong className="text-[var(--ink)]">una tarjeta por cada día</strong> de
                      estudio, con las horas y el listado de tareas. Cuando quieras fijarlo en la app,
                      usa <strong className="text-[var(--ink)]">Añadir plan al calendario</strong>.
                    </>
                  ) : (
                    <>Cuando el asistente proponga un plan por días, verás las tarjetas aquí.</>
                  )}
                </p>
              </>
            )}
          </div>
        ) : null}

        {hasCalendarDays ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-xs text-[var(--ink-muted)]">Horas totales (suma días)</span>
                <span className="text-lg font-semibold tabular-nums text-[var(--ink)]">
                  {sumHours % 1 === 0 ? sumHours : sumHours.toFixed(1)} h
                </span>
              </div>
              {schedule!.totalHoursEstimated != null ? (
                <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
                  Estimación IA: ~{schedule!.totalHoursEstimated} h
                </p>
              ) : null}
              {schedule!.methodNote?.trim() ? (
                <p className="mt-2 border-t border-[var(--border)] pt-2 text-xs leading-relaxed text-[var(--ink-muted)]">
                  {schedule!.methodNote}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                {draftMode ? "Sesiones por día" : "Calendario"} ({days.length}{" "}
                {days.length === 1 ? "día" : "días"})
              </p>
              {editable ? (
                <button
                  type="button"
                  onClick={addDay}
                  className="rounded-lg border border-[var(--border)] bg-[var(--canvas)] px-2 py-1 text-[10px] font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                >
                  + Añadir día
                </button>
              ) : null}
            </div>

            <ul className="space-y-3">
              {days.map((d, i) =>
                editable ? (
                  <PlanDayCardEditable
                    key={`${i}-${d.date}`}
                    day={d}
                    index={i}
                    maxHours={maxHours}
                    showDraftBadge={showDraftBadge}
                    onPatch={(patch) => patchDay(i, patch)}
                    onRemove={() => removeDay(i)}
                  />
                ) : (
                  <PlanDayCardReadOnly
                    key={`${d.date}-${i}`}
                    day={d}
                    maxHours={maxHours}
                    showDraftBadge={showDraftBadge}
                  />
                ),
              )}
            </ul>

            {schedule!.savedAt ? (
              <p className="text-[10px] text-[var(--ink-faint)]">
                Guardado en el plan{" "}
                {new Date(schedule!.savedAt).toLocaleString("es", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </p>
            ) : draftMode ? (
              <p className="text-[10px] text-[var(--ink-muted)]">
                Borrador: pulsa «Añadir plan al calendario» para guardarlo en «Exámenes y fechas».
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
