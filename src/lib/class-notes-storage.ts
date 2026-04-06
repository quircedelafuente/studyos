import type { GoogleCalendarEventItem } from "@/lib/google-calendar-types";
import { parseGoogleDateTimeToJsDate } from "@/lib/google-event-datetime";
import { requestCloudSyncPush } from "@/lib/cloud-sync-push";

export const CLASS_NOTES_STORAGE_KEY = "iestudio-class-notes";

export const CLASS_NOTES_CHANGED_EVENT = "iestudio-class-notes-changed";

export const CLASS_NOTES_MAX_SESSIONS = 30;

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

export function seedCoursesFromGoogleEvents(
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
    if (Object.prototype.hasOwnProperty.call(next.byCourse, courseKey)) continue;

    const matching = timed
      .filter((ev) => eventMatchesCourseName(ev, c.name))
      .sort((a, b) => eventStartMs(a) - eventStartMs(b))
      .slice(0, CLASS_NOTES_MAX_SESSIONS);

    if (matching.length === 0) continue;

    next.byCourse[courseKey] = {
      sessions: matching.map((ev) => ({
        id: newRowId(),
        label: (ev.summary ?? "").trim() || "Sesión",
        googleEventKey: googleEventKey(ev),
      })),
    };
    changed = true;
  }

  if (!Object.prototype.hasOwnProperty.call(next.byCourse, UNASSIGNED_COURSE_KEY)) {
    const unmatched = timed
      .filter((ev) => assignEventToLearnCourseId(ev, courseList) === null)
      .sort((a, b) => eventStartMs(a) - eventStartMs(b))
      .slice(0, CLASS_NOTES_MAX_SESSIONS);

    if (unmatched.length > 0) {
      next.byCourse[UNASSIGNED_COURSE_KEY] = {
        sessions: unmatched.map((ev) => ({
          id: newRowId(),
          label: (ev.summary ?? "").trim() || "Sesión",
          googleEventKey: googleEventKey(ev),
        })),
      };
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
