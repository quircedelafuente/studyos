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
import { STUDY_ARENA_PERSIST_CHANGED } from "@/lib/study-arena-persist";

const SYNC_PREFIX = "iestudio-";

/** Dispara un push inmediato (escucha `CloudSyncProvider`). */
export const IESTUDIO_CLOUD_PUSH_REQUEST = "iestudio-cloud-push-request";

/** Último `updated_at` del servidor que aplicamos en local (ISO). Evita pisar datos nuevos con un cliente obsoleto. */
export const CLOUD_SERVER_APPLIED_AT_KEY = "iestudio-cloud-server-applied-at";

/** Prefijo de claves Blackboard (PC es la fuente de verdad; en móvil no se suben). */
export const BLACKBOARD_CLOUD_KEY_PREFIX = "iestudio-bb-";

/** Claves que nunca se suben a la nube (documentos / archivos de cursos en este navegador). */
const CLOUD_EXCLUDE = new Set<string>([
  MANUAL_COURSES_STORAGE_KEY,
  CLOUD_SERVER_APPLIED_AT_KEY,
]);

export function isBlackboardCloudKey(key: string): boolean {
  return key.startsWith(BLACKBOARD_CLOUD_KEY_PREFIX);
}

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

/** Misma clave que `blackboard-storage` (COURSES_KEY); solo para heurísticas de sync. */
const BB_COURSES_LOCAL_KEY = "iestudio-bb-courses";

export function clearCloudServerAppliedAt(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(CLOUD_SERVER_APPLIED_AT_KEY);
  } catch {
    /* ignore */
  }
}

/** True si hay al menos un curso BB en caché local (evita saltar pull cuando `applied` ya coincide con el servidor). */
export function localStorageHasBbCoursesCache(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(BB_COURSES_LOCAL_KEY);
    if (!raw) return false;
    const p = JSON.parse(raw) as { courses?: unknown };
    return Array.isArray(p.courses) && p.courses.length > 0;
  } catch {
    return false;
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

/** En móvil no se suben datos de Blackboard (el PC los mantiene); el resto sí. */
export function collectSyncableEntriesForUpload(isMobile: boolean): Record<string, string> {
  const all = collectSyncableEntries();
  if (!isMobile) return all;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(all)) {
    if (isBlackboardCloudKey(k)) continue;
    out[k] = v;
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

/**
 * El JSONB en Neon/Postgres puede devolver valores ya parseados como objeto/array;
 * antes solo aceptábamos `string` y el payload quedaba vacío → "nada en la nube".
 */
export function coerceCloudStorageValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "bigint") return String(v);
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return null;
    }
  }
  return null;
}

/** El driver a veces devuelve el JSONB completo como string; sin esto el payload parece vacío. */
export function unwrapDbPayloadObject(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw) as unknown;
      if (p && typeof p === "object" && !Array.isArray(p)) {
        return p as Record<string, unknown>;
      }
    } catch {
      /* ignore */
    }
    return {};
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

export function computeCloudEntryStats(entries: Record<string, string>): {
  totalKeys: number;
  bbKeys: number;
  approxBytes: number;
} {
  const keys = Object.keys(entries);
  let bbKeys = 0;
  let approxBytes = 0;
  for (const k of keys) {
    if (isBlackboardCloudKey(k)) bbKeys += 1;
    approxBytes += entries[k]?.length ?? 0;
  }
  return { totalKeys: keys.length, bbKeys, approxBytes };
}

export function normalizeCloudPayload(raw: unknown): Record<string, string> {
  const root = unwrapDbPayloadObject(raw);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(root)) {
    if (typeof k !== "string" || !k.startsWith(SYNC_PREFIX)) continue;
    if (CLOUD_EXCLUDE.has(k)) continue;
    const s = coerceCloudStorageValue(v);
    if (s !== null) out[k] = s;
  }
  return out;
}

export function sanitizeEntriesForUpload(
  entries: Record<string, string | unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(entries)) {
    if (!k.startsWith(SYNC_PREFIX) || CLOUD_EXCLUDE.has(k)) continue;
    const s = coerceCloudStorageValue(v);
    if (s !== null) out[k] = s;
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

/** Solo sobrescribe claves presentes en `entries`; no borra claves locales ausentes en el servidor. */
export function applyCloudEntriesMerge(entries: Record<string, string>): void {
  if (typeof window === "undefined") return;
  const clean = normalizeCloudPayload(entries);
  for (const [k, v] of Object.entries(clean)) {
    if (CLOUD_EXCLUDE.has(k)) continue;
    try {
      localStorage.setItem(k, v);
    } catch {
      /* quota */
    }
  }
  dispatchCloudRefreshEvents();
}

/**
 * Aplica el payload del servidor sin borrar claves locales que el servidor no envía.
 * Así las notas/planes creados en móvil no desaparecen al bajar cursos del PC; el PC sigue
 * mandando PUT completo (`merge: false`) para que la copia en servidor sea la verdad.
 */
export function applyCloudEntriesSmartMerge(
  serverEntries: Record<string, string>,
): void {
  const clean = normalizeCloudPayload(serverEntries);
  if (Object.keys(clean).length === 0) return;
  applyCloudEntriesMerge(clean);
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
  window.dispatchEvent(new Event(STUDY_ARENA_PERSIST_CHANGED));
}
