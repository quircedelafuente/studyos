import type { GoogleCalendarEventItem } from "@/lib/google-calendar-types";
import { parseGoogleDateTimeToJsDate } from "@/lib/google-event-datetime";

export type CalendarDayEvent = {
  title: string;
  timeLabel: string;
  colorId?: string;
  eventId?: string;
  calendarId?: string;
};

/** Agrupa eventos de Google por día local del mes visualizado. */
export function mapGoogleEventsToMonthDays(
  items: GoogleCalendarEventItem[],
  year: number,
  monthIndex: number,
): Map<number, CalendarDayEvent[]> {
  const m = new Map<number, CalendarDayEvent[]>();

  for (const item of items) {
    const start = item.start?.dateTime
      ? parseGoogleDateTimeToJsDate(item.start.dateTime, item.start.timeZone)
      : item.start?.date
        ? new Date(`${item.start.date}T12:00:00`)
        : null;
    if (!start || Number.isNaN(start.getTime())) continue;
    if (start.getFullYear() !== year || start.getMonth() !== monthIndex) {
      continue;
    }
    const day = start.getDate();
    const timeLabel = item.start?.date
      ? "Todo el día"
      : start.toLocaleTimeString("es", {
          hour: "2-digit",
          minute: "2-digit",
        });
    const title = item.summary?.trim() || "(Sin título)";
    const list = m.get(day) ?? [];
    list.push({
      title,
      timeLabel,
      colorId: item.colorId,
      eventId: item.id,
      calendarId: item.calendarId,
    });
    m.set(day, list);
  }

  for (const [, list] of m) {
    list.sort((a, b) => a.timeLabel.localeCompare(b.timeLabel));
  }

  return m;
}
