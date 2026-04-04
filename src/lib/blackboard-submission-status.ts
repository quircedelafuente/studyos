/**
 * Estado de entrega por columna (buildSubmissionStatusWithAttempts, Jarvis).
 * Blackboard a menudo no envía isAttemptBased en columnas; inferimos entregas con
 * contentId (Ultra) y excluimos asistencia explícitamente.
 */

export type SubmissionReason =
  | "NOT_APPLICABLE_NON_ATTEMPT_BASED"
  | "NO_GRADE_RECORD"
  | "SCORE_PRESENT"
  | "NO_ATTEMPT_ID"
  | "ATTEMPT_IN_PROGRESS"
  | "ATTEMPT_NOT_IN_PROGRESS"
  | "GRADES_UNAVAILABLE"
  | "ATTEMPT_FETCH_FAILED";

export type BbGradebookColumnLike = {
  isAttemptBased?: boolean;
  contentId?: string;
  displayName?: string;
  name?: string;
  gradebookCategoryId?: string;
  grading?: { type?: string };
};

function looksNumeric(val: unknown): boolean {
  if (val == null) return false;
  if (typeof val === "number") return Number.isFinite(val);
  const s = String(val).trim().replace(",", ".");
  if (!s) return false;
  const n = Number(s);
  return !Number.isNaN(n);
}

/** Paso B: hay puntuación numérica en el registro de nota (orden Jarvis). */
export function getScoreInfo(gradeRec: unknown): { hasScore: boolean } {
  if (!gradeRec || typeof gradeRec !== "object") return { hasScore: false };
  const e = gradeRec as Record<string, unknown>;
  const grade = (e.grade ?? e) as Record<string, unknown>;
  const displayGrade = grade?.displayGrade as Record<string, unknown> | undefined;

  if (displayGrade && typeof displayGrade === "object") {
    if (looksNumeric(displayGrade.score)) return { hasScore: true };
    if (
      displayGrade.text != null &&
      looksNumeric(String(displayGrade.text).trim())
    ) {
      return { hasScore: true };
    }
  }
  for (const key of ["averageScore", "manualScore", "manualGrade"] as const) {
    const v = grade[key];
    if (looksNumeric(v)) return { hasScore: true };
  }
  return { hasScore: false };
}

function gradeEntryColumnId(entry: unknown): string | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  const g = (e.grade ?? e) as Record<string, unknown>;
  const raw =
    g?.columnId ??
    e?.columnId ??
    g?.gradebookColumnId ??
    e?.gradebookColumnId;
  if (raw == null) return null;
  return String(raw);
}

export function getGradeEntryForColumn(
  gradeResults: unknown[],
  columnId: string,
): unknown | null {
  if (!Array.isArray(gradeResults)) return null;
  const colStr = String(columnId);
  for (const entry of gradeResults) {
    const cid = gradeEntryColumnId(entry);
    if (cid !== null && cid === colStr) return entry;
  }
  return null;
}

export function getLastAttemptId(gradeRec: unknown): string | null {
  if (!gradeRec || typeof gradeRec !== "object") return null;
  const e = gradeRec as Record<string, unknown>;
  const g = (e.grade ?? e) as Record<string, unknown>;
  const last =
    g?.lastAttemptId ??
    e?.lastAttemptId ??
    (g?.lastAttempt as Record<string, unknown> | undefined)?.id ??
    (e?.lastAttempt as Record<string, unknown> | undefined)?.id;
  if (last != null && last !== "") return String(last);
  const first =
    g?.firstAttemptId ??
    e?.firstAttemptId ??
    (g?.firstAttempt as Record<string, unknown> | undefined)?.id ??
    (e?.firstAttempt as Record<string, unknown> | undefined)?.id;
  if (first != null && first !== "") return String(first);
  return null;
}

function looksLikeAttendanceColumn(
  col: Pick<BbGradebookColumnLike, "displayName" | "name" | "gradebookCategoryId">,
): boolean {
  const title = `${col.displayName ?? ""} ${col.name ?? ""}`.toLowerCase();
  const cat = (col.gradebookCategoryId ?? "").toLowerCase();
  return (
    title.includes("attendance") ||
    title.includes("asistencia") ||
    title.includes("qwattendance") ||
    cat.includes("attendance")
  );
}

