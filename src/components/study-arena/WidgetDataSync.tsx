"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";
import { scheduleWidgetSync, syncWidgetData } from "@/lib/widget-data-sync";
import {
  DAILY_CHECKLIST_CHANGED_EVENT,
  DAILY_CHECKLIST_STORAGE_KEY,
  reconcileChecklistFromAppGroupIfIos,
} from "@/lib/daily-checklist-storage";
import { reconcileHabitsFromAppGroupIfIos } from "@/lib/habits-storage";
import { reconcileHabitLogsFromAppGroupIfIos } from "@/lib/habit-logs-storage";
import { DEADLINES_CHANGED_EVENT } from "@/lib/deadlines-storage";
import { STUDY_PLANS_CHANGED_EVENT } from "@/lib/study-plans-storage";
import { STUDY_ARENA_CHANGED_EVENT } from "@/lib/study-arena-storage";
import { BB_GRADEBOOK_STORAGE_CHANGED, BB_COURSES_STORAGE_CHANGED } from "@/lib/blackboard-storage";
import { useStudyArena } from "@/components/study-arena/StudyArenaProvider";
import { HABITS_CHANGED_EVENT, HABITS_STORAGE_KEY } from "@/lib/habits-storage";
import { HABIT_LOGS_CHANGED_EVENT, HABIT_LOGS_STORAGE_KEY } from "@/lib/habit-logs-storage";
import { rescheduleHabitRemindersIos } from "@/lib/habit-notifications";

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
    /** Sin debounce: mirrors interactivos deben ir al App Group al instante. */
    const immediateSync = () => {
      void syncWidgetData();
    };
    const onCrossTabStorage = (e: StorageEvent) => {
      if (
        e.key === DAILY_CHECKLIST_STORAGE_KEY ||
        e.key === HABITS_STORAGE_KEY ||
        e.key === HABIT_LOGS_STORAGE_KEY
      ) {
        void syncWidgetData();
      }
    };

    window.addEventListener(DEADLINES_CHANGED_EVENT, handler);
    window.addEventListener(DAILY_CHECKLIST_CHANGED_EVENT, immediateSync);
    window.addEventListener("storage", onCrossTabStorage);
    window.addEventListener(STUDY_PLANS_CHANGED_EVENT, handler);
    window.addEventListener(STUDY_ARENA_CHANGED_EVENT, handler);
    window.addEventListener(BB_GRADEBOOK_STORAGE_CHANGED, handler);
    window.addEventListener(BB_COURSES_STORAGE_CHANGED, handler);
    window.addEventListener(HABITS_CHANGED_EVENT, immediateSync);
    window.addEventListener(HABIT_LOGS_CHANGED_EVENT, immediateSync);

    return () => {
      window.removeEventListener(DEADLINES_CHANGED_EVENT, handler);
      window.removeEventListener(DAILY_CHECKLIST_CHANGED_EVENT, immediateSync);
      window.removeEventListener("storage", onCrossTabStorage);
      window.removeEventListener(STUDY_PLANS_CHANGED_EVENT, handler);
      window.removeEventListener(STUDY_ARENA_CHANGED_EVENT, handler);
      window.removeEventListener(BB_GRADEBOOK_STORAGE_CHANGED, handler);
      window.removeEventListener(BB_COURSES_STORAGE_CHANGED, handler);
      window.removeEventListener(HABITS_CHANGED_EVENT, immediateSync);
      window.removeEventListener(HABIT_LOGS_CHANGED_EVENT, immediateSync);
    };
  }, []);

  // Habits: reprogramar recordatorios (iOS) cuando cambian hábitos o logs
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "ios") return;
    const h = () => {
      void rescheduleHabitRemindersIos();
    };
    window.addEventListener(HABITS_CHANGED_EVENT, h);
    window.addEventListener(HABIT_LOGS_CHANGED_EVENT, h);
    return () => {
      window.removeEventListener(HABITS_CHANGED_EVENT, h);
      window.removeEventListener(HABIT_LOGS_CHANGED_EVENT, h);
    };
  }, []);

  // Al volver al primer plano, refrescar por si se perdió algún evento en background.
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "ios") return;
    let handle: PluginListenerHandle | undefined;
    let cancelled = false;
    void import("@capacitor/app").then(({ App }) => {
      if (cancelled) return;
      void App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) {
          void (async () => {
            await reconcileChecklistFromAppGroupIfIos();
            await reconcileHabitsFromAppGroupIfIos();
            await reconcileHabitLogsFromAppGroupIfIos();
          })().finally(() => {
            void syncWidgetData();
          });
        }
      }).then((h) => {
        handle = h;
      });
    });
    return () => {
      cancelled = true;
      void handle?.remove();
    };
  }, []);

  return null;
}
