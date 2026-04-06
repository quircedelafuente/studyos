import { requestCloudSyncPush } from "@/lib/cloud-sync-push";

export const SESSION_NOTES_STORAGE_KEY = "iestudio-class-session-notes-v1";

export const SESSION_NOTES_CHANGED_EVENT = "iestudio-class-session-notes-changed";

export type SessionNotesSourceSummary = {
  hadAudio: boolean;
  photoCount: number;
  hadDocs: boolean;
};

export type SessionNotesEntry = {
  markdown: string;
  updatedAt: string;
  generatedAt?: string;
  sourceSummary?: SessionNotesSourceSummary;
};

export type SessionNotesState = {
  v: 1;
  /** Clave: sessionCompositeKey(courseKey, sessionId) */
  bySession: Record<string, SessionNotesEntry>;
};

const EMPTY: SessionNotesState = { v: 1, bySession: {} };

/** Separador interno estable (no debería aparecer en IDs de curso). */
const SEP = "\u001f";

export function sessionCompositeKey(courseKey: string, sessionId: string): string {
  return `${courseKey}${SEP}${sessionId}`;
}

export function parseSessionCompositeKey(key: string): {
  courseKey: string;
  sessionId: string;
} | null {
  const i = key.indexOf(SEP);
  if (i <= 0 || i === key.length - 1) return null;
  return { courseKey: key.slice(0, i), sessionId: key.slice(i + 1) };
}

export function loadSessionNotes(): SessionNotesState {
  if (typeof window === "undefined") return { ...EMPTY };
  try {
    const raw = window.localStorage.getItem(SESSION_NOTES_STORAGE_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return { ...EMPTY };
    const o = parsed as Record<string, unknown>;
    if (o.v !== 1 || !o.bySession || typeof o.bySession !== "object") {
      return { ...EMPTY };
    }
    const bySession: Record<string, SessionNotesEntry> = {};
    for (const [k, v] of Object.entries(o.bySession)) {
      if (!v || typeof v !== "object") continue;
      const e = v as Record<string, unknown>;
      if (typeof e.markdown !== "string" || typeof e.updatedAt !== "string") {
        continue;
      }
      const entry: SessionNotesEntry = {
        markdown: e.markdown,
        updatedAt: e.updatedAt,
      };
      if (typeof e.generatedAt === "string") entry.generatedAt = e.generatedAt;
      if (e.sourceSummary && typeof e.sourceSummary === "object") {
        const s = e.sourceSummary as Record<string, unknown>;
        entry.sourceSummary = {
          hadAudio: s.hadAudio === true,
          photoCount: typeof s.photoCount === "number" ? s.photoCount : 0,
          hadDocs: s.hadDocs === true,
        };
      }
      bySession[k] = entry;
    }
    return { v: 1, bySession };
  } catch {
    return { ...EMPTY };
  }
}

export function saveSessionNotes(state: SessionNotesState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SESSION_NOTES_STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new Event(SESSION_NOTES_CHANGED_EVENT));
  requestCloudSyncPush();
}

export function getSessionNotesEntry(
  courseKey: string,
  sessionId: string,
): SessionNotesEntry | null {
  const k = sessionCompositeKey(courseKey, sessionId);
  return loadSessionNotes().bySession[k] ?? null;
}

export function upsertSessionNotesEntry(
  courseKey: string,
  sessionId: string,
  partial: {
    markdown: string;
    generatedAt?: string;
    sourceSummary?: SessionNotesSourceSummary;
  },
): void {
  const prev = loadSessionNotes();
  const k = sessionCompositeKey(courseKey, sessionId);
  const next: SessionNotesState = {
    v: 1,
    bySession: {
      ...prev.bySession,
      [k]: {
        markdown: partial.markdown,
        updatedAt: new Date().toISOString(),
        ...(partial.generatedAt ? { generatedAt: partial.generatedAt } : {}),
        ...(partial.sourceSummary ? { sourceSummary: partial.sourceSummary } : {}),
      },
    },
  };
  saveSessionNotes(next);
}
