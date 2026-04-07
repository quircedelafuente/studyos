import type {
  ChecklistPriority,
  ChecklistTaskItem,
} from "@/types/dashboard";
import { Capacitor } from "@capacitor/core";
import { requestCloudSyncPushDebounced } from "@/lib/cloud-sync-push";

export const DAILY_CHECKLIST_STORAGE_KEY = "iestudio-daily-checklist-v1";

export const DAILY_CHECKLIST_CHANGED_EVENT = "iestudio-daily-checklist-changed";

const EMPTY: ChecklistTaskItem[] = [];

export function normalizeChecklistPriority(raw: unknown): ChecklistPriority {
  if (raw === "green" || raw === "orange" || raw === "red") return raw;
  return "green";
}

function parseTask(item: unknown): ChecklistTaskItem | null {
  if (item === null || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.title !== "string") return null;
  if (typeof o.done !== "boolean") return null;
  if (typeof o.createdAt !== "string") return null;
  if (o.scope !== "day" && o.scope !== "week") return null;
  if (typeof o.periodKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.periodKey)) {
    return null;
  }
  return {
    id: o.id,
    title: o.title,
    done: o.done,
    createdAt: o.createdAt,
    scope: o.scope,
    periodKey: o.periodKey,
    priority: normalizeChecklistPriority(o.priority),
  };
}

export function todayYmdLocal(): string {
  const t = new Date();
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Lunes de la semana local (ISO-week style: semana empieza en lunes). */
export function mondayYmdLocal(d: Date = new Date()): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = x.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  x.setDate(x.getDate() + offset);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Domingo de la misma semana que `mondayYmd` (YYYY-MM-DD). */
export function sundayAfterMondayYmd(mondayYmd: string): string | null {
  const parts = mondayYmd.split("-").map(Number);
  const [y, mo, da] = parts;
  if (!y || !mo || !da) return null;
  const x = new Date(y, mo - 1, da);
  x.setDate(x.getDate() + 6);
  const yy = x.getFullYear();
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Misma lógica que el anillo "Hoy (diarias)" del dashboard / widget. */
export function dailyRingMetaFromTasks(tasks: readonly ChecklistTaskItem[]): {
  pct: number;
  empty: boolean;
  done: number;
  total: number;
} {
  const ymd = todayYmdLocal();
  const todayList = tasks.filter(
    (t) => t.scope === "day" && t.periodKey === ymd,
  );
  const total = todayList.length;
  if (total === 0) {
    return { pct: 0, empty: true, done: 0, total: 0 };
  }
  const done = todayList.filter((t) => t.done).length;
  return {
    pct: Math.round((100 * done) / total),
    empty: false,
    done,
    total,
  };
}

function isCapacitorIos(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

/** Envía el anillo al plugin nativo (vía App Group) al guardar o tras sync en la nube. */
export function pushDailyTasksRingToNativeFromTasks(
  tasks: readonly ChecklistTaskItem[],
): void {
  if (typeof window === "undefined" || !isCapacitorIos()) return;
  const ring = dailyRingMetaFromTasks(tasks);
  void import("@/plugins/WidgetDataPlugin")
    .then(({ default: WidgetData }) =>
      WidgetData.syncDailyTasksRing({ json: JSON.stringify(ring) }),
    )
    .catch((e) => {
      console.warn("[DailyChecklist] syncDailyTasksRing failed:", e);
    });
}

export function pushDailyTasksRingToNativeIfIos(): void {
  if (typeof window === "undefined" || !isCapacitorIos()) return;
  pushDailyTasksRingToNativeFromTasks(loadChecklistTasks());
}

export function loadChecklistTasks(): ChecklistTaskItem[] {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(DAILY_CHECKLIST_STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return EMPTY;
    const o = parsed as Record<string, unknown>;
    if (o.v !== 1 || !Array.isArray(o.tasks)) return EMPTY;
    const out: ChecklistTaskItem[] = [];
    for (const item of o.tasks) {
      const t = parseTask(item);
      if (t) out.push(t);
    }
    return out;
  } catch {
    return EMPTY;
  }
}

function pushChecklistMirrorToNativeIfIos(payload: string): void {
  if (typeof window === "undefined" || !isCapacitorIos()) return;
  void import("@/plugins/WidgetDataPlugin")
    .then(({ default: WidgetData }) => WidgetData.syncDailyChecklistMirror({ json: payload }))
    .catch((e) => {
      console.warn("[DailyChecklist] syncDailyChecklistMirror failed:", e);
    });
}

/** Si el usuario marcó tareas en el widget, fusiona el JSON del App Group en localStorage y dispara sync. */
export async function reconcileChecklistFromAppGroupIfIos(): Promise<boolean> {
  if (typeof window === "undefined" || !isCapacitorIos()) return false;
  try {
    const { default: WidgetData } = await import("@/plugins/WidgetDataPlugin");
    const r = await WidgetData.reconcileChecklistFromAppGroup();
    const mirror = r.mirror as string | null | undefined;
    if (mirror == null || typeof mirror !== "string" || mirror === "") return false;
    const cur = window.localStorage.getItem(DAILY_CHECKLIST_STORAGE_KEY) ?? "";
    if (cur === mirror) return false;
    window.localStorage.setItem(DAILY_CHECKLIST_STORAGE_KEY, mirror);
    window.dispatchEvent(new CustomEvent(DAILY_CHECKLIST_CHANGED_EVENT));
    requestCloudSyncPushDebounced();
    return true;
  } catch {
    return false;
  }
}

export function saveChecklistTasks(tasks: ChecklistTaskItem[]): void {
  if (typeof window === "undefined") return;
  const payload = JSON.stringify({ v: 1, tasks });
  try {
    window.localStorage.setItem(DAILY_CHECKLIST_STORAGE_KEY, payload);
    window.dispatchEvent(new CustomEvent(DAILY_CHECKLIST_CHANGED_EVENT));
    requestCloudSyncPushDebounced();
    pushDailyTasksRingToNativeFromTasks(tasks);
    pushChecklistMirrorToNativeIfIos(payload);
  } catch {
    // quota
  }
}

export function newTaskId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