/**
 * ¿Aplicar árbol de entrega? Jarvis usa isAttemptBased; en Learn/Ultra muchas
 * columnas vienen sin el flag pero con contentId (assessment).
 * isAttemptBased === false explícito respeta N/A.
 */
function titleSuggestsGradedAssignment(col: BbGradebookColumnLike): boolean {
  const t = `${col.displayName ?? ""} ${col.name ?? ""}`;
  return /\bassignment\b/i.test(t) || /\btarea\b/i.test(t) || /\bhomework\b/i.test(t);
}

export function isSubmissionRelevantColumn(col: BbGradebookColumnLike): boolean {
  if (looksLikeAttendanceColumn(col)) return false;
  if (col.isAttemptBased === true) return true;
  if (col.isAttemptBased === false) return false;
  if (col.contentId && String(col.contentId).trim() !== "") return true;
  const gType = (col.grading?.type ?? "").toLowerCase();
  if (gType.includes("attempt")) return true;
  if (titleSuggestsGradedAssignment(col)) return true;
  return false;
}

export type SubmissionResolution =
  | {
      kind: "resolved";
      submitted: boolean | null;
      reason: SubmissionReason;
    }
  | { kind: "fetch_attempt"; attemptId: string };

/** Sin llamada a /attempts: decide o delega en fetch del intento. */
export function resolveSubmissionWithoutAttempt(
  treatAsSubmission: boolean,
  gradeRec: unknown | null,
): SubmissionResolution {
  if (!treatAsSubmission) {
    return {
      kind: "resolved",
      submitted: null,
      reason: "NOT_APPLICABLE_NON_ATTEMPT_BASED",
    };
  }
  if (gradeRec == null) {
    return {
      kind: "resolved",
      submitted: false,
      reason: "NO_GRADE_RECORD",
    };
  }
  if (getScoreInfo(gradeRec).hasScore) {
    return {
      kind: "resolved",
      submitted: true,
      reason: "SCORE_PRESENT",
    };
  }
  const lastAttemptId = getLastAttemptId(gradeRec);
  if (lastAttemptId == null) {
    return {
      kind: "resolved",
      submitted: false,
      reason: "NO_ATTEMPT_ID",
    };
  }
  return { kind: "fetch_attempt", attemptId: lastAttemptId };
}

export function submissionReasonToLabelEs(reason: SubmissionReason): string {
  switch (reason) {
    case "NOT_APPLICABLE_NON_ATTEMPT_BASED":
      return "N/A";
    case "NO_GRADE_RECORD":
      return "No entregado (sin abrir)";
    case "SCORE_PRESENT":
      return "Entregado (con nota)";
    case "NO_ATTEMPT_ID":
      return "No entregado";
    case "ATTEMPT_IN_PROGRESS":
      return "No entregado (borrador en curso)";
    case "ATTEMPT_NOT_IN_PROGRESS":
      return "Entregado";
    case "GRADES_UNAVAILABLE":
      return "Sin datos de entrega";
    case "ATTEMPT_FETCH_FAILED":
      return "No se pudo comprobar el intento";
    default:
      return "—";
  }
}

/** Semáforo visual: rojo = unopened, amarillo = unsubmitted (borrador), verde = submitted. */
export type SubmissionLight = "green" | "yellow" | "red" | "neutral";

export function getSubmissionLight(
  reason: string | undefined,
  submitted: boolean | null | undefined,
): SubmissionLight {
  switch (reason) {
    case "SCORE_PRESENT":
    case "ATTEMPT_NOT_IN_PROGRESS":
      return "green";
    case "ATTEMPT_IN_PROGRESS":
      return "yellow";
    case "NO_GRADE_RECORD":
    case "NO_ATTEMPT_ID":
      return "red";
    case "NOT_APPLICABLE_NON_ATTEMPT_BASED":
    case "GRADES_UNAVAILABLE":
    case "ATTEMPT_FETCH_FAILED":
      return "neutral";
    default:
      if (submitted === true) return "green";
      return "neutral";
  }
}
