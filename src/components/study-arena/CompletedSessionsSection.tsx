"use client";

import { useCallback, useEffect, useState } from "react";
import {
  loadCompletedSessions,
  STUDY_ARENA_COMPLETED_CHANGED_EVENT,
  type CompletedSession,
} from "@/lib/study-arena-completed-storage";
import { CompletedSessionModal } from "@/components/study-arena/CompletedSessionModal";
import { type StudyArenaSessionOption } from "@/components/study-arena/StudyArenaProvider";

function formatCompletedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}min`;
  return `${m}min`;
}

function focusScoreColor(score: number): string {
  const s = Math.max(0, Math.min(100, score));
  const hue = Math.round((s / 100) * 120);
  return `hsl(${hue} 82% 42%)`;
}

type Props = {
  onRedo: (option: StudyArenaSessionOption) => void;
};

export function CompletedSessionsSection({ onRedo }: Props) {
  const [sessions, setSessions] = useState<CompletedSession[]>(() => loadCompletedSessions());
  const [selected, setSelected] = useState<CompletedSession | null>(null);

  const refresh = useCallback(() => {
    setSessions(loadCompletedSessions());
  }, []);

  useEffect(() => {
    window.addEventListener(STUDY_ARENA_COMPLETED_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(STUDY_ARENA_COMPLETED_CHANGED_EVENT, refresh);
  }, [refresh]);

  if (sessions.length === 0) return null;

  return (
    <>
      <CompletedSessionModal
        session={selected}
        onClose={() => setSelected(null)}
        onRedo={onRedo}
      />

      <div className="mt-6">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-extrabold text-[var(--ink)]">Sesiones completadas</h2>
          <span className="rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-0.5 text-[11px] font-bold tabular-nums text-[var(--ink-muted)]">
            {sessions.length}
          </span>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {sessions.map((s) => {
            const sessionTitle = s.sessionTitle?.trim() || "Sesión de estudio";
            const completionPct = Math.min(100, Math.round((s.elapsedActiveMs / Math.max(1, s.totalDurationMs)) * 100));
            return (
              <li key={s.completionId}>
                <button
                  type="button"
                  onClick={() => setSelected(s)}
                  className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-4 text-left transition hover:bg-[var(--surface-muted)]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-0.5 text-[11px] font-bold text-[var(--ink-muted)]">
                      {s.planTitle}
                    </span>
                    <span className="text-[11px] text-[var(--ink-faint)]">{formatCompletedAt(s.completedAt)}</span>
                  </div>

                  <div className="mt-2 truncate text-sm font-extrabold text-[var(--ink)]">{sessionTitle}</div>

                  <div className="mt-3 flex items-center gap-4">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: focusScoreColor(s.focusScore) }}
                        aria-hidden
                      />
                      <span className="text-xs font-bold text-[var(--ink-muted)]">
                        {s.focusScore}
                      </span>
                    </div>
                    <span className="text-xs text-[var(--ink-muted)]">{formatMs(s.elapsedActiveMs)}</span>
                    <span className="text-xs text-[var(--ink-muted)]">{completionPct}%</span>
                    {s.distractionCount > 0 && (
                      <span className="text-xs text-[var(--ink-faint)]">
                        {s.distractionCount} dist.
                      </span>
                    )}
                  </div>

                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-black/5">
                    <div
                      className="h-full rounded-full bg-[var(--ink)]/30"
                      style={{ width: `${completionPct}%` }}
                    />
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
