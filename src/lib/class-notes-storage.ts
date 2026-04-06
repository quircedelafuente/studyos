import type { GoogleCalendarEventItem } from "@/lib/google-calendar-types";
import { parseGoogleDateTimeToJsDate } from "@/lib/google-event-datetime";
import { requestCloudSyncPush } from "@/lib/cloud-sync-push";

export const CLASS_NOTES_STORAGE_KEY = "iestudio-class-notes";

export const CLASS_NOTES_CHANGED_EVENT = "iestudio-class-notes-changed";

/** Tope de sesiones por curso (calendario + manuales); el rango de fechas es amplio (p. ej. hasta junio). */
export const CLASS_NOTES_MAX_SESSIONS = 1000;

export type ClassNoteSessionRow = {
  id: string;
  label: string;
  /** Clave estable del evento de Google cuando viene del calendario. */
  googleEventKey?: string;
};

export type ClassNotesCourseBucket = {
  sessions: ClassNoteSessionRow[];
};

export type ClassNotesState = {
  v: 1;
  byCourse: Record<string, ClassNotesCourseBucket>;
};

const EMPTY: ClassNotesState = { v: 1, byCourse: {} };

function newRowId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `cn-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function googleEventKey(ev: GoogleCalendarEventItem): string {
  return `${ev.calendarId ?? ""}::${ev.id ?? ""}`;
}

function eventStartMs(ev: GoogleCalendarEventItem): number {
  const d = parseGoogleDateTimeToJsDate(
    ev.start?.dateTime,
    ev.start?.timeZone,
  );
  if (d) return d.getTime();
  const day = ev.start?.date?.trim();
  if (day) return new Date(`${day}T12:00:00`).getTime();
  return 0;
}

export function isTimedClassNotesEvent(ev: GoogleCalendarEventItem): boolean {
  return Boolean(ev.start?.dateTime?.trim());
}

/**
 * Extrae el número de sesión del título del evento (p. ej. "Sesión 3", "S3", "Session 12", "3ª sesión").
 * Si no hay número reconocible, devuelve null (van al final al ordenar).
 */
export function parseSessionNumberFromSummary(summary: string): number | null {
  const s = summary.trim().toLowerCase();
  if (!s) return null;

  const patterns: RegExp[] = [
    /(?:sesi[oó]n|session)\s*(?:n[oº°.]?\s*|número\s*|numero\s*)?(?:#|:|\.)?\s*(\d{1,3})\b/,
    /(?:clase|class)\s*(?:#|:|\.)?\s*(\d{1,3})\b/,
    /\b(\d{1,3})\s*(?:ª|a|er|o|º|°)?\s*(?:sesi[oó]n|session)\b/,
    /\bs\s*(\d{1,3})\b/,
  ];

  for (const re of patterns) {
    const m = s.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 999) return n;
    }
  }
  return null;
}

function compareClassNotesEventsBySessionNumberThenTime(
  a: GoogleCalendarEventItem,
  b: GoogleCalendarEventItem,
): number {
  const na =
    parseSessionNumberFromSummary(a.summary ?? "") ?? Number.MAX_SAFE_INTEGER;
  const nb =
    parseSessionNumberFromSummary(b.summary ?? "") ?? Number.MAX_SAFE_INTEGER;
  if (na !== nb) return na - nb;
  return eventStartMs(a) - eventStartMs(b);
}

export function eventMatchesCourseName(
  ev: GoogleCalendarEventItem,
  courseName: string,
): boolean {
  const summ = (ev.summary ?? "").toLowerCase().trim();
  const n = courseName.toLowerCase().trim();
  if (!summ || !n) return false;
  return summ.includes(n);
}

export function assignEventToLearnCourseId(
  ev: GoogleCalendarEventItem,
  courses: { learnCourseId: string; name: string }[],
): string | null {
  for (const c of courses) {
    if (eventMatchesCourseName(ev, c.name)) return c.learnCourseId;
  }
  return null;
}

export function loadClassNotes(): ClassNotesState {
  if (typeof window === "undefined") return { ...EMPTY };
  try {
    const raw = window.localStorage.getItem(CLASS_NOTES_STORAGE_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return { ...EMPTY };
    const o = parsed as Record<string, unknown>;
    if (o.v !== 1 || !o.byCourse || typeof o.byCourse !== "object") {
      return { ...EMPTY };
    }
    const byCourse: Record<string, ClassNotesCourseBucket> = {};
    for (const [k, v] of Object.entries(o.byCourse)) {
      if (!v || typeof v !== "object") continue;
      const sessionsRaw = (v as Record<string, unknown>).sessions;
      if (!Array.isArray(sessionsRaw)) {
        byCourse[k] = { sessions: [] };
        continue;
      }
      const sessions: ClassNoteSessionRow[] = [];
      for (const row of sessionsRaw) {
        if (!row || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        if (typeof r.id !== "string" || typeof r.label !== "string") continue;
        const ge =
          typeof r.googleEventKey === "string" ? r.googleEventKey : undefined;
        sessions.push({
          id: r.id,
          label: r.label,
          googleEventKey: ge,
        });
      }
      byCourse[k] = { sessions: sessions.slice(0, CLASS_NOTES_MAX_SESSIONS) };
    }
    return { v: 1, byCourse };
  } catch {
    return { ...EMPTY };
  }
}

export function saveClassNotes(state: ClassNotesState): void {
  if (typeof window === "undefined") return;
  const normalized: ClassNotesState = {
    v: 1,
    byCourse: {},
  };
  for (const [cid, bucket] of Object.entries(state.byCourse)) {
    normalized.byCourse[cid] = {
      sessions: (bucket.sessions ?? []).slice(0, CLASS_NOTES_MAX_SESSIONS),
    };
  }
  window.localStorage.setItem(
    CLASS_NOTES_STORAGE_KEY,
    JSON.stringify(normalized),
  );
  window.dispatchEvent(new Event(CLASS_NOTES_CHANGED_EVENT));
  requestCloudSyncPush();
}

/** Curso virtual para eventos que no encajan con ningún nombre de curso. */
export const UNASSIGNED_COURSE_KEY = "__unassigned__";

function buildCalendarRowsFromEvents(
  matching: GoogleCalendarEventItem[],
  prevSessions: ClassNoteSessionRow[],
): ClassNoteSessionRow[] {
  const sorted = [...matching].sort(compareClassNotesEventsBySessionNumberThenTime);
  const prevByKey = new Map(
    prevSessions
      .filter((r) => r.googleEventKey)
      .map((r) => [r.googleEventKey!, r] as const),
  );

  return sorted.map((ev) => {
    const key = googleEventKey(ev);
    const prevRow = prevByKey.get(key);
    const labelDefault = (ev.summary ?? "").trim() || "Sesión";
    if (prevRow) {
      return {
        id: prevRow.id,
        label: prevRow.label.trim() ? prevRow.label : labelDefault,
        googleEventKey: key,
      };
    }
    return {
      id: newRowId(),
      label: labelDefault,
      googleEventKey: key,
    };
  });
}

function sessionsListShallowEqual(
  a: ClassNoteSessionRow[],
  b: ClassNoteSessionRow[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.label !== y.label ||
      x.googleEventKey !== y.googleEventKey
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Actualiza los buckets por curso a partir de **todo** el rango de eventos cargado:
 * orden por número de sesión en el título y luego por fecha.
 * Mantiene filas manuales (sin `googleEventKey`) al final y conserva id/label si el evento ya existía.
 */
export function syncClassNotesBucketsFromGoogleEvents(
  state: ClassNotesState,
  events: GoogleCalendarEventItem[],
  displayedCourses: { learnCourseId: string; name: string }[],
): { state: ClassNotesState; changed: boolean } {
  const timed = events.filter(isTimedClassNotesEvent);
  const next = { ...state, byCourse: { ...state.byCourse } };
  let changed = false;
  const courseList = displayedCourses;

  for (const c of courseList) {
    const courseKey = c.learnCourseId;
    const matching = timed.filter((ev) => eventMatchesCourseName(ev, c.name));
    const prevSessions = next.byCourse[courseKey]?.sessions ?? [];
    const manual = prevSessions.filter((s) => !s.googleEventKey);
    const calendarRows = buildCalendarRowsFromEvents(matching, prevSessions);
    const sessions = [...calendarRows, ...manual].slice(
      0,
      CLASS_NOTES_MAX_SESSIONS,
    );

    if (!sessionsListShallowEqual(sessions, prevSessions)) {
      next.byCourse[courseKey] = { sessions };
      changed = true;
    }
  }

  const unmatched = timed.filter(
    (ev) => assignEventToLearnCourseId(ev, courseList) === null,
  );
  const prevU = next.byCourse[UNASSIGNED_COURSE_KEY]?.sessions ?? [];
  const manualU = prevU.filter((s) => !s.googleEventKey);
  const calendarRowsU = buildCalendarRowsFromEvents(unmatched, prevU);
  const sessionsU = [...calendarRowsU, ...manualU].slice(
    0,
    CLASS_NOTES_MAX_SESSIONS,
  );

  if (!sessionsListShallowEqual(sessionsU, prevU)) {
    if (sessionsU.length > 0) {
      next.byCourse[UNASSIGNED_COURSE_KEY] = { sessions: sessionsU };
      changed = true;
    } else if (
      Object.prototype.hasOwnProperty.call(next.byCourse, UNASSIGNED_COURSE_KEY)
    ) {
      const nextBuckets = { ...next.byCourse };
      delete nextBuckets[UNASSIGNED_COURSE_KEY];
      next.byCourse = nextBuckets;
      changed = true;
    }
  }

  return { state: next, changed };
}

export function updateSessionLabel(
  courseKey: string,
  sessionId: string,
  label: string,
  state: ClassNotesState,
): ClassNotesState {
  const bucket = state.byCourse[courseKey];
  if (!bucket) return state;
  const sessions = bucket.sessions.map((s) =>
    s.id === sessionId ? { ...s, label } : s,
  );
  return {
    ...state,
    byCourse: { ...state.byCourse, [courseKey]: { sessions } },
  };
}

export function addEmptySession(courseKey: string, state: ClassNotesState): ClassNotesState {
  const bucket = state.byCourse[courseKey] ?? { sessions: [] };
  if (bucket.sessions.length >= CLASS_NOTES_MAX_SESSIONS) return state;
  const sessions = [
    ...bucket.sessions,
    { id: newRowId(), label: "Nueva sesión" },
  ];
  return {
    ...state,
    byCourse: { ...state.byCourse, [courseKey]: { sessions } },
  };
}

export function removeSessions(
  courseKey: string,
  sessionIds: Set<string>,
  state: ClassNotesState,
): ClassNotesState {
  const bucket = state.byCourse[courseKey];
  if (!bucket) return state;
  const sessions = bucket.sessions.filter((s) => !sessionIds.has(s.id));
  return {
    ...state,
    byCourse: { ...state.byCourse, [courseKey]: { sessions } },
  };
}

/** Localiza la fila de sesión enlazada a un evento de Google (`googleEventKey`). */
export function findSessionRowByGoogleEventKey(
  state: ClassNotesState,
  eventKey: string,
): { courseKey: string; sessionId: string } | null {
  for (const [courseKey, bucket] of Object.entries(state.byCourse)) {
    for (const row of bucket.sessions) {
      if (row.googleEventKey === eventKey) {
        return { courseKey, sessionId: row.id };
      }
    }
  }
  return null;
}
