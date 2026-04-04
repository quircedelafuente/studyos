"use client";

import { useStudyArena } from "@/components/study-arena/StudyArenaProvider";

function formatRemainingShort(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function StudyArenaFloatingWidget() {
  const { activeSession, focusScore, timeRemainingMs, suppressFloatingWidget } = useStudyArena();

  if (!activeSession || suppressFloatingWidget) return null;

  return (
    <div
      className="fixed z-50 max-w-[calc(100vw-1.5rem)]"
      style={{
        bottom: "max(1rem, env(safe-area-inset-bottom, 0px))",
        right: "max(1rem, env(safe-area-inset-right, 0px))",
      }}
    >
      <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 shadow-sm">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--ink)] text-white">
          <span className="text-xs font-extrabold tabular-nums">{Math.round(focusScore)}</span>
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-bold text-[var(--ink-muted)]">Focus score</div>
          <div className="text-xs font-extrabold tabular-nums">{formatRemainingShort(timeRemainingMs)}</div>
        </div>
      </div>
    </div>
  );
}

