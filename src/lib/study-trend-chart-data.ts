"use client";

import { loadImportantDeadlines } from "@/lib/deadlines-storage";
import { loadStudyPlans } from "@/lib/study-plans-storage";
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

/**
 * 13 días (±6) centrados en hoy: horas de estudio como en el calendario.
 * - Suma deadlines `study-<planId>-<YYYY-MM-DD>` (tras «Añadir al calendario» o equivalente).
 * - Añade horas de `aiSchedule.days` de cada plan cuando ese día aún no tiene deadline
 *   con el mismo id (plan guardado en la app con `savedAt`).
 */
export function buildStudyTrendChartData(): StudyTrendChartPoint[] {
  if (typeof window === "undefined") return [];

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
    const slot = slots.find((s) => s.date === dl.date);
    if (slot) {
      slot.hours += (dl.durationMinutes ?? 60) / 60;
    }
  }

  const coveredIds = new Set(deadlines.map((d) => d.id));
  for (const p of loadStudyPlans()) {
    const sched = p.aiSchedule;
    if (!sched?.days?.length) continue;

    for (const day of sched.days) {
      if (!day?.date || !ymdSet.has(day.date)) continue;
      const syncId = `study-${p.id}-${day.date}`;
      if (coveredIds.has(syncId)) continue;
      const slot = slots.find((s) => s.date === day.date);
      if (slot) {
        slot.hours += Math.max(0, day.studyHours ?? 0);
      }
    }
  }

  return slots.map(({ label, hours, isToday }) => ({
    label,
    hours: finiteHour(hours),
    isToday,
  }));
}
