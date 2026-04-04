"use client";

import { requestCloudSyncPush } from "@/lib/cloud-sync-push";

export const STUDY_ARENA_STORAGE_KEY = "iestudio-study-arena-state";
export const STUDY_ARENA_CHANGED_EVENT = "iestudio-study-arena-changed";

export type StudyArenaStoredState = {
  activeSession: unknown;
  falseSessionPrompt: unknown;
  suppressFloatingWidget: boolean;
};

export function loadStudyArenaState(): StudyArenaStoredState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STUDY_ARENA_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StudyArenaStoredState>;
    return {
      activeSession: parsed.activeSession ?? null,
      falseSessionPrompt: parsed.falseSessionPrompt ?? null,
      suppressFloatingWidget: Boolean(parsed.suppressFloatingWidget),
    };
  } catch {
    return null;
  }
}

let arenaPushDebounce: ReturnType<typeof setTimeout> | null = null;

export function saveStudyArenaState(state: StudyArenaStoredState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STUDY_ARENA_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore quota failures; arena continues in-memory.
  }
  window.dispatchEvent(new Event(STUDY_ARENA_CHANGED_EVENT));
  if (arenaPushDebounce) clearTimeout(arenaPushDebounce);
  arenaPushDebounce = setTimeout(() => {
    arenaPushDebounce = null;
    requestCloudSyncPush();
  }, 2500);
}
