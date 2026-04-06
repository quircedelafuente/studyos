"use client";

import { loadImportantDeadlines } from "@/lib/deadlines-storage";
import { loadStudyPlans } from "@/lib/study-plans-storage";
import { loadCompletedSessions } from "@/lib/study-arena-completed-storage";
import { formatLocalYmd } from "@/lib/study-plan-loose-parse";

export type StudyTrendChartPoint = {
  label: string;
  hours: number;
  isToday: boolean;
};

function finiteHour(h: number): number {
  if (!Number.isFinite(h) || h < 0) return 0;
  return Math.round(h * 100) / 100;
}

/** `study-<planId>-<YYYY-MM-DD>` → planId; cualquier otro formato → null. */
function studyDeadlinePlanId(deadlineId: string): string | null {
  if (!deadlineId.startsWith("study-")) return null;
  const m = deadlineId.match(/-(\d{4}-\d{2}-\d{2})$/);
  if (!m) return null;
  const ymd = m[1]!;
  const planId = deadlineId.slice("study-".length, deadlineId.length - ymd.length - 1);
  return planId.length ? planId : null;
}

/**
 * 13 días (±6) centrados en hoy: solo planes de estudio activos (Study Planner).
 * - Deadlines `study-<planId>-<fecha>` solo si existe ese plan (no reservas huérfanas ni
 *   bloques que no vienen del planner).
 * - Eventos añadidos solo en «Exámenes y fechas» (sin prefijo study-*) no entran aquí.
 * - Sesiones Arena completadas: solo si el `planId` sigue existiendo.
 */
export function buildStudyTrendChartData(): StudyTrendChartPoint[] {
  if (typeof window === "undefined") return [];

  const activePlanIds = new Set(loadStudyPlans().map((p) => p.id));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const DAY_LABELS = ["D", "L", "M", "X", "J", "V", "S"];
  const slots: Array<{
    date: string;
    label: string;
    hours: number;
    isToday: boolean;
  }> = Array.from({ length: 13 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + (i - 6));
    const dow = d.getDay();
    return {
      date: formatLocalYmd(d),
      label: `${DAY_LABELS[dow] ?? ""}${d.getDate()}`,
      hours: 0,
      isToday: i === 6,
    };
  });
  const ymdSet = new Set(slots.map((s) => s.date));

  const deadlines = loadImportantDeadlines();
  for (const dl of deadlines) {
    if (!dl.id.startsWith("study-") || !ymdSet.has(dl.date)) continue;
    const sid = studyDeadlinePlanId(dl.id);
    if (!sid || !activePlanIds.has(sid)) continue;
    const slot = slots.find((s) => s.date === dl.date);
    if (slot) {
      slot.hours += (dl.durationMinutes ?? 60) / 60;
    }
  }

  // ── Actual hours from completed Study Arena sessions ──────────────────────
  const completedByDate = new Map<string, number>();
  for (const cs of loadCompletedSessions()) {
    if (!ymdSet.has(cs.date)) continue;
    if (!activePlanIds.has(cs.planId)) continue;
    completedByDate.set(cs.date, (completedByDate.get(cs.date) ?? 0) + cs.elapsedActiveMs / 3600000);
  }

  const coveredIds = new Set(
    deadlines
      .filter((d) => {
        const pid = studyDeadlinePlanId(d.id);
        return pid != null && activePlanIds.has(pid);
      })
      .map((d) => d.id),
  );
  for (const p of loadStudyPlans()) {
    const sched = p.aiSchedule;
    if (!sched?.days?.length) continue;

    for (const day of sched.days) {
      if (!day?.date || !ymdSet.has(day.date)) continue;
      // Skip planned hours for dates that have actual completed sessions
      if (completedByDate.has(day.date)) continue;
      const syncId = `study-${p.id}-${day.date}`;
      if (coveredIds.has(syncId)) continue;
      const slot = slots.find((s) => s.date === day.date);
      if (slot) {
        slot.hours += Math.max(0, day.studyHours ?? 0);
      }
    }
  }

  // Apply actual hours (override planned for those dates)
  for (const [date, actualHours] of completedByDate) {
    const slot = slots.find((s) => s.date === date);
    if (slot) slot.hours = finiteHour(actualHours);
  }

  return slots.map(({ label, hours, isToday }) => ({
    label,
    hours: finiteHour(hours),
    isToday,
  }));
}
