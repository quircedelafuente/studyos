"use client";

import { Capacitor } from "@capacitor/core";
import {
  dailyRingMetaFromTasks,
  DAILY_CHECKLIST_STORAGE_KEY,
  loadChecklistTasks,
} from "@/lib/daily-checklist-storage";
import { HABITS_STORAGE_KEY } from "@/lib/habits-storage";
import { HABIT_LOGS_STORAGE_KEY } from "@/lib/habit-logs-storage";
import { loadImportantDeadlines } from "@/lib/deadlines-storage";
import { buildStudyTrendChartData } from "@/lib/study-trend-chart-data";
import { loadStudyPlans } from "@/lib/study-plans-storage";
import { formatLocalYmd } from "@/lib/study-plan-loose-parse";
import { loadStudyArenaState } from "@/lib/study-arena-storage";
import {
  filterCoursesByMode,
  resolveGradebookColumnUltraUrl,
} from "@/lib/blackboard-api";
import {
  loadBbGradebook,
  loadBbContentFirstLastModifiedMs,
} from "@/lib/blackboard-storage";
import { readBbDisplayedCoursesSnapshot } from "@/lib/bb-displayed-courses";
import { getSubmissionLight } from "@/lib/blackboard-submission-status";

function isCapacitorIOS(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleWidgetSync(delayMs = 2000): void {
  if (!isCapacitorIOS()) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void syncWidgetData();
  }, delayMs);
}

export async function syncWidgetData(): Promise<void> {
  if (!isCapacitorIOS()) {
    console.log("[WidgetDataSync] skip — not Capacitor iOS");
    return;
  }

  try {
    const { default: WidgetData } = await import("@/plugins/WidgetDataPlugin");
    try {
      const raw =
        typeof window !== "undefined"
          ? window.localStorage.getItem(DAILY_CHECKLIST_STORAGE_KEY) ?? '{"v":1,"tasks":[]}'
          : '{"v":1,"tasks":[]}';
      await WidgetData.syncDailyChecklistMirror({ json: raw });
    } catch (e) {
      console.warn("[WidgetDataSync] checklist mirror:", e);
    }
    try {
      const habitsRaw =
        typeof window !== "undefined"
          ? window.localStorage.getItem(HABITS_STORAGE_KEY) ?? '{"v":1,"habits":[]}'
          : '{"v":1,"habits":[]}';
      const logsRaw =
        typeof window !== "undefined"
          ? window.localStorage.getItem(HABIT_LOGS_STORAGE_KEY) ??
            '{"v":1,"byPeriod":{}}'
          : '{"v":1,"byPeriod":{}}';
      await WidgetData.syncHabitsMirror({ json: habitsRaw });
      await WidgetData.syncHabitLogsMirror({ json: logsRaw });
    } catch (e) {
      console.warn("[WidgetDataSync] habits mirrors:", e);
    }
    const json = buildWidgetJson();
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const ring = parsed.dailyTasksRing as
      | { pct?: number; empty?: boolean; done?: number; total?: number }
      | undefined;
    console.log("[WidgetDataSync] syncing →", {
      deadlines: (parsed.deadlines as unknown[])?.length ?? 0,
      todaySessions: (parsed.todaySessions as unknown[])?.length ?? 0,
      activeSession: parsed.activeSession !== null,
      bbDeliveries: (parsed.bbDeliveries as unknown[])?.length ?? 0,
      studyTrend: (parsed.studyTrend as unknown[])?.length ?? 0,
      dailyTasksRing: ring
        ? {
            pct: ring.pct,
            empty: ring.empty,
            done: ring.done,
            total: ring.total,
          }
        : null,
    });
    await WidgetData.sync({ json });
    console.log("[WidgetDataSync] ✅ sync OK");
  } catch (e) {
    console.error("[WidgetDataSync] ❌ sync failed:", e);
  }
}

