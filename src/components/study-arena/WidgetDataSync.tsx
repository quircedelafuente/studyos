"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { scheduleWidgetSync, syncWidgetData } from "@/lib/widget-data-sync";
import { DEADLINES_CHANGED_EVENT } from "@/lib/deadlines-storage";
import { STUDY_PLANS_CHANGED_EVENT } from "@/lib/study-plans-storage";
import { STUDY_ARENA_CHANGED_EVENT } from "@/lib/study-arena-storage";
import { BB_GRADEBOOK_STORAGE_CHANGED, BB_COURSES_STORAGE_CHANGED } from "@/lib/blackboard-storage";
import { useStudyArena } from "@/components/study-arena/StudyArenaProvider";

/**
 * Mounts once inside AppProviders (iOS only).
 * Syncs widget data to App Group UserDefaults whenever relevant data changes.
 */
export function WidgetDataSync() {
  const { activeSession, focusScore, distractionCount, paused } = useStudyArena();

  // Initial sync on mount
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "ios") return;
    void syncWidgetData();
  }, []);

  // Sync when active session changes (timer/focus/distractions)
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "ios") return;
    scheduleWidgetSync(500);
  }, [activeSession?.arenaRunId, focusScore, distractionCount, paused]);

  // Sync when storage events fire (deadlines, plans, BB)
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "ios") return;

    const handler = () => scheduleWidgetSync(1500);

    window.addEventListener(DEADLINES_CHANGED_EVENT, handler);
    window.addEventListener(STUDY_PLANS_CHANGED_EVENT, handler);
    window.addEventListener(STUDY_ARENA_CHANGED_EVENT, handler);
    window.addEventListener(BB_GRADEBOOK_STORAGE_CHANGED, handler);
    window.addEventListener(BB_COURSES_STORAGE_CHANGED, handler);

    return () => {
      window.removeEventListener(DEADLINES_CHANGED_EVENT, handler);
      window.removeEventListener(STUDY_PLANS_CHANGED_EVENT, handler);
      window.removeEventListener(STUDY_ARENA_CHANGED_EVENT, handler);
      window.removeEventListener(BB_GRADEBOOK_STORAGE_CHANGED, handler);
      window.removeEventListener(BB_COURSES_STORAGE_CHANGED, handler);
    };
  }, []);

  return null;
}
