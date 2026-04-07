import type { GoogleCalendarEventItem } from "@/lib/google-calendar-types";
import { normalizeGoogleEventColorId } from "@/lib/google-calendar-event-colors";
import type { StudyPlan } from "@/types/dashboard";
import { loadImportantDeadlines } from "@/lib/deadlines-storage";

/** Vista previa de sesiones del plan IA (no confundir con filas ya guardadas en «Exámenes y fechas»). */
export const STUDY_PLAN_PREVIEW_CALENDAR_ID = "iestudio-study-plan-preview";

/** Prefijo del `id` de eventos de vista previa del plan IA en el calendario de semana. */
export const STUDY_PLAN_DAY_EVENT_ID_PREFIX = "iestudio-sp-day-";

/** Eventos locales generados desde el calendario IA del plan ya guardados en «Exámenes y fechas». */
const STUDY_DEADLINE_PREFIX = "study-";

/**
 * Días del plan IA que aún no tienen entrada en deadlines (p. ej. borrador sin «Añadir al calendario»).
 * Evita duplicar con `study-<planId>-<date>` cuando ya están sincronizados.
 */
export function studyPlanAiScheduleToCalendarEvents(plans: StudyPlan[]): GoogleCalendarEventItem[] {
  if (typeof window === "undefined") return [];
  const deadlines = loadImportantDeadlines();
  const covered = new Set(deadlines.map((d) => d.id));
  const out: GoogleCalendarEventItem[] = [];

  for (const p of plans) {
    const linked = p.targetDeadlineId
      ? deadlines.find((d) => d.id === p.targetDeadlineId)
      : undefined;
    const colorId = normalizeGoogleEventColorId(linked?.calendarColorId);

    const days = p.aiSchedule?.days ?? [];
    for (const day of days) {
      if (!day?.date || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)) continue;
      const syncId = `${STUDY_DEADLINE_PREFIX}${p.id}-${day.date}`;
      if (covered.has(syncId)) continue;

      const parts = day.date.split("-").map(Number);
      if (parts.length !== 3) continue;
      const [y, mo, d] = parts;
      if (!y || !mo || !d) continue;
      const durationMs = Math.max(
        30 * 60 * 1000,
        Math.round(Math.max(0.25, day.studyHours) * 60) * 60 * 1000,
      );
      const startTimeParts = day.startTime?.split(":").map(Number);
      const startH = startTimeParts?.[0] ?? 9;
      const startM = startTimeParts?.[1] ?? 0;
      const start = new Date(y, mo - 1, d, startH, startM, 0, 0);
      const end = new Date(start.getTime() + durationMs);
      const head = day.sessionTitle?.trim() ? `${day.sessionTitle.trim()}: ` : "";
      const focus = (day.focus ?? "").trim();
      const summary = `📚 ${p.title}: ${head}${focus || `${day.studyHours}h`}`.slice(0, 200);

      out.push({
        id: `${STUDY_PLAN_DAY_EVENT_ID_PREFIX}${p.id}-${day.date}`,
        calendarId: STUDY_PLAN_PREVIEW_CALENDAR_ID,
        summary,
        colorId,
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
      });
    }
  }

  return out;
}
