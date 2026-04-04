import { splitFocusIntoItems } from "@/lib/study-plan-loose-parse";

export const STUDY_MICROTASKS_STORAGE_KEY = "iestudio-study-microtasks-checked";

export const STUDY_MICROTASKS_CHANGED_EVENT = "iestudio-study-microtasks-changed";

/** Clave estable por sesión de plan+día (coincide con StudyArenaSessionOption.key). */
function storageKeyForSession(sessionKey: string): string {
  return `microtasks::${sessionKey}`;
}

function loadRaw(): Record<string, number[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STUDY_MICROTASKS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object") return {};
    const out: Record<string, number[]> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(v)) continue;
      const nums = v.filter((x): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0);
      out[k] = nums;
    }
    return out;
  } catch {
    return {};
  }
}

function saveRaw(data: Record<string, number[]>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STUDY_MICROTASKS_STORAGE_KEY, JSON.stringify(data));
    window.dispatchEvent(new CustomEvent(STUDY_MICROTASKS_CHANGED_EVENT));
  } catch {
    // quota
  }
}

export function buildMicroTaskLabels(focus: string): string[] {
  const items = splitFocusIntoItems(focus ?? "");
  if (items.length > 0) return items;
  return ["Completar el bloque de estudio de hoy"];
}

export function getCheckedTaskIndices(sessionKey: string): Set<number> {
  const raw = loadRaw();
  const arr = raw[storageKeyForSession(sessionKey)] ?? [];
  return new Set(arr);
}

export function setCheckedTaskIndices(sessionKey: string, checked: Set<number>): void {
  const raw = loadRaw();
  raw[storageKeyForSession(sessionKey)] = [...checked].sort((a, b) => a - b);
  saveRaw(raw);
}

export function toggleMicroTaskChecked(sessionKey: string, taskIndex: number, checked: boolean): void {
  const set = getCheckedTaskIndices(sessionKey);
  if (checked) set.add(taskIndex);
  else set.delete(taskIndex);
  setCheckedTaskIndices(sessionKey, set);
}
