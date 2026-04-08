"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  loadCompletedSessions,
  MAX_COMPLETED_SESSIONS,
  STUDY_ARENA_COMPLETED_CHANGED_EVENT,
  STUDY_ARENA_COMPLETED_STORAGE_KEY,
  type CompletedSession,
} from "@/lib/study-arena-completed-storage";
import { CompletedSessionModal } from "@/components/study-arena/CompletedSessionModal";
import { type StudyArenaSessionOption } from "@/components/study-arena/StudyArenaProvider";

function formatPlanDayLabel(ymd: string): string {
  const parts = ymd.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return ymd;
  const [y, m, d] = parts;
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  if (Number.isNaN(dt.getTime())) return ymd;
  return dt.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function groupSessionsByPlanDay(sessions: CompletedSession[]): { date: string; items: CompletedSession[] }[] {
  const byDate = new Map<string, CompletedSession[]>();
  for (const s of sessions) {
    const d = (s.date || "").trim() || "—";
    const arr = byDate.get(d) ?? [];
    arr.push(s);
    byDate.set(d, arr);
  }
  for (const arr of byDate.values()) {
    arr.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => {
      if (a === "—") return 1;
      if (b === "—") return -1;
      return b.localeCompare(a);
    })
    .map(([date, items]) => ({ date, items }));
}

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

  const grouped = useMemo(() => groupSessionsByPlanDay(sessions), [sessions]);

  useEffect(() => {
    window.addEventListener(STUDY_ARENA_COMPLETED_CHANGED_EVENT, refresh);
    function onStorage(e: StorageEvent) {
      if (e.key === STUDY_ARENA_COMPLETED_STORAGE_KEY) refresh();
    }
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(STUDY_ARENA_COMPLETED_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, [refresh]);

  return (
    <>
      <CompletedSessionModal
        session={selected}
        onClose={() => setSelected(null)}
        onRedo={onRedo}
        onDeleted={() => {
          setSelected(null);
          refresh();
        }}
      />

      <div className="mt-6">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-extrabold text-[var(--ink)]">Historial de sesiones completadas</h2>
          <span className="rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-0.5 text-[11px] font-bold tabular-nums text-[var(--ink-muted)]">
            {sessions.length}
          </span>
        </div>
        <p className="mb-4 text-xs text-[var(--ink-muted)]">
          Todas las sesiones que finalices en Study Arena se guardan por día del plan (incluidos días anteriores). Hasta{" "}
          {MAX_COMPLETED_SESSIONS.toLocaleString("es")} entradas.
        </p>

        {sessions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface-muted)] px-4 py-8 text-center">
            <p className="text-sm font-medium text-[var(--ink)]">Aún no hay sesiones completadas</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-[var(--ink-muted)]">
              Cuando completes una sesión (o la guardes manualmente), aparecerá aquí agrupada por el día del plan.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {grouped.map(({ date, items }) => (
              <section key={date}>
                <h3 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-[var(--ink-muted)]">
                  {date === "—" ? "Sin fecha de plan" : formatPlanDayLabel(date)}
                  <span className="ml-2 font-semibold normal-case text-[var(--ink-faint)]">({items.length})</span>
                </h3>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {items.map((s) => {
                    const sessionTitle = s.sessionTitle?.trim() || "Sesión de estudio";
                    const completionPct = Math.min(
                      100,
                      Math.round((s.elapsedActiveMs / Math.max(1, s.totalDurationMs)) * 100),
                    );
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
                              <span className="text-xs font-bold text-[var(--ink-muted)]">{s.focusScore}</span>
                            </div>
                            <span className="text-xs text-[var(--ink-muted)]">{formatMs(s.elapsedActiveMs)}</span>
                            <span className="text-xs text-[var(--ink-muted)]">{completionPct}%</span>
                            {s.distractionCount > 0 && (
                              <span className="text-xs text-[var(--ink-faint)]">{s.distractionCount} dist.</span>
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
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
