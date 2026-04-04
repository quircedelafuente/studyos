import type { CourseFilterMode } from "@/lib/blackboard-api";

const KEY = "iestudio-bb-course-filter-mode";

export const BB_COURSE_FILTER_CHANGED = "iestudio-bb-course-filter-changed";

const allowed = new Set<CourseFilterMode>([
  "__auto__",
  "__all__",
  "Q1",
  "Q2",
  "ANNUAL",
  "ORGANIZATION_COMMUNITY",
  "OTHER",
]);

export function loadCourseFilterMode(): CourseFilterMode {
  if (typeof window === "undefined") return "__auto__";
  try {
    const v = localStorage.getItem(KEY);
    if (v && allowed.has(v as CourseFilterMode)) return v as CourseFilterMode;
  } catch {
    /* ignore */
  }
  return "__auto__";
}

export function saveCourseFilterMode(mode: CourseFilterMode): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, mode);
    window.dispatchEvent(new Event(BB_COURSE_FILTER_CHANGED));
  } catch {
    /* ignore */
  }
}
