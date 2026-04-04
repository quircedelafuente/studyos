import { MANUAL_COURSES_STORAGE_KEY } from "@/lib/manual-courses-storage";
import { STUDY_PLANS_CHANGED_EVENT } from "@/lib/study-plans-storage";
import { PARKING_LOT_CHANGED_EVENT } from "@/lib/parking-lot-storage";
import { DEADLINES_CHANGED_EVENT } from "@/lib/deadlines-storage";
import { DEADLINE_TAGS_CHANGED_EVENT } from "@/lib/deadline-tags-storage";
import { STUDY_MICROTASKS_CHANGED_EVENT } from "@/lib/study-microtasks-storage";
import {
  BB_COURSES_STORAGE_CHANGED,
  BB_GRADEBOOK_STORAGE_CHANGED,
  BB_CONTENT_META_CHANGED,
} from "@/lib/blackboard-storage";
import { BB_COURSE_FILTER_CHANGED } from "@/lib/bb-course-filter-prefs";
import { BB_COURSE_CURATION_CHANGED } from "@/lib/bb-course-curation";
import { BB_CONFIG_CHANGED } from "@/lib/blackboard-config";

const SYNC_PREFIX = "iestudio-";

/** Dispara un push inmediato (escucha `UserCloudSync`). */
export const IESTUDIO_CLOUD_PUSH_REQUEST = "iestudio-cloud-push-request";

/** Último `updated_at` del servidor que aplicamos en local (ISO). Evita pisar datos nuevos con un cliente obsoleto. */
export const CLOUD_SERVER_APPLIED_AT_KEY = "iestudio-cloud-server-applied-at";

/** Claves que nunca se suben a la nube (documentos / archivos de cursos en este navegador). */
const CLOUD_EXCLUDE = new Set<string>([MANUAL_COURSES_STORAGE_KEY]);

export function getCloudServerAppliedAt(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(CLOUD_SERVER_APPLIED_AT_KEY);
  } catch {
    return null;
  }
}

export function setCloudServerAppliedAt(iso: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CLOUD_SERVER_APPLIED_AT_KEY, iso);
  } catch {
    /* ignore */
  }
}

export function requestCloudSyncPush(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(IESTUDIO_CLOUD_PUSH_REQUEST));
}

export function collectSyncableEntries(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(SYNC_PREFIX)) continue;
    if (CLOUD_EXCLUDE.has(k)) continue;
    const v = localStorage.getItem(k);
    if (v !== null) out[k] = v;
  }
  return out;
}

function stableSnapshot(entries: Record<string, string>): string {
  const keys = Object.keys(entries).sort();
  return keys.map((k) => `${k}\u001f${entries[k]}`).join("\u001e");
}

export function syncSnapshotSignature(entries: Record<string, string>): string {
  return stableSnapshot(entries);
}

export function normalizeCloudPayload(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== "string" || !k.startsWith(SYNC_PREFIX)) continue;
    if (CLOUD_EXCLUDE.has(k)) continue;
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export function sanitizeEntriesForUpload(
  entries: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(entries)) {
    if (!k.startsWith(SYNC_PREFIX) || CLOUD_EXCLUDE.has(k)) continue;
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * Sustituye en localStorage todas las claves sincronizables por el estado del servidor.
 * No toca `iestudio-manual-courses` ni blobs en IndexedDB.
 */
export function applyCloudEntries(entries: Record<string, string>): void {
  if (typeof window === "undefined") return;
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(SYNC_PREFIX)) continue;
    if (CLOUD_EXCLUDE.has(k)) continue;
    toRemove.push(k);
  }
  for (const k of toRemove) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
  const clean = normalizeCloudPayload(entries);
  for (const [k, v] of Object.entries(clean)) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* quota */
    }
  }
  dispatchCloudRefreshEvents();
}

export function dispatchCloudRefreshEvents(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(STUDY_PLANS_CHANGED_EVENT));
  window.dispatchEvent(new CustomEvent(PARKING_LOT_CHANGED_EVENT));
  window.dispatchEvent(new CustomEvent(DEADLINES_CHANGED_EVENT));
  window.dispatchEvent(new CustomEvent(DEADLINE_TAGS_CHANGED_EVENT));
  window.dispatchEvent(new CustomEvent(STUDY_MICROTASKS_CHANGED_EVENT));
  window.dispatchEvent(new Event(BB_COURSES_STORAGE_CHANGED));
  window.dispatchEvent(new Event(BB_GRADEBOOK_STORAGE_CHANGED));
  window.dispatchEvent(new Event(BB_CONTENT_META_CHANGED));
  window.dispatchEvent(new Event(BB_COURSE_FILTER_CHANGED));
  window.dispatchEvent(new Event(BB_COURSE_CURATION_CHANGED));
  window.dispatchEvent(new Event(BB_CONFIG_CHANGED));
}
