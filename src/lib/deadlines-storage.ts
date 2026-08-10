import type { ImportantDeadline } from "@/types/dashboard";
import { normalizeGoogleEventColorId } from "@/lib/google-calendar-event-colors";
import { requestCloudSyncPush } from "@/lib/cloud-sync-push";

export const DEADLINES_STORAGE_KEY = "iestudio-important-deadlines";

export const DEADLINES_CHANGED_EVENT = "iestudio-deadlines-changed";

function normalizeTime(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string" || !/^\d{2}:\d{2}$/.test(raw)) return null;
  return raw;
}

function isImportantDeadline(x: unknown): x is ImportantDeadline {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.title !== "string") return false;
  if (typeof o.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) return false;
  if (
    o.courseId !== undefined &&
    o.courseId !== null &&
    typeof o.courseId !== "string"
  ) {
    return false;
  }
  if (typeof o.createdAt !== "string") return false;
  const t = o.time;
  if (t !== undefined && t !== null) {
    if (typeof t !== "string" || !/^\d{2}:\d{2}$/.test(t)) return false;
  }
  if (o.tagIds !== undefined) {
    if (!Array.isArray(o.tagIds) || !o.tagIds.every((x) => typeof x === "string")) return false;
  }
  if (o.calendarColorId !== undefined && typeof o.calendarColorId !== "string") return false;
  return true;
}

function toImportantDeadline(x: unknown): ImportantDeadline | null {
  if (!isImportantDeadline(x)) return null;
  const o = x as Record<string, unknown>;
  const tagIdsRaw = o.tagIds;
  const tagIds =
    Array.isArray(tagIdsRaw) && tagIdsRaw.every((x) => typeof x === "string")
      ? (tagIdsRaw as string[])
      : [];
  const calendarColorId = normalizeGoogleEventColorId(
    typeof o.calendarColorId === "string" ? o.calendarColorId : undefined,
  );
  const durRaw = (o as Record<string, unknown>).durationMinutes;
  const durationMinutes =
    typeof durRaw === "number" && durRaw > 0 ? durRaw : undefined;
  return {
    id: o.id as string,
    title: o.title as string,
    date: o.date as string,
    time: normalizeTime(o.time),
    durationMinutes: durationMinutes ?? null,
    courseId: typeof o.courseId === "string" ? o.courseId : null,
    subject:
      typeof o.subject === "string" && o.subject.trim() ? o.subject.trim() : null,
    tagIds,
    calendarColorId,
    createdAt: o.createdAt as string,
  };
}

export function loadImportantDeadlines(): ImportantDeadline[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DEADLINES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: ImportantDeadline[] = [];
    for (const item of parsed) {
      const d = toImportantDeadline(item);
      if (d) out.push(d);
    }
    return out;
  } catch {
    return [];
  }
}

export function saveImportantDeadlines(deadlines: ImportantDeadline[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEADLINES_STORAGE_KEY, JSON.stringify(deadlines));
    window.dispatchEvent(new CustomEvent(DEADLINES_CHANGED_EVENT));
    requestCloudSyncPush();
  } catch {
    // quota / private mode
  }
}
