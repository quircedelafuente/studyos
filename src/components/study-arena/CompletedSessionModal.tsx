"use client";

import { useEffect, useMemo, useRef } from "react";
import { type CompletedSession } from "@/lib/study-arena-completed-storage";
import { getParkingNotesForRun, formatParkingNoteTime, type ParkingLotNote } from "@/lib/parking-lot-storage";
import { splitFocusIntoItems } from "@/lib/study-plan-loose-parse";
import { type StudyArenaSessionOption } from "@/components/study-arena/StudyArenaProvider";

function formatMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}min`;
  if (m > 0) return `${m}min ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function formatCompletedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function focusScoreBarStyles(score: number): { widthPct: number; backgroundColor: string } {
  const s = Math.max(0, Math.min(100, score));
  const widthPct = s <= 0 ? 4 : Math.min(100, s);
  const hue = Math.round((s / 100) * 120);
  return { widthPct, backgroundColor: `hsl(${hue} 82% 42%)` };
}

function focusScoreLabel(score: number): string {
  if (score >= 90) return "Excelente";
  if (score >= 70) return "Bueno";
  if (score >= 50) return "Regular";
  if (score >= 30) return "Bajo";
  return "Muy bajo";
}

type Props = {
  session: CompletedSession | null;
  onClose: () => void;
  onRedo: (option: StudyArenaSessionOption) => void;
};

export function CompletedSessionModal({ session, onClose, onRedo }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);

  const parkingNotes: ParkingLotNote[] = useMemo(() => {
    if (!session) return [];
    return getParkingNotesForRun(session.arenaRunId);
  }, [session]);

  const focusItems = useMemo(() => {
    if (!session) return [];
    return splitFocusIntoItems(session.focus);
  }, [session]);

  const focusBar = useMemo(() => {
    if (!session) return { widthPct: 0, backgroundColor: "" };
    return focusScoreBarStyles(session.focusScore);
  }, [session]);

  const completionPct = useMemo(() => {
    if (!session) return 0;
    return Math.min(100, Math.round((session.elapsedActiveMs / Math.max(1, session.totalDurationMs)) * 100));
  }, [session]);

  useEffect(() => {
    if (!session) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session, onClose]);

  if (!session) return null;

  const sessionTitle = session.sessionTitle?.trim() || "Sesión de estudio";

  function handleRedo() {
    if (!session) return;
    const option: StudyArenaSessionOption = {
      key: session.key,
      planId: session.planId,
      planTitle: session.planTitle,
      date: session.date,
      studyHours: session.studyHours,
      focus: session.focus,
      sessionTitle: session.sessionTitle,
    };
    onRedo(option);
    onClose();
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 backdrop-blur-sm sm:items-center"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--canvas)] shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-0.5 text-[11px] font-bold text-[var(--ink-muted)]">
                {session.planTitle}
              </span>
              <span className="text-[11px] text-[var(--ink-faint)]">{formatCompletedAt(session.completedAt)}</span>
            </div>
            <h2 className="mt-1 truncate text-base font-extrabold text-[var(--ink)]">{sessionTitle}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-xl p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
            aria-label="Cerrar"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Focus score */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-[var(--ink-muted)]">Focus Score</div>
                <div className="mt-0.5 text-3xl font-extrabold tabular-nums text-[var(--ink)]">
                  {session.focusScore}
                  <span className="ml-1 text-sm font-semibold text-[var(--ink-muted)]">/ 100</span>
                </div>
                <div className="mt-0.5 text-xs font-semibold text-[var(--ink-muted)]">
                  {focusScoreLabel(session.focusScore)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs font-semibold text-[var(--ink-muted)]">Distracciones</div>
                <div className="mt-0.5 text-2xl font-extrabold tabular-nums text-[var(--ink)]">
                  {session.distractionCount}
                </div>
              </div>
            </div>
            <div
              className="mt-3 h-2.5 overflow-hidden rounded-full bg-black/5 ring-1 ring-black/5"
              role="progressbar"
              aria-valuenow={session.focusScore}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full min-w-[4px] rounded-full transition-[width]"
                style={{ width: `${focusBar.widthPct}%`, backgroundColor: focusBar.backgroundColor }}
              />
            </div>
          </div>

          {/* Time metrics */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="text-[11px] font-semibold text-[var(--ink-muted)]">Tiempo estudiado</div>
              <div className="mt-1 text-lg font-extrabold tabular-nums text-[var(--ink)]">
                {formatMs(session.elapsedActiveMs)}
              </div>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="text-[11px] font-semibold text-[var(--ink-muted)]">Objetivo</div>
              <div className="mt-1 text-lg font-extrabold tabular-nums text-[var(--ink)]">
                {formatMs(session.totalDurationMs)}
              </div>
            </div>
          </div>

          {/* Completion bar */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between gap-2 text-xs text-[var(--ink-muted)]">
              <span className="font-semibold">Completado</span>
              <span className="font-bold tabular-nums">{completionPct}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/5 ring-1 ring-black/5">
              <div
                className="h-full rounded-full bg-[var(--ink)] transition-[width]"
                style={{ width: `${completionPct}%` }}
              />
            </div>
          </div>

          {/* What was studied */}
          {focusItems.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                Contenido estudiado
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--ink)] marker:text-[var(--ink-muted)]">
                {focusItems.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Parking lot notes */}
          {parkingNotes.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                Parking Lot de esta sesión
                <span className="ml-2 rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] font-bold tabular-nums text-[var(--ink-muted)]">
                  {parkingNotes.length}
                </span>
              </div>
              <ul className="mt-2 space-y-2">
                {parkingNotes.map((n) => (
                  <li
                    key={n.id}
                    className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs leading-snug text-[var(--ink)]"
                  >
                    <p className="whitespace-pre-wrap">{n.text}</p>
                    <p className="mt-1 text-[10px] text-[var(--ink-faint)]">{formatParkingNoteTime(n.createdAt)}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-[var(--border)] px-5 py-4 flex gap-3">
          <button
            type="button"
            onClick={handleRedo}
            className="flex-1 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-sm font-extrabold text-[var(--ink)] transition hover:bg-[var(--canvas)]"
          >
            Rehacer sesión
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-2xl bg-[var(--ink)] px-4 py-3 text-sm font-extrabold text-white transition hover:opacity-90"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
