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

/** Lectura única de la misma lista que ven Courses y Assignments (caché + curación + filtro). */
export function readBbDisplayedCoursesSnapshot(): {
  /** Hay ajustes de Blackboard (URL / extensión) en este dispositivo. */
  hasConfig: boolean;
  /** Caché sincronizada desde otro dispositivo sin config local (p. ej. móvil). */
  readOnlyBbFromCloud: boolean;
  apiCourses: BbCourseItem[];
  curation: BbCourseCuration;
  curatedCourses: BbCourseItem[];
  displayedCourses: BbCourseItem[];
  filterMode: CourseFilterMode;
} {
  const hasConfig = Boolean(loadBbConfig());
  const apiCourses = loadBbCourses()?.courses ?? [];
  const readOnlyBbFromCloud = !hasConfig && apiCourses.length > 0;
  const curation = loadBbCourseCuration();
  const curatedCourses = applyBbCourseCuration(apiCourses, curation);
  const filterMode = loadCourseFilterMode();
  const displayedCourses = filterCoursesByMode(curatedCourses, filterMode);
  return {
    hasConfig,
    readOnlyBbFromCloud,
    apiCourses,
    curation,
    curatedCourses,
    displayedCourses,
    filterMode,
  };
}
