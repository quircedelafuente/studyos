import type { HabitLogEntry } from "@/types/dashboard";
import { requestCloudSyncPushDebounced } from "@/lib/cloud-sync-push";
import { Capacitor } from "@capacitor/core";

export const HABIT_LOGS_STORAGE_KEY = "iestudio-habit-logs-v1";
export const HABIT_LOGS_CHANGED_EVENT = "iestudio-habit-logs-changed";

type HabitLogsFile = {
  v: 1;
  /** periodKey -> habitId -> entry */
  byPeriod: Record<string, Record<string, HabitLogEntry>>;
};

const EMPTY: HabitLogsFile = { v: 1, byPeriod: {} };

function isEntry(x: unknown): x is HabitLogEntry {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.done !== undefined && typeof o.done !== "boolean") return false;
  if (o.value !== undefined && typeof o.value !== "number") return false;
  return true;
}

export function loadHabitLogsFile(): HabitLogsFile {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(HABIT_LOGS_STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return EMPTY;
    const o = parsed as Record<string, unknown>;
    if (o.v !== 1 || !o.byPeriod || typeof o.byPeriod !== "object") return EMPTY;
    const byPeriod: HabitLogsFile["byPeriod"] = {};
    for (const [pk, bucketRaw] of Object.entries(o.byPeriod as Record<string, unknown>)) {
      if (!bucketRaw || typeof bucketRaw !== "object") continue;
      const b = bucketRaw as Record<string, unknown>;
      const outBucket: Record<string, HabitLogEntry> = {};
      for (const [hid, entryRaw] of Object.entries(b)) {
        if (!isEntry(entryRaw)) continue;
        const e = entryRaw as HabitLogEntry;
        outBucket[hid] = {
          ...(typeof e.done === "boolean" ? { done: e.done } : {}),
          ...(typeof e.value === "number" && Number.isFinite(e.value) ? { value: e.value } : {}),
        };
      }
      byPeriod[pk] = outBucket;
    }
    return { v: 1, byPeriod };
  } catch {
    return EMPTY;
  }
}

export function saveHabitLogsFile(file: HabitLogsFile): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HABIT_LOGS_STORAGE_KEY, JSON.stringify(file));
    window.dispatchEvent(new CustomEvent(HABIT_LOGS_CHANGED_EVENT));
    requestCloudSyncPushDebounced();
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios") {
      void import("@/plugins/WidgetDataPlugin")
        .then(({ default: WidgetData }) => WidgetData.syncHabitLogsMirror({ json: JSON.stringify(file) }))
        .catch(() => {});
    }
  } catch {
    // quota
  }
}

export function getHabitLog(periodKey: string, habitId: string): HabitLogEntry | null {
  const f = loadHabitLogsFile();
  return f.byPeriod[periodKey]?.[habitId] ?? null;
}

export function setHabitLog(periodKey: string, habitId: string, entry: HabitLogEntry): void {
  const f = loadHabitLogsFile();
  const bucket = { ...(f.byPeriod[periodKey] ?? {}) };
  bucket[habitId] = entry;
  saveHabitLogsFile({ v: 1, byPeriod: { ...f.byPeriod, [periodKey]: bucket } });
}

export function patchHabitLog(
  periodKey: string,
  habitId: string,
  patch: Partial<HabitLogEntry>,
): void {
  const prev = getHabitLog(periodKey, habitId) ?? {};
  setHabitLog(periodKey, habitId, { ...prev, ...patch });
}

export async function reconcileHabitLogsFromAppGroupIfIos(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "ios") return false;
  try {
    const { default: WidgetData } = await import("@/plugins/WidgetDataPlugin");
    const r = await WidgetData.reconcileHabitLogsFromAppGroup();
    const mirror = r.mirror as string | null | undefined;
    if (!mirror || typeof mirror !== "string") return false;
    const cur = window.localStorage.getItem(HABIT_LOGS_STORAGE_KEY) ?? "";
    if (cur === mirror) return false;
    window.localStorage.setItem(HABIT_LOGS_STORAGE_KEY, mirror);
    window.dispatchEvent(new CustomEvent(HABIT_LOGS_CHANGED_EVENT));
    requestCloudSyncPushDebounced();
    return true;
  } catch {
    return false;
  }
}

