"use client";

import { requestCloudSyncPush } from "@/lib/cloud-sync-push";

export const STUDY_ARENA_COMPLETED_STORAGE_KEY = "iestudio-study-arena-completed";
export const STUDY_ARENA_COMPLETED_CHANGED_EVENT = "iestudio-study-arena-completed-changed";

export type CompletedSession = {
  /** Unique id per completion (not per session option — same session can be redone). */
  completionId: string;
  completedAt: string; // ISO timestamp
  /** Unique id per run — used to look up Parking Lot notes. */
  arenaRunId: string;

  // Session option fields
  key: string;
  planId: string;
  planTitle: string;
  date: string; // YYYY-MM-DD
  studyHours: number;
  focus: string;
  sessionTitle?: string;

  // Metrics
  focusScore: number; // 0-100
  distractionCount: number;
  elapsedActiveMs: number;
  totalDurationMs: number;
  startedAtMs: number;
};

const MAX_COMPLETED_SESSIONS = 200;

function isCompletedSession(x: unknown): x is CompletedSession {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.completionId === "string" &&
    typeof o.completedAt === "string" &&
    typeof o.arenaRunId === "string" &&
    typeof o.key === "string" &&
    typeof o.planId === "string" &&
    typeof o.planTitle === "string" &&
    typeof o.date === "string" &&
    typeof o.studyHours === "number" &&
    typeof o.focus === "string" &&
    typeof o.focusScore === "number" &&
    typeof o.distractionCount === "number" &&
    typeof o.elapsedActiveMs === "number" &&
    typeof o.totalDurationMs === "number" &&
    typeof o.startedAtMs === "number"
  );
}

export function loadCompletedSessions(): CompletedSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STUDY_ARENA_COMPLETED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCompletedSession);
  } catch {
    return [];
  }
}

let completedPushDebounce: ReturnType<typeof setTimeout> | null = null;

function saveCompletedSessionsList(sessions: CompletedSession[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STUDY_ARENA_COMPLETED_STORAGE_KEY,
      JSON.stringify(sessions),
    );
    window.dispatchEvent(new CustomEvent(STUDY_ARENA_COMPLETED_CHANGED_EVENT));
  } catch {
    // quota
  }
  if (completedPushDebounce) clearTimeout(completedPushDebounce);
  completedPushDebounce = setTimeout(() => {
    completedPushDebounce = null;
    requestCloudSyncPush();
  }, 2500);
}

export function deleteCompletedSession(completionId: string): void {
  const existing = loadCompletedSessions();
  saveCompletedSessionsList(existing.filter((s) => s.completionId !== completionId));
}

export function saveCompletedSession(session: Omit<CompletedSession, "completionId" | "completedAt">): void {
  const record: CompletedSession = {
    ...session,
    completionId: crypto.randomUUID(),
    completedAt: new Date().toISOString(),
  };
  const existing = loadCompletedSessions();
  // Prepend newest first, cap at MAX
  const next = [record, ...existing].slice(0, MAX_COMPLETED_SESSIONS);
  saveCompletedSessionsList(next);
}
