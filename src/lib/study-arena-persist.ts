"use client";

export type FalseSessionPromptPersist = {
  reason: "too_short" | "too_long";
  mode: "active" | "ended";
};

export const STUDY_ARENA_PERSIST_KEY = "iestudio-study-arena-live-state";
export const STUDY_ARENA_PERSIST_CHANGED = "iestudio-study-arena-persist-changed";

/** Snapshot serializable (sin funciones). */
export type SerializedArenaActiveSession = {
  key: string;
  planId: string;
  planTitle: string;
  date: string;
  studyHours: number;
  focus: string;
  sessionTitle?: string;
  arenaRunId: string;
  totalDurationMs: number;
  startedAtMs: number;
  elapsedActiveMs: number;
  segmentStartMs: number | null;
  paused: boolean;
  distractionCount: number;
  focusScore: number;
  lastInteractionMs: number;
};

export type StudyArenaPersistedPayload = {
  v: 1;
  savedAtMs: number;
  activeSession: SerializedArenaActiveSession | null;
  falseSessionPrompt: FalseSessionPromptPersist | null;
};

export function loadStudyArenaPersisted(): StudyArenaPersistedPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STUDY_ARENA_PERSIST_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as StudyArenaPersistedPayload;
    if (p?.v !== 1 || typeof p.savedAtMs !== "number") return null;
    return p;
  } catch {
    return null;
  }
}

export function saveStudyArenaPersisted(payload: StudyArenaPersistedPayload): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STUDY_ARENA_PERSIST_KEY, JSON.stringify(payload));
    window.dispatchEvent(new Event(STUDY_ARENA_PERSIST_CHANGED));
  } catch {
    /* quota */
  }
}

export function clearStudyArenaPersisted(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STUDY_ARENA_PERSIST_KEY);
    window.dispatchEvent(new Event(STUDY_ARENA_PERSIST_CHANGED));
  } catch {
    /* ignore */
  }
}

/** Ajusta tiempos tras hidratar en otro dispositivo o tras cierre de pestaña. */
export function rehydrateActiveSession(
  s: SerializedArenaActiveSession,
  savedAtMs: number,
): SerializedArenaActiveSession {
  const now = Date.now();
  const drift = Math.max(0, now - savedAtMs);
  if (s.paused || s.segmentStartMs == null) {
    return { ...s, lastInteractionMs: now };
  }
  return {
    ...s,
    segmentStartMs: now,
    elapsedActiveMs: s.elapsedActiveMs + drift,
    lastInteractionMs: now,
  };
}
