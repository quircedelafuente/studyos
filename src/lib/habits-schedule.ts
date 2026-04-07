import type { HabitDefinition, HabitSchedule, HabitLogEntry } from "@/types/dashboard";
import { mondayYmdLocal, todayYmdLocal } from "@/lib/daily-checklist-storage";

export function clampWeekday(n: number): number {
  const x = Math.floor(Number(n));
  if (!Number.isFinite(x)) return 1;
  return ((x % 7) + 7) % 7;
}

export function normalizeHabitSchedule(raw: unknown): HabitSchedule | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.mode === "weekdays") {
    const wd = o.weekdays;
    if (!Array.isArray(wd)) return null;
    const set = new Set<number>();
    for (const x of wd) set.add(clampWeekday(Number(x)));
    const weekdays = [...set].sort((a, b) => a - b);
    if (weekdays.length === 0) return null;
    return { mode: "weekdays", weekdays };
  }
  if (o.mode === "times_per_week") {
    const t = Number((o as any).timesPerWeek);
    const timesPerWeek = Number.isFinite(t) ? Math.max(1, Math.min(7, Math.round(t))) : 3;
    return { mode: "times_per_week", timesPerWeek };
  }
  return null;
}

export function isHabitScheduledOnDate(h: HabitDefinition, date: Date): boolean {
  const s = h.schedule;
  if (s.mode === "weekdays") {
    const wd = date.getDay(); // 0..6
    return s.weekdays.includes(wd);
  }
  // times_per_week: “programado” todos los días, el objetivo es semanal.
  return true;
}

export function periodKeyForHabitOnDate(h: HabitDefinition, date: Date): string {
  if (h.schedule.mode === "times_per_week") return mondayYmdLocal(date);
  // weekdays -> diario
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function periodKeyForHabitToday(h: HabitDefinition): string {
  if (h.schedule.mode === "times_per_week") return mondayYmdLocal();
  return todayYmdLocal();
}

export function isHabitLogDone(h: HabitDefinition, e: HabitLogEntry | null | undefined): boolean {
  if (!e) return false;
  if (h.kind === "check") return Boolean(e.done);
  const v = typeof e.value === "number" ? e.value : 0;
  const tgt = typeof h.target === "number" ? h.target : null;
  if (!tgt || tgt <= 0) return v > 0;
  return v >= tgt;
}

