/**
 * Clasificación de cursos idéntica a Jarvis for Blackboard (courseClassifier.js).
 *
 * Pipeline: texto del término + nombre + descripción → normalizar → buscar
 * subcadenas "FIRST Q1", "FIRST Q2", "ANNUAL"; o COMMUNITY/organización → categoría.
 */

export type CourseCategory =
  | "Q1"
  | "Q2"
  | "ANNUAL"
  | "ORGANIZATION_COMMUNITY"
  | "OTHER";

function normalizeText(text: string): string {
  return text.toUpperCase();
}

export function buildCourseSearchText(fields: {
  termName?: string;
  termId?: string;
  displayName?: string;
  name?: string;
  description?: string;
}): string {
  const parts = [
    fields.termName,
    fields.termId,
    fields.displayName,
    fields.name,
    fields.description,
  ]
    .filter(Boolean)
    .map((v) => String(v));
  if (parts.length === 0) return "";
  return normalizeText(parts.join(" | "));
}

export function classifyCourse(
  haystack: string,
  meta?: { serviceLevelType?: string; isOrganization?: boolean },
): CourseCategory {
  if (
    meta?.serviceLevelType === "COMMUNITY" ||
    meta?.isOrganization === true
  ) {
    return "ORGANIZATION_COMMUNITY";
  }
  if (!haystack) return "OTHER";
  if (haystack.includes("FIRST Q1")) return "Q1";
  if (haystack.includes("FIRST Q2")) return "Q2";
  if (haystack.includes("ANNUAL")) return "ANNUAL";
  return "OTHER";
}

/**
 * Si hay al menos un curso Q2, estamos en segundo semestre; si no, primero.
 * Heurística simple de Jarvis — solo informativa, no filtra nada.
 */
export function detectCurrentSemester(totals: {
  Q1?: number;
  Q2?: number;
}): "first" | "second" {
  const q2 = totals?.Q2 ?? 0;
  return q2 > 0 ? "second" : "first";
}
