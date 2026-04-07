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
import { filterCoursesByMode } from "@/lib/blackboard-api";
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
      upcomingEntregas: (parsed.upcomingEntregas as unknown[])?.length ?? 0,
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

/** Misma lógica que el widget «Entregas / Próximas 3» del dashboard (`DashboardOverviewPanel`). */
function buildUpcomingEntregasWidgetRows(): Array<{
  id: string;
  courseName: string;
  title: string;
  dueIso: string | null;
  relLabel: string;
  relTone: string;
}> {
  if (typeof window === "undefined") return [];
  try {
    const snap = readBbDisplayedCoursesSnapshot();
    if (!snap.hasConfig) return [];
    const now = Date.now();
    const semesterCourses = filterCoursesByMode(snap.curatedCourses, "__auto__");
    const byId = new Map(semesterCourses.map((c) => [c.learnCourseId, c]));

    type Tmp = {
      key: string;
      courseName: string;
      title: string;
      dueIso: string | null;
      creationMs: number | null;
      light: "red" | "yellow";
    };

    const out: Tmp[] = [];
    for (const c of semesterCourses) {
      const gb = loadBbGradebook(c.learnCourseId);
      const cols = gb?.columns ?? [];
      for (const col of cols) {
        const due = col.grading?.due;
        const light = getSubmissionLight(
          col.submissionReason,
          col.submissionSubmitted,
        );
        if (light !== "red" && light !== "yellow") continue;

        const courseName = byId.get(c.learnCourseId)?.name ?? c.name;
        const title =
          (col.displayName ?? col.name ?? "Entrega").trim() || "Entrega";
        if (due) {
          const t = new Date(due).getTime();
          if (Number.isNaN(t)) continue;
          if (t < now) continue;
          out.push({
            key: `${c.learnCourseId}\u0000${col.id}`,
            courseName,
            title,
            dueIso: due,
            creationMs: null,
            light,
          });
        } else {
          const contentId = col.contentId ? String(col.contentId) : null;
          const creationMs =
            contentId != null
              ? loadBbContentFirstLastModifiedMs(c.learnCourseId, contentId)
              : null;
          out.push({
            key: `${c.learnCourseId}\u0000${col.id}`,
            courseName,
            title,
            dueIso: null,
            creationMs,
            light,
          });
        }
      }
    }

    const dueTs = (iso: string): number | null => {
      const t = new Date(iso).getTime();
      return Number.isNaN(t) ? null : t;
    };
    const relativeDue = (
      iso: string,
    ): { label: string; tone: "red" | "amber" | "default" } => {
      const t = dueTs(iso);
      if (t == null) return { label: "—", tone: "default" };
      const diff = t - Date.now();
      const mins = Math.round(diff / 60_000);
      const hrs = Math.round(diff / 3_600_000);
      const days = Math.round(diff / 86_400_000);
      if (mins < 0) return { label: "Vencida", tone: "red" };
      if (mins < 90) return { label: `En ${Math.max(1, mins)} min`, tone: "red" };
      if (hrs < 30)
        return { label: `En ${Math.max(1, hrs)} h`, tone: "amber" };
      return { label: `En ${Math.max(1, days)} d`, tone: "default" };
    };

    const withDue = out
      .filter((x) => x.dueIso)
      .sort((a, b) => (dueTs(a.dueIso!) ?? 0) - (dueTs(b.dueIso!) ?? 0));
    const noDue = out
      .filter((x) => !x.dueIso)
      .sort((a, b) => {
        const am = a.creationMs ?? -1;
        const bm = b.creationMs ?? -1;
        return bm - am;
      });
    const top = [...withDue, ...noDue].slice(0, 3);

    return top.map((it) => {
      const rel = it.dueIso ? relativeDue(it.dueIso) : null;
      const relLabel = rel?.label ?? "Sin fecha";
      const relTone = rel
        ? rel.tone
        : it.light === "red"
          ? "red"
          : "amber";
      const idSafe = it.key.split("\u0000").join("::");
      return {
        id: idSafe,
        courseName: it.courseName,
        title: it.title,
        dueIso: it.dueIso,
        relLabel,
        relTone,
      };
    });
  } catch {
    return [];
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
  const upcomingEntregas = buildUpcomingEntregasWidgetRows();

  return JSON.stringify({
    deadlines,
    todaySessions,
    activeSession,
    bbDeliveries,
    upcomingEntregas,
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
