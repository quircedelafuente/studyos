import type { GoogleCalendarEventItem } from "@/lib/google-calendar-types";
import { parseGoogleDateTimeToJsDate } from "@/lib/google-event-datetime";

/** Altura total de la rejilla (24 h). Más alto = celdas horarias más legibles. */
export const PX_PER_HOUR = 76;
export const HOURS_IN_GRID = 24;
export const GRID_HEIGHT_PX = PX_PER_HOUR * HOURS_IN_GRID;

/** Versión dinámica para cálculos que dependen del contexto móvil */
export function getGridMetrics(isMobile: boolean) {
  // En móvil queremos ver ~9 horas sin scroll.
  // Altura típica de pantalla libre para el calendario en iOS (después de header/safe area) es ~600px-700px.
  // 650 / 9 = ~72px. Usaremos un valor dinámico.
  const pxPerHour = isMobile ? 70 : 76; 
  return {
    pxPerHour,
    hoursInGrid: HOURS_IN_GRID,
    gridHeightPx: pxPerHour * HOURS_IN_GRID,
  };
}

export type ParsedEventRange = {
  start: Date;
  end: Date;
  allDay: boolean;
  /** Solo día completo: fin exclusivo (como Google). */
  endExclusive?: Date;
};

export function parseGoogleEventRange(
  item: GoogleCalendarEventItem,
): ParsedEventRange | null {
  if (item.start?.dateTime) {
    const start = parseGoogleDateTimeToJsDate(
      item.start.dateTime,
      item.start.timeZone,
    );
    if (!start) return null;
    const endTz = item.end?.timeZone ?? item.start.timeZone;
    let end: Date;
    if (item.end?.dateTime) {
      const parsedEnd = parseGoogleDateTimeToJsDate(item.end.dateTime, endTz);
      if (!parsedEnd) return null;
      end = parsedEnd;
    } else {
      end = new Date(start.getTime() + 60 * 60 * 1000);
    }
    if (end <= start) {
      return { start, end: new Date(start.getTime() + 60 * 60 * 1000), allDay: false };
    }
    return { start, end, allDay: false };
  }
  if (item.start?.date && item.end?.date) {
    const [ys, ms, ds] = item.start.date.split("-").map(Number);
    const [ye, me, de] = item.end.date.split("-").map(Number);
    const start = new Date(ys, ms - 1, ds, 0, 0, 0, 0);
    const endExclusive = new Date(ye, me - 1, de, 0, 0, 0, 0);
    if (Number.isNaN(start.getTime()) || Number.isNaN(endExclusive.getTime())) {
      return null;
    }
    return { start, end: endExclusive, allDay: true, endExclusive };
  }
  return null;
}

function dayWindow(day: Date): { dayStart: Date; dayEnd: Date } {
  const dayStart = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    0,
    0,
    0,
    0,
  );
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return { dayStart, dayEnd };
}

/** ¿El evento de día completo cubre este día local? */
export function allDayOverlapsLocalDay(
  start: Date,
  endExclusive: Date,
  day: Date,
): boolean {
  const { dayStart, dayEnd } = dayWindow(day);
  return start < dayEnd && endExclusive > dayStart;
}

export type TimedSegment = {
  key: string;
  col: number;
  topPx: number;
  heightPx: number;
  title: string;
  rangeLabel: string;
  lane: number;
  maxLanes: number;
  colorId?: string;
  eventId?: string;
  calendarId?: string;
};

export type AllDayChip = {
  key: string;
  title: string;
  colorId?: string;
  eventId?: string;
  calendarId?: string;
};

/** Segmentos horarios por columna + carriles para solapes. */
export function buildTimedSegmentsForWeek(
  items: GoogleCalendarEventItem[],
  weekDays: Date[],
): TimedSegment[] {
  type Raw = {
    key: string;
    col: number;
    topPx: number;
    heightPx: number;
    title: string;
    rangeLabel: string;
    colorId?: string;
    eventId?: string;
    calendarId?: string;
  };

  const raw: Raw[] = [];

  for (const item of items) {
    const parsed = parseGoogleEventRange(item);
    if (!parsed || parsed.allDay) continue;

    const title = item.summary?.trim() || "(Sin título)";
    const colorId = item.colorId;
    const eventId = item.id;
    const calendarId = item.calendarId;

    for (let col = 0; col < 7; col++) {
      const day = weekDays[col];
      const { dayStart, dayEnd } = dayWindow(day);
      const { start: evStart, end: evEnd } = parsed;
      if (evEnd <= dayStart || evStart >= dayEnd) continue;

      const visStart = evStart < dayStart ? dayStart : evStart;
      const visEnd = evEnd > dayEnd ? dayEnd : evEnd;

      const minutesFromMidnight =
        visStart.getHours() * 60 +
        visStart.getMinutes() +
        visStart.getSeconds() / 60;

      const endMinutes =
        visEnd.getTime() >= dayEnd.getTime()
          ? HOURS_IN_GRID * 60
          : visEnd.getHours() * 60 +
            visEnd.getMinutes() +
            visEnd.getSeconds() / 60;
      const durationMin = Math.max(endMinutes - minutesFromMidnight, 15);

      const topPx = (minutesFromMidnight / (HOURS_IN_GRID * 60)) * GRID_HEIGHT_PX;
      let heightPx = (durationMin / (HOURS_IN_GRID * 60)) * GRID_HEIGHT_PX;
      heightPx = Math.max(heightPx, 22);

      const rangeLabel = `${visStart.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })} – ${visEnd.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}`;

      raw.push({
        key: `${item.id ?? title}-${col}-${visStart.getTime()}`,
        col,
        topPx,
        heightPx,
        title,
        rangeLabel,
        colorId,
        eventId,
        calendarId,
      });
    }
  }

  const out: TimedSegment[] = [];

  for (let col = 0; col < 7; col++) {
    const colSegs = raw
      .filter((s) => s.col === col)
      .sort((a, b) => a.topPx - b.topPx || b.heightPx - a.heightPx);

    const laneEnds: number[] = [];
    const assignments: { seg: Raw; lane: number }[] = [];

    for (const s of colSegs) {
      const bottom = s.topPx + s.heightPx;
      let lane = 0;
      while (lane < laneEnds.length && s.topPx < laneEnds[lane]) {
        lane++;
      }
      if (lane === laneEnds.length) {
        laneEnds.push(bottom);
      } else {
        laneEnds[lane] = bottom;
      }
      assignments.push({ seg: s, lane });
    }

    const maxLanes = Math.max(1, laneEnds.length);
    for (const { seg, lane } of assignments) {
      out.push({
        ...seg,
        lane,
        maxLanes,
      });
    }
  }

  return out;
}

export function buildAllDayChipsByColumn(
  items: GoogleCalendarEventItem[],
  weekDays: Date[],
): Map<number, AllDayChip[]> {
  const m = new Map<number, AllDayChip[]>();
  for (let i = 0; i < 7; i++) m.set(i, []);

  for (const item of items) {
    const parsed = parseGoogleEventRange(item);
    if (!parsed?.allDay || !parsed.endExclusive) continue;
    const title = item.summary?.trim() || "(Sin título)";
    const endEx = parsed.endExclusive;

    for (let col = 0; col < 7; col++) {
      if (allDayOverlapsLocalDay(parsed.start, endEx, weekDays[col])) {
        const list = m.get(col) ?? [];
        list.push({
          key: `${item.id ?? title}-${col}-allday`,
          title,
          colorId: item.colorId,
          eventId: item.id,
          calendarId: item.calendarId,
        });
        m.set(col, list);
      }
    }
  }

  return m;
}