function buildWidgetJson(): string {
  const todayYmd = formatLocalYmd(new Date());

  // ── Deadlines ──────────────────────────────────────────────────────────────
  const allDeadlines = loadImportantDeadlines();
  const nowMs = Date.now();
  const deadlines = allDeadlines
    .filter((d) => {
      const t = new Date(d.date + "T23:59:59").getTime();
      return t >= nowMs - 86400000; // include today
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 10)
    .map((d) => ({
      id: d.id,
      title: d.title,
      subject: d.courseId ?? "",
      date: d.date,
      isExam: false,
      urgency: urgencyForDate(d.date),
    }));

  // ── Today sessions ─────────────────────────────────────────────────────────
  const plans = loadStudyPlans();
  const todaySessions: object[] = [];
  for (const p of plans) {
    if (!p.aiSchedule?.savedAt) continue;
    for (const d of p.aiSchedule?.days ?? []) {
      if (d?.date !== todayYmd) continue;
      todaySessions.push({
        id: `${p.id}::${d.date}`,
        sessionTitle: d.sessionTitle ?? "Sesión de estudio",
        planTitle: p.title,
        studyHours: finiteNumber(Number(d.studyHours), 0),
        focus: d.focus ?? "",
        date: d.date,
      });
    }
  }

  // ── Active session ─────────────────────────────────────────────────────────
  let activeSession: object | null = null;
  const arenaRaw = loadStudyArenaState();
  if (arenaRaw?.activeSession) {
    const s = arenaRaw.activeSession as Record<string, unknown>;
    if (s && typeof s.sessionTitle === "string") {
      const elapsedMs =
        s.paused || !s.segmentStartMs
          ? Number(s.elapsedActiveMs ?? 0)
          : Number(s.elapsedActiveMs ?? 0) + (nowMs - Number(s.segmentStartMs));
      const totalMs = Number(s.totalDurationMs ?? 3600000);
      const endMs = nowMs + Math.max(0, totalMs - elapsedMs);
      activeSession = {
        sessionTitle: s.sessionTitle ?? "Sesión de estudio",
        planTitle: s.planTitle ?? "",
        focusScore: Number(s.focusScore ?? 100),
        distractionCount: Number(s.distractionCount ?? 0),
        elapsedActiveMs: elapsedMs,
        totalDurationMs: totalMs,
        endTimestampMs: endMs,
        isPaused: Boolean(s.paused),
      };
    }
  }

  // ── BB deliveries ──────────────────────────────────────────────────────────
  const bbDeliveries: object[] = [];
  try {
    const snapshot = readBbDisplayedCoursesSnapshot();
    const courses = snapshot.displayedCourses;
    for (const c of courses) {
      if (!c.learnCourseId) continue;
      const gb = loadBbGradebook(c.learnCourseId);
      if (!gb) continue;
      for (const col of gb.columns ?? []) {
        const dueIso = col.grading?.due;
        if (!dueIso) continue;
        const dueMs = new Date(dueIso).getTime();
        if (dueMs < nowMs - 86400000 || dueMs > nowMs + 14 * 86400000) continue;
        const light = getSubmissionLight(col.submissionReason, col.submissionSubmitted);
        if (light === "green") continue;
        bbDeliveries.push({
          id: `${c.learnCourseId}::${col.id}`,
          courseName: c.name ?? c.learnCourseId,
          title: col.name ?? col.displayName ?? "Entrega",
          dueDate: dueIso,
          urgency: light === "red" ? "red" : "yellow",
        });
      }
    }
    bbDeliveries.sort((a: any, b: any) => a.dueDate.localeCompare(b.dueDate));
    bbDeliveries.splice(10);
  } catch {
    // BB data unavailable — skip
  }

  const studyTrend = buildStudyTrendChartData();
  const dailyTasksRing = dailyRingMetaFromTasks(loadChecklistTasks());

  return JSON.stringify({
    deadlines,
    todaySessions,
    activeSession,
    bbDeliveries,
    studyTrend,
    dailyTasksRing,
    lastUpdated: nowMs,
  });
}

function finiteNumber(n: number, fallback = 0): number {
  return Number.isFinite(n) ? n : fallback;
}

function urgencyForDate(dateYmd: string): string {
  const days = Math.round(
    (new Date(dateYmd + "T12:00:00").getTime() - Date.now()) / 86400000,
  );
  if (days <= 2) return "red";
  if (days <= 7) return "yellow";
  return "normal";
}
