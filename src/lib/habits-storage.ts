import type {
  HabitDefinition,
  HabitKind,
  HabitReminder,
  HabitSchedule,
  HabitTargetMode,
} from "@/types/dashboard";
import { requestCloudSyncPushDebounced } from "@/lib/cloud-sync-push";
import { normalizeHabitSchedule } from "@/lib/habits-schedule";
import { Capacitor } from "@capacitor/core";

export const HABITS_STORAGE_KEY = "iestudio-habits-v1";
export const HABITS_CHANGED_EVENT = "iestudio-habits-changed";

type HabitFile = { v: 1; habits: HabitDefinition[] };

function isIsoString(x: unknown): x is string {
  return typeof x === "string" && x.length >= 10;
}

function normalizeReminder(raw: unknown): HabitReminder | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const enabled = Boolean(o.enabled);
  const timeLocal = typeof o.timeLocal === "string" ? o.timeLocal : "09:00";
  const message = typeof o.message === "string" ? o.message : "";
  return { enabled, timeLocal, message };
}

function normalizeKind(raw: unknown): HabitKind {
  return raw === "measure" ? "measure" : "check";
}

function normalizeTargetMode(raw: unknown): HabitTargetMode {
  return raw === "exact" ? "exact" : "at_least";
}

function toHabit(x: unknown): HabitDefinition | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.title !== "string") return null;
  const schedule = normalizeHabitSchedule(o.schedule);
  if (!schedule) return null;
  const kind = normalizeKind(o.kind);
  const nowIso = new Date().toISOString();
  const createdAt = isIsoString(o.createdAt) ? o.createdAt : nowIso;
  const updatedAt = isIsoString(o.updatedAt) ? o.updatedAt : createdAt;
  const unit = typeof o.unit === "string" && o.unit.trim() ? o.unit.trim() : undefined;
  const targetRaw = (o as any).target;
  const target =
    typeof targetRaw === "number" && Number.isFinite(targetRaw) ? targetRaw : null;
  const targetMode = normalizeTargetMode((o as any).targetMode);
  const reminder = normalizeReminder(o.reminder);
  const archived = Boolean(o.archived);
  return {
    id: o.id,
    title: o.title.trim() || "(Sin título)",
    kind,
    schedule: schedule as HabitSchedule,
    ...(unit ? { unit } : {}),
    ...(kind === "measure" ? { target, targetMode } : {}),
    ...(reminder ? { reminder } : {}),
    createdAt,
    updatedAt,
    ...(archived ? { archived: true } : {}),
  };
}

export function loadHabits(): HabitDefinition[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HABITS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return [];
    const o = parsed as Record<string, unknown>;
    if (o.v !== 1 || !Array.isArray(o.habits)) return [];
    const out: HabitDefinition[] = [];
    for (const item of o.habits) {
      const h = toHabit(item);
      if (h) out.push(h);
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch {
    return [];
  }
}

export function saveHabits(habits: HabitDefinition[]): void {
  if (typeof window === "undefined") return;
  const payload: HabitFile = { v: 1, habits };
  try {
    window.localStorage.setItem(HABITS_STORAGE_KEY, JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent(HABITS_CHANGED_EVENT));
    requestCloudSyncPushDebounced();
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios") {
      void import("@/plugins/WidgetDataPlugin")
        .then(({ default: WidgetData }) => WidgetData.syncHabitsMirror({ json: JSON.stringify(payload) }))
        .catch(() => {});
    }
  } catch {
    // quota
  }
}

export function createHabitDraft(): HabitDefinition {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "",
    kind: "check",
    schedule: { mode: "weekdays", weekdays: [1, 2, 3, 4, 5] },
    reminder: { enabled: false, timeLocal: "09:00", message: "" },
    createdAt: now,
    updatedAt: now,
  };
}

export function upsertHabit(next: HabitDefinition): void {
  const all = loadHabits();
  const idx = all.findIndex((h) => h.id === next.id);
  const now = new Date().toISOString();
  const normalized: HabitDefinition = {
    ...next,
    title: next.title.trim() || "(Sin título)",
    updatedAt: now,
  };
  if (idx === -1) {
    saveHabits([...all, normalized]);
  } else {
    const copy = [...all];
    copy[idx] = normalized;
    saveHabits(copy);
  }
}

export function deleteHabit(id: string): void {
  saveHabits(loadHabits().filter((h) => h.id !== id));
}

export async function reconcileHabitsFromAppGroupIfIos(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "ios") return false;
  try {
    const { default: WidgetData } = await import("@/plugins/WidgetDataPlugin");
    const r = await WidgetData.reconcileHabitsFromAppGroup();
    const mirror = r.mirror as string | null | undefined;
    if (!mirror || typeof mirror !== "string") return false;
    const cur = window.localStorage.getItem(HABITS_STORAGE_KEY) ?? "";
    if (cur === mirror) return false;

    /**
     * IMPORTANTE:
     * El App Group (widget) NO es la fuente de verdad para *definiciones* de hábitos:
     * el widget interactivo solo escribe logs. Si aplicamos el mirror sin comprobar,
     * podemos pisar hábitos recién creados (localStorage) con un mirror viejo.
     *
     * Política segura:
     * - Solo rellenar desde App Group si localStorage está vacío.
     * - Si ya hay hábitos locales, NO sobrescribir (evita “se añaden y se quitan”).
     */
    const localHasHabits = loadHabits().length > 0;
    if (localHasHabits) return false;

    window.localStorage.setItem(HABITS_STORAGE_KEY, mirror);
    window.dispatchEvent(new CustomEvent(HABITS_CHANGED_EVENT));
    requestCloudSyncPushDebounced();
    return true;
  } catch {
    return false;
  }
}

