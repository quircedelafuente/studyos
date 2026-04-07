/** Navegación cross-panel hacia Study Planner (desde Exámenes y fechas, etc.). */

export const STUDY_PLANNER_NAV_EVENT = "iestudio-study-planner-nav";

export type StudyPlannerNavDetail =
  | { mode: "create"; deadlineId: string }
  | { mode: "open"; planId: string };

export function emitStudyPlannerNavigate(detail: StudyPlannerNavDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(STUDY_PLANNER_NAV_EVENT, { detail }));
}
