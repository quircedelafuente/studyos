import type { BbCourseItem, BbGradebookCache } from "@/types/blackboard";

const COURSES_KEY = "iestudio-bb-courses";
const GRADEBOOK_PREFIX = "iestudio-bb-gb-";
const CONTENT_LASTMOD_PREFIX = "iestudio-bb-content-first-lastmod-";

export const BB_COURSES_STORAGE_CHANGED = "iestudio-bb-courses-changed";
export const BB_GRADEBOOK_STORAGE_CHANGED = "iestudio-bb-gradebook-changed";
export const BB_CONTENT_META_CHANGED = "iestudio-bb-content-meta-changed";

/* ─── Courses ─── */

type CoursesCache = {
  courses: BbCourseItem[];
  fetchedAt: string;
};

export function loadBbCourses(): CoursesCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(COURSES_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CoursesCache;
    if (!Array.isArray(parsed.courses)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveBbCourses(courses: BbCourseItem[]): void {
  if (typeof window === "undefined") return;
  const cache: CoursesCache = { courses, fetchedAt: new Date().toISOString() };
  try {
    localStorage.setItem(COURSES_KEY, JSON.stringify(cache));
    window.dispatchEvent(new Event(BB_COURSES_STORAGE_CHANGED));
  } catch { /* quota */ }
}

/* ─── Gradebook per course ─── */

export function loadBbGradebook(courseId: string): BbGradebookCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(GRADEBOOK_PREFIX + courseId);
    if (!raw) return null;
    return JSON.parse(raw) as BbGradebookCache;
  } catch {
    return null;
  }
}

export function saveBbGradebook(cache: BbGradebookCache): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      GRADEBOOK_PREFIX + cache.courseId,
      JSON.stringify(cache),
    );
    window.dispatchEvent(new Event(BB_GRADEBOOK_STORAGE_CHANGED));
  } catch { /* quota */ }
}

export function clearAllBbData(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(COURSES_KEY);
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(GRADEBOOK_PREFIX) || key?.startsWith(CONTENT_LASTMOD_PREFIX)) {
      toRemove.push(key);
    }
  }
  for (const k of toRemove) localStorage.removeItem(k);
  window.dispatchEvent(new Event(BB_COURSES_STORAGE_CHANGED));
  window.dispatchEvent(new Event(BB_GRADEBOOK_STORAGE_CHANGED));
  window.dispatchEvent(new Event(BB_CONTENT_META_CHANGED));
}

/* ─── Content metadata (first-seen lastModifiedDate) ─── */

function contentKey(courseId: string, contentId: string): string {
  return `${CONTENT_LASTMOD_PREFIX}${courseId}\u0000${contentId}`;
}

/** Devuelve el primer lastModifiedDate observado (ms desde epoch) o null si aún no hay caché. */
export function loadBbContentFirstLastModifiedMs(
  courseId: string,
  contentId: string,
): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(contentKey(courseId, contentId));
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Guarda SOLO la primera fecha observada. Si ya existe, no la cambia.
 * Devuelve true si se guardó ahora; false si ya existía.
 */
export function saveBbContentFirstLastModifiedMs(
  courseId: string,
  contentId: string,
  ms: number,
): boolean {
  if (typeof window === "undefined") return false;
  if (!Number.isFinite(ms)) return false;
  const key = contentKey(courseId, contentId);
  try {
    const existing = localStorage.getItem(key);
    if (existing != null) return false;
    localStorage.setItem(key, String(Math.floor(ms)));
    window.dispatchEvent(new Event(BB_CONTENT_META_CHANGED));
    return true;
  } catch {
    return false;
  }
}
