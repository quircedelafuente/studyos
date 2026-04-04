import { loadBbConfig } from "@/lib/blackboard-config";
import { loadBbCourses } from "@/lib/blackboard-storage";
import {
  filterCoursesByMode,
  type CourseFilterMode,
} from "@/lib/blackboard-api";
import type { BbCourseItem } from "@/types/blackboard";
import {
  applyBbCourseCuration,
  loadBbCourseCuration,
  type BbCourseCuration,
} from "@/lib/bb-course-curation";
import { loadCourseFilterMode } from "@/lib/bb-course-filter-prefs";

const GRADEBOOK_KEY_PREFIX = "iestudio-bb-gb-";

/**
 * Hay datos de BB en localStorage procedentes de sync (otro dispositivo) aunque
 * este dispositivo no tenga `iestudio-bb-config` ni extensión.
 */
export function hasBbSyncedCache(): boolean {
  if (typeof window === "undefined") return false;
  const n = loadBbCourses()?.courses?.length ?? 0;
  if (n > 0) return true;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(GRADEBOOK_KEY_PREFIX)) return true;
  }
  return false;
}

export type BbDisplayedCoursesSnapshot = {
  /**
   * Hay algo que mostrar: configuración local de BB **o** caché sincronizada
   * (cursos / gradebooks en localStorage).
   */
  hasConfig: boolean;
  /** URL + extensión guardadas en este dispositivo (Assignments). */
  hasBridgeConfig: boolean;
  /** Cursos o gradebooks en caché (p. ej. bajados de la nube). */
  hasSyncedCache: boolean;
  apiCourses: BbCourseItem[];
  curation: BbCourseCuration;
  curatedCourses: BbCourseItem[];
  displayedCourses: BbCourseItem[];
  filterMode: CourseFilterMode;
};

/** Lectura única de la misma lista que ven Courses y Assignments (caché + curación + filtro). */
export function readBbDisplayedCoursesSnapshot(): BbDisplayedCoursesSnapshot {
  const hasBridgeConfig = Boolean(loadBbConfig());
  const hasSyncedCache = hasBbSyncedCache();
  const hasConfig = hasBridgeConfig || hasSyncedCache;
  const apiCourses = loadBbCourses()?.courses ?? [];
  const curation = loadBbCourseCuration();
  const curatedCourses = applyBbCourseCuration(apiCourses, curation);
  const filterMode = loadCourseFilterMode();
  const displayedCourses = filterCoursesByMode(curatedCourses, filterMode);
  return {
    hasConfig,
    hasBridgeConfig,
    hasSyncedCache,
    apiCourses,
    curation,
    curatedCourses,
    displayedCourses,
    filterMode,
  };
}
