"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadStudyPlans, STUDY_PLANS_CHANGED_EVENT, STUDY_PLANS_STORAGE_KEY } from "@/lib/study-plans-storage";
import { formatLocalYmd, splitFocusIntoItems } from "@/lib/study-plan-loose-parse";
import { useStudyArena, type StudyArenaSessionOption } from "@/components/study-arena/StudyArenaProvider";
import { ParkingLotSessionReviewModal } from "@/components/study-arena/ParkingLotSessionReviewModal";
import {
  addParkingLotNote,
  formatParkingNoteTime,
  getParkingNotesForRun,
  PARKING_LOT_CHANGED_EVENT,
  type ParkingLotNote,
} from "@/lib/parking-lot-storage";
import {
  buildMicroTaskLabels,
  getCheckedTaskIndices,
  STUDY_MICROTASKS_CHANGED_EVENT,
  toggleMicroTaskChecked,
} from "@/lib/study-microtasks-storage";

function formatTimeRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDayLabel(ymd: string): string {
  const parts = ymd.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return ymd;
  const [y, m, d] = parts;
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  if (Number.isNaN(dt.getTime())) return ymd;
  return dt.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });
}

/** Ancho de la barra de focus: en 0 se mantiene un trozo visible (rojo). */
function focusScoreBarWidthPct(score: number): number {
  if (score <= 0) return 4;
  return Math.min(100, score);
}

/**
 * Color continuo verde → amarillo/naranja → rojo según baja el score.
 * Hue 120 = verde (100), ~45 naranja, 0 = rojo (0).
 */
function focusScoreBarStyles(score: number): { widthPct: number; backgroundColor: string } {
  const s = Math.max(0, Math.min(100, score));
  const widthPct = focusScoreBarWidthPct(s);
  const hue = Math.round((s / 100) * 120);
  return {
    widthPct,
    backgroundColor: `hsl(${hue} 82% 42%)`,
  };
}

function LockAppsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M17 11V8a5 5 0 10-10 0v3"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M7 11h10a2 2 0 012 2v7a2 2 0 01-2 2H7a2 2 0 01-2-2v-7a2 2 0 012-2z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path d="M12 15v3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function PauseIcon({ paused, className = "h-5 w-5" }: { paused: boolean; className?: string }) {
  return paused ? (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M10 8l8 4-8 4V8z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9 7v10M15 7v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function OuterProgressRing({
  progressPct,
  disabled,
}: {
  progressPct: number;
  disabled?: boolean;
}) {
  const r = 44;
  const cx = 50;
  const cy = 50;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, progressPct));
  const dash = (pct / 100) * c;
  const rest = c - dash;
  return (
    <svg className="absolute inset-0" viewBox="0 0 100 100" aria-hidden>
      <circle cx={cx} cy={cy} r={r} stroke="rgba(0,0,0,0.08)" strokeWidth="10" fill="none" />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        stroke="currentColor"
        strokeWidth="10"
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${rest}`}
        transform="rotate(-90 50 50)"
        className={disabled ? "opacity-60" : ""}
      />
    </svg>
  );
}

export function StudyArenaPanel() {
  const {
    activeSession,
    startSession,
    paused,
    togglePause,
    addDistraction,
    finalizeSession,
    timeRemainingMs,
    progressPct,
    focusScore,
    distractionCount,
  } = useStudyArena();

  const activeSessionKey = activeSession?.key ?? null;

  const todayYmd = useMemo(() => formatLocalYmd(new Date()), []);
  const [options, setOptions] = useState<StudyArenaSessionOption[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const [parkingDraft, setParkingDraft] = useState("");
  const [parkingReviewOpen, setParkingReviewOpen] = useState(false);
  const [parkingReviewNotes, setParkingReviewNotes] = useState<ParkingLotNote[]>([]);
  const [sessionRunParkingNotes, setSessionRunParkingNotes] = useState<ParkingLotNote[]>([]);

  const lastArenaRunIdRef = useRef<string | null>(null);
  const [checkedTasks, setCheckedTasks] = useState<Set<number>>(new Set());

  const microTaskLabels = useMemo(() => {
    if (!activeSession) return [];
    return buildMicroTaskLabels(activeSession.focus);
  }, [activeSession]);

  const checklistPct = useMemo(() => {
    if (microTaskLabels.length === 0) return 0;
    return Math.round((checkedTasks.size / microTaskLabels.length) * 100);
  }, [checkedTasks, microTaskLabels.length]);

  const focusScoreBar = useMemo(() => focusScoreBarStyles(focusScore), [focusScore]);

  const refreshChecked = useCallback(() => {
    if (!activeSessionKey) {
      setCheckedTasks(new Set());
      return;
    }
    setCheckedTasks(getCheckedTaskIndices(activeSessionKey));
  }, [activeSessionKey]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshChecked();
    window.addEventListener(STUDY_MICROTASKS_CHANGED_EVENT, refreshChecked);
    return () => window.removeEventListener(STUDY_MICROTASKS_CHANGED_EVENT, refreshChecked);
  }, [refreshChecked]);

  useEffect(() => {
    if (activeSession) {
      lastArenaRunIdRef.current = activeSession.arenaRunId;
    }
  }, [activeSession]);

  useEffect(() => {
    if (activeSession !== null) return;
    const runId = lastArenaRunIdRef.current;
    lastArenaRunIdRef.current = null;
    if (!runId) return;
    const notes = getParkingNotesForRun(runId);
    if (notes.length > 0) {
      setParkingReviewNotes(notes);
      setParkingReviewOpen(true);
    }
  }, [activeSession]);

  const refreshSessionRunNotes = useCallback(() => {
    if (!activeSession?.arenaRunId) {
      setSessionRunParkingNotes([]);
      return;
    }
    setSessionRunParkingNotes(getParkingNotesForRun(activeSession.arenaRunId));
  }, [activeSession]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshSessionRunNotes();
    window.addEventListener(PARKING_LOT_CHANGED_EVENT, refreshSessionRunNotes);
    return () => window.removeEventListener(PARKING_LOT_CHANGED_EVENT, refreshSessionRunNotes);
  }, [refreshSessionRunNotes]);

  useEffect(() => {
    function getTodayOptions(): StudyArenaSessionOption[] {
      const plans = loadStudyPlans();
      const out: StudyArenaSessionOption[] = [];
      for (const p of plans) {
        const saved = p.aiSchedule?.savedAt?.trim();
        if (!saved) continue;
        const days = p.aiSchedule?.days ?? [];
        for (const d of days) {
          if (!d?.date || d.date !== todayYmd) continue;
          const key = `${p.id}::${d.date}`;
          out.push({
            key,
            planId: p.id,
            planTitle: p.title,
            date: d.date,
            studyHours: d.studyHours,
            focus: d.focus ?? "",
            sessionTitle: d.sessionTitle,
          });
        }
      }
      return out;
    }

    function refresh() {
      const next = getTodayOptions();
      setOptions(next);
      setSelectedKey((cur) => {
        if (cur && next.some((o) => o.key === cur)) return cur;
        return next[0]?.key ?? null;
      });
    }

    refresh();
    window.addEventListener(STUDY_PLANS_CHANGED_EVENT, refresh);
    function onStorage(e: StorageEvent) {
      if (e.key === STUDY_PLANS_STORAGE_KEY) refresh();
    }
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(STUDY_PLANS_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, [todayYmd]);

  const selectedOption = useMemo(() => {
    if (!selectedKey) return null;
    return options.find((o) => o.key === selectedKey) ?? null;
  }, [options, selectedKey]);

  function submitParkingQuick() {
    if (!activeSessionKey || !activeSession) return;
    const raw = parkingDraft.replace(/\r\n/g, "\n");
    const lines = raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    for (const line of lines) {
      addParkingLotNote(line, {
        source: "session",
        sessionKey: activeSessionKey,
        arenaRunId: activeSession.arenaRunId,
      });
    }
    setParkingDraft("");
  }

  function onToggleTask(i: number, next: boolean) {
    if (!activeSessionKey) return;
    toggleMicroTaskChecked(activeSessionKey, i, next);
    refreshChecked();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ParkingLotSessionReviewModal
        open={parkingReviewOpen}
        notes={parkingReviewNotes}
        onClose={() => setParkingReviewOpen(false)}
      />

      <header className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-3 md:px-6 md:py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-[var(--ink)] sm:text-xl">Study Arena</h1>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">{formatDayLabel(todayYmd)}</p>
          </div>
          {activeSession ? (
            <div className="flex w-full max-w-full items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 sm:w-auto">
              <LockAppsIcon className="h-5 w-5 shrink-0 text-[var(--ink-muted)]" />
              <div className="min-w-0 text-[11px] font-semibold leading-snug text-[var(--ink-muted)]">
                Bloqueo apps (demo)
              </div>
            </div>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6">
        {!activeSession ? (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-4">
              <p className="text-sm font-semibold text-[var(--ink)]">Selecciona tu sesión de hoy</p>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                Solo aparecen las sesiones programadas para {todayYmd}.
              </p>
            </div>

            {options.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface-muted)] px-4 py-8 text-center">
                <p className="text-sm font-medium text-[var(--ink)]">No hay sesiones para hoy</p>
                <p className="mx-auto mt-1 max-w-[20rem] text-xs text-[var(--ink-muted)]">
                  Crea/guarda un plan en «Study Planner» y asegúrate de que incluya la fecha de hoy.
                </p>
              </div>
            ) : (
              <>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {options.map((o) => {
                    const isSelected = o.key === selectedKey;
                    const focusItems = splitFocusIntoItems(o.focus);
                    const summary = focusItems.slice(0, 2).join(" · ");
                    return (
                      <li key={o.key} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
                        <button
                          type="button"
                          onClick={() => setSelectedKey(o.key)}
                          className={`w-full rounded-2xl px-4 py-4 text-left transition hover:bg-[var(--surface-muted)] ${
                            isSelected ? "ring-2 ring-[var(--ink)]/30" : ""
                          }`}
                          aria-pressed={isSelected}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1 text-[11px] font-bold text-[var(--ink-muted)]">
                              {o.planTitle}
                            </span>
                            <span className="text-[11px] font-semibold text-[var(--ink-muted)]">
                              {Math.round(o.studyHours * 10) / 10}h
                            </span>
                          </div>
                          <div className="mt-2 truncate text-sm font-extrabold text-[var(--ink)]">
                            {o.sessionTitle?.trim() ? o.sessionTitle : "Sesión de estudio"}
                          </div>
                          {summary ? <div className="mt-1 line-clamp-2 text-xs text-[var(--ink-muted)]">{summary}</div> : null}
                          <div className="mt-3 flex items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold text-[var(--ink-muted)]">
                              {isSelected ? "Seleccionada" : "Seleccionar"}
                            </span>
                            <span className="text-[11px] text-[var(--ink-faint)]">→</span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>

                <div className="sticky bottom-0 -mx-3 px-3 pt-3 bg-gradient-to-t from-[var(--canvas)] to-transparent">
                  <button
                    type="button"
                    disabled={!selectedOption}
                    onClick={() => {
                      if (!selectedOption) return;
                      startSession(selectedOption);
                    }}
                    className="w-full rounded-2xl bg-[var(--ink)] px-4 py-3 text-sm font-extrabold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Empezar sesión
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-col gap-4">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1 text-[11px] font-bold text-[var(--ink-muted)]">
                      {activeSession.planTitle}
                    </span>
                    <span className="text-[11px] font-semibold text-[var(--ink-muted)]">{activeSession.date}</span>
                    <span className="text-[11px] font-semibold text-[var(--ink-muted)]">
                      {Math.round(activeSession.studyHours * 10) / 10}h
                    </span>
                  </div>
                  <div className="mt-2 truncate text-sm font-extrabold text-[var(--ink)]">
                    {activeSession.sessionTitle?.trim() ? activeSession.sessionTitle : "Sesión de estudio"}
                  </div>
                </div>
                <div className="shrink-0 text-left sm:text-right">
                  <div className="text-xs font-semibold text-[var(--ink-muted)]">Focus score</div>
                  <div className="text-lg font-extrabold tabular-nums">{focusScore}</div>
                </div>
              </div>

              <p className="mt-3 text-[11px] text-[var(--ink-faint)]">
                Cada distracción reduce el score; la barra pasa de verde a naranja y rojo.
              </p>
              <div
                className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-black/5 ring-1 ring-black/5"
                title="Focus score visual (cada distracción reduce el valor)"
                role="progressbar"
                aria-valuenow={focusScore}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full min-w-[4px] rounded-full transition-[width,background-color] duration-300 ease-out"
                  style={{
                    width: `${focusScoreBar.widthPct}%`,
                    backgroundColor: focusScoreBar.backgroundColor,
                  }}
                />
              </div>
            </div>

            <details
              open
              className="group rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-left">
                <div>
                  <div className="text-xs font-semibold text-[var(--ink-muted)]">Contenido de hoy</div>
                  <div className="text-sm font-extrabold text-[var(--ink)]">Plan y micro-tareas</div>
                </div>
                <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[11px] font-semibold text-[var(--ink-muted)] transition group-open:rotate-180">
                  ▾
                </span>
              </summary>
              <div className="space-y-4 border-t border-[var(--border)] px-4 py-4">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                    Micro-tareas (checklist)
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs text-[var(--ink-muted)]">
                    <span>Progreso micro-tareas</span>
                    <span className="font-bold tabular-nums">{checklistPct}%</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/5">
                    <div className="h-full bg-emerald-600/90 transition-[width]" style={{ width: `${checklistPct}%` }} />
                  </div>
                  <ul className="mt-3 space-y-2">
                    {microTaskLabels.map((label, i) => (
                      <li key={`${activeSession.key}-task-${i}`} className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          id={`microtask-${activeSession.key}-${i}`}
                          checked={checkedTasks.has(i)}
                          onChange={(e) => onToggleTask(i, e.target.checked)}
                          className="mt-1 h-4 w-4 shrink-0 rounded border-[var(--border)] text-[var(--ink)]"
                        />
                        <label
                          htmlFor={`microtask-${activeSession.key}-${i}`}
                          className={`flex-1 text-sm leading-snug ${
                            checkedTasks.has(i) ? "text-[var(--ink-muted)] line-through" : "text-[var(--ink)]"
                          }`}
                        >
                          {label}
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                    Texto del plan (referencia)
                  </div>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--ink)] marker:text-[var(--ink-muted)]">
                    {splitFocusIntoItems(activeSession.focus).map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </details>

            <div className="grid gap-4 lg:grid-cols-[1.2fr_1.2fr_0.9fr] lg:items-stretch">
              <div className="flex min-h-0 h-full min-w-0 flex-col">
                <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="shrink-0">
                    <div className="text-xs font-semibold text-[var(--ink-muted)]">Tiempo restante</div>
                    <div className="mt-2 text-3xl font-extrabold tabular-nums">{formatTimeRemaining(timeRemainingMs)}</div>
                  </div>

                  <div className="relative mt-5 flex min-h-0 flex-1 flex-col items-center justify-center">
                    <div className="relative mx-auto aspect-square w-full max-w-[min(18rem,calc(100vw-2rem))] shrink-0 text-[var(--ink)]">
                      <OuterProgressRing progressPct={progressPct} disabled={paused} />
                      <button
                        type="button"
                        onClick={togglePause}
                        className="absolute left-1/2 top-1/2 z-10 flex h-24 w-24 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[var(--ink)] transition hover:bg-black/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ink)] focus-visible:outline-offset-2 sm:h-28 sm:w-28 md:h-32 md:w-32"
                        aria-label={paused ? "Reanudar" : "Pausar"}
                      >
                        <PauseIcon paused={paused} className="h-14 w-14 sm:h-16 sm:w-16 md:h-20 md:w-20" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex min-h-0 h-full min-w-0 flex-col">
                <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)]">
                  <div className="shrink-0 border-b border-[var(--border)] px-4 py-3">
                    <div className="text-xs font-semibold text-[var(--ink-muted)]">Parking Lot</div>
                    <div className="text-sm font-extrabold text-[var(--ink)]">
                      Esta sesión
                      {sessionRunParkingNotes.length > 0 ? (
                        <span className="ml-2 rounded-full bg-[var(--surface)] px-2 py-0.5 text-[11px] font-bold tabular-nums text-[var(--ink-muted)]">
                          {sessionRunParkingNotes.length}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
                    <p className="text-xs text-[var(--ink-muted)]">
                      Captura ideas para luego (cada línea es una entrada). La lista global está en Notas; al terminar la
                      sesión verás un resumen si hubo notas.
                    </p>
                    <label className="block">
                      <span className="sr-only">Anotar idea para luego</span>
                      <textarea
                        value={parkingDraft}
                        onChange={(e) => setParkingDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            submitParkingQuick();
                          }
                        }}
                        rows={2}
                        placeholder="Anotar idea para luego… (Enter guarda, Mayús+Enter nueva línea)"
                        className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--ink)] focus:outline-none"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={submitParkingQuick}
                      disabled={!parkingDraft.trim()}
                      className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-bold text-[var(--ink)] transition hover:bg-[var(--canvas)] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Apuntar en Parking Lot
                    </button>
                    {sessionRunParkingNotes.length > 0 ? (
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                          Notas de esta ejecución
                        </div>
                        <ul className="mt-2 space-y-2 overflow-y-auto pr-1">
                          {sessionRunParkingNotes.map((n) => (
                            <li
                              key={n.id}
                              className="rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-xs leading-snug text-[var(--ink)]"
                            >
                              <p className="whitespace-pre-wrap">{n.text}</p>
                              <p className="mt-1 text-[10px] text-[var(--ink-faint)]">{formatParkingNoteTime(n.createdAt)}</p>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </section>
              </div>

              <div className="flex min-h-0 h-full min-w-0 flex-col gap-4">
                <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="text-xs font-semibold text-[var(--ink-muted)]">Acciones</div>
                  <div className="mt-3 flex min-h-0 flex-1 flex-col space-y-3">
                    <button
                      type="button"
                      onClick={finalizeSession}
                      className="w-full shrink-0 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-extrabold text-red-800 transition hover:bg-red-100"
                    >
                      Finalizar sesión
                    </button>
                    <div className="min-h-0 flex-1 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[11px] font-semibold text-[var(--ink-muted)]">Progreso tiempo</div>
                        <div className="text-[11px] font-bold tabular-nums text-[var(--ink-muted)]">
                          {Math.round(progressPct)}%
                        </div>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/5 ring-1 ring-black/5">
                        <div className="h-full bg-[var(--ink)]" style={{ width: `${progressPct}%` }} />
                      </div>
                      <p className="mt-2 text-xs text-[var(--ink-muted)]">
                        {paused ? "Reanuda para seguir contando el tiempo activo." : "Marca micro-tareas para notar avance real."}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="text-xs font-semibold text-[var(--ink-muted)]">Distracciones</div>
                  <p className="mt-1 text-[11px] text-[var(--ink-faint)]">Registra cuando pierdas el foco.</p>
                  <button
                    type="button"
                    onClick={addDistraction}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-3 text-sm font-bold text-[var(--ink)] shadow-sm transition hover:bg-[var(--canvas)] disabled:opacity-40"
                    aria-label="Registrar distracción"
                  >
                    <span>Registrar distracción</span>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-extrabold text-amber-900 tabular-nums">
                      {distractionCount}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
