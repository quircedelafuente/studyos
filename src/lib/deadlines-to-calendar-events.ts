import type { ImportantDeadline } from "@/types/dashboard";
import type { GoogleCalendarEventItem } from "@/lib/google-calendar-types";
import { normalizeGoogleEventColorId } from "@/lib/google-calendar-event-colors";

/** Prefijo en `id` para distinguir deadlines locales de eventos de Google. */
export const DEADLINE_CALENDAR_EVENT_ID_PREFIX = "iestudio-deadline-";

/** Valor de `calendarId` en eventos generados desde «Exámenes y fechas» (no es un calendario de Google). */
export const LOCAL_DEADLINES_CALENDAR_ID = "iestudio-local-deadlines";

/**
 * Convierte un deadline de «Exámenes y fechas» al formato de evento que usa el calendario
 * (misma forma que Google Calendar API) para mostrarlo en mes y semana.
 */
export function importantDeadlineToCalendarEvent(
  d: ImportantDeadline,
): GoogleCalendarEventItem {
  const id = `${DEADLINE_CALENDAR_EVENT_ID_PREFIX}${d.id}`;
  const colorId = normalizeGoogleEventColorId(d.calendarColorId);

  if (d.time) {
    const [y, mo, da] = d.date.split("-").map(Number);
    const [h, mi] = d.time.split(":").map(Number);
    if (!y || !mo || !da || Number.isNaN(h) || Number.isNaN(mi)) {
      return {
        id,
        calendarId: LOCAL_DEADLINES_CALENDAR_ID,
        summary: d.title,
        colorId,
        start: { date: d.date },
        end: { date: addOneDayYmd(d.date) },
      };
    }
    const durationMs = (d.durationMinutes ?? 60) * 60 * 1000;
    const start = new Date(y, mo - 1, da, h, mi, 0, 0);
    const end = new Date(start.getTime() + durationMs);
    return {
      id,
      calendarId: LOCAL_DEADLINES_CALENDAR_ID,
      summary: d.title,
      colorId,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    };
  }

  return {
    id,
    calendarId: LOCAL_DEADLINES_CALENDAR_ID,
    summary: d.title,
    colorId,
    start: { date: d.date },
    end: { date: addOneDayYmd(d.date) },
  };
}

function addOneDayYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const next = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  const yy = next.getFullYear();
  const mm = String(next.getMonth() + 1).padStart(2, "0");
  const dd = String(next.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function importantDeadlinesToCalendarEvents(
  list: ImportantDeadline[],
): GoogleCalendarEventItem[] {
  return list.map(importantDeadlineToCalendarEvent);
}
