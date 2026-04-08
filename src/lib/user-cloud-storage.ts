import { MANUAL_COURSES_STORAGE_KEY } from "@/lib/manual-courses-storage";
import { STUDY_PLANS_CHANGED_EVENT } from "@/lib/study-plans-storage";
import { PARKING_LOT_CHANGED_EVENT } from "@/lib/parking-lot-storage";
import { DEADLINES_CHANGED_EVENT } from "@/lib/deadlines-storage";
import { DEADLINE_TAGS_CHANGED_EVENT } from "@/lib/deadline-tags-storage";
import { STUDY_MICROTASKS_CHANGED_EVENT } from "@/lib/study-microtasks-storage";
import { HABITS_CHANGED_EVENT } from "@/lib/habits-storage";
import { HABIT_LOGS_CHANGED_EVENT } from "@/lib/habit-logs-storage";
import {
  BB_COURSES_STORAGE_CHANGED,
  BB_GRADEBOOK_STORAGE_CHANGED,
  BB_CONTENT_META_CHANGED,
} from "@/lib/blackboard-storage";
import { BB_COURSE_FILTER_CHANGED } from "@/lib/bb-course-filter-prefs";
import { BB_COURSE_CURATION_CHANGED } from "@/lib/bb-course-curation";
import { BB_CONFIG_CHANGED } from "@/lib/blackboard-config";
import { STUDY_ARENA_CHANGED_EVENT } from "@/lib/study-arena-storage";
import { STUDY_ARENA_COMPLETED_CHANGED_EVENT } from "@/lib/study-arena-completed-storage";
import {
  DAILY_CHECKLIST_CHANGED_EVENT,
  pushDailyTasksRingToNativeIfIos,
} from "@/lib/daily-checklist-storage";
import { CLASS_NOTES_CHANGED_EVENT } from "@/lib/class-notes-storage";
import { SESSION_NOTES_CHANGED_EVENT } from "@/lib/session-notes-storage";

const SYNC_PREFIX = "iestudio-";

/**
 * PostgreSQL json/jsonb rechaza U+0000 y secuencias de surrogates sueltos
 * (D800-DFFF sin pareja). Limpiar antes de enviar a Neon.
 */
export function sanitizeStringForPostgresJson(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

/**
 * Contenido de cadena JSON sin reintroducir escapes \\uD800-\\uDFFF (PostgreSQL los rechaza en jsonb).
 */
function escapeJsonStringContentRaw(str: string): string {
  let out = "";
  for (const ch of str) {
    const code = ch.codePointAt(0)!;
    if (code < 0x20) {
      if (code === 0x08) out += "\\b";
      else if (code === 0x09) out += "\\t";
      else if (code === 0x0a) out += "\\n";
      else if (code === 0x0c) out += "\\f";
      else if (code === 0x0d) out += "\\r";
      else out += `\\u${code.toString(16).padStart(4, "0")}`;
    } else if (code === 0x22) out += '\\"';
    else if (code === 0x5c) out += "\\\\";
    else out += ch;
  }
  return out;
}

/**
 * Tras JSON.stringify, PostgreSQL puede rechazar el texto por escapes \\uXXXX ilegales:
 * - \\u0000 (NULL en JSON)
 * - pares sustitutos UTF-16 (emoji) que JS serializa como \\uD83D\\uDE00
 * Convierte escapes problemáticos a caracteres UTF-8 literales en la cadena JSON.
 */
export function sanitizeJsonTextForPostgresJsonb(jsonText: string): string {
  let s = jsonText;
  s = s.replace(/\\u0000/gi, "");
  s = s.replace(
    /\\u([dD][89abAB][0-9a-fA-F]{2})\\u([dD][cdefCDEF][0-9a-fA-F]{2})/g,
    (_m, hi: string, lo: string) => {
      const h = parseInt(hi, 16);
      const l = parseInt(lo, 16);
      const cp = 0x10_000 + ((h - 0xd800) << 10) + (l - 0xdc00);
      return escapeJsonStringContentRaw(String.fromCodePoint(cp));
    },
  );
  s = s.replace(/\\u([0-9a-fA-F]{4})/gi, (_m, hex: string) => {
    const code = parseInt(hex, 16);
    if (code === 0) return "";
    if (code >= 0xd800 && code <= 0xdfff) {
      return escapeJsonStringContentRaw("\uFFFD");
    }
    return escapeJsonStringContentRaw(String.fromCharCode(code));
  });
  return s;
}

/** Claves que nunca se suben a la nube (documentos / archivos de cursos en este navegador). */
const CLOUD_EXCLUDE = new Set<string>([MANUAL_COURSES_STORAGE_KEY]);

export function collectSyncableEntries(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(SYNC_PREFIX)) continue;
    if (CLOUD_EXCLUDE.has(k)) continue;
    const v = localStorage.getItem(k);
    if (v !== null) out[k] = sanitizeStringForPostgresJson(v);
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
    if (typeof v === "string") out[k] = sanitizeStringForPostgresJson(v);
  }
  return out;
}

export function sanitizeEntriesForUpload(
  entries: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(entries)) {
    if (!k.startsWith(SYNC_PREFIX) || CLOUD_EXCLUDE.has(k)) continue;
    if (typeof v === "string") out[k] = sanitizeStringForPostgresJson(v);
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
  window.dispatchEvent(new CustomEvent(HABITS_CHANGED_EVENT));
  window.dispatchEvent(new CustomEvent(HABIT_LOGS_CHANGED_EVENT));
  window.dispatchEvent(new Event(BB_COURSES_STORAGE_CHANGED));
  window.dispatchEvent(new Event(BB_GRADEBOOK_STORAGE_CHANGED));
  window.dispatchEvent(new Event(BB_CONTENT_META_CHANGED));
  window.dispatchEvent(new Event(BB_COURSE_FILTER_CHANGED));
  window.dispatchEvent(new Event(BB_COURSE_CURATION_CHANGED));
  window.dispatchEvent(new Event(BB_CONFIG_CHANGED));
  window.dispatchEvent(new Event(STUDY_ARENA_CHANGED_EVENT));
  window.dispatchEvent(new CustomEvent(STUDY_ARENA_COMPLETED_CHANGED_EVENT));
  window.dispatchEvent(new CustomEvent(DAILY_CHECKLIST_CHANGED_EVENT));
  window.dispatchEvent(new Event(CLASS_NOTES_CHANGED_EVENT));
  window.dispatchEvent(new Event(SESSION_NOTES_CHANGED_EVENT));
  pushDailyTasksRingToNativeIfIos();
}
