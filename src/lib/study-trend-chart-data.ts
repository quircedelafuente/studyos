"use client";

import { loadImportantDeadlines } from "@/lib/deadlines-storage";
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
 * 13 días (±6) centrados en hoy.
 * Solo cuenta horas de sesiones de estudio que el usuario haya añadido
 * al calendario (deadline entries con id `study-*` en importantDeadlines).
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

  for (const dl of loadImportantDeadlines()) {
    if (!dl.id.startsWith("study-") || !ymdSet.has(dl.date)) continue;
    const slot = slots.find((s) => s.date === dl.date);
    if (slot) {
      slot.hours += (dl.durationMinutes ?? 60) / 60;
    }
  }

  return slots.map(({ label, hours, isToday }) => ({
    label,
    hours: finiteHour(hours),
    isToday,
  }));
}
