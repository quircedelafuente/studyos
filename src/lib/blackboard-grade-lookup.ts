/**
 * Extracción y cruce de notas del alumno con columnas del gradebook (Jarvis gradeLookupService).
 */

export type ExtractedGrade = {
  gradeText: string | null;
  statusText: string | null;
};

export function extractGradeFromEntry(entry: unknown): ExtractedGrade {
  let gradeText: string | null = null;
  let statusText: string | null = null;
  if (!entry || typeof entry !== "object") return { gradeText, statusText };

  const e = entry as Record<string, unknown>;
  const grade = (e.grade ?? e) as Record<string, unknown>;
  const displayGrade = grade?.displayGrade as Record<string, unknown> | undefined;

  if (displayGrade && typeof displayGrade === "object") {
    if (displayGrade.text != null && String(displayGrade.text).trim() !== "") {
      gradeText = String(displayGrade.text).trim();
    } else if (displayGrade.score != null) {
      const n = Number(displayGrade.score);
      if (!Number.isNaN(n)) gradeText = String(n);
    }
  }

  if (gradeText == null || gradeText === "") {
    const numericCandidates = [
      grade?.manualScore,
      grade?.manualGrade,
      grade?.averageScore,
    ];
    for (const val of numericCandidates) {
      if (val == null) continue;
      const s = String(val).trim();
      if (!s) continue;
      const n = Number(s);
      if (!Number.isNaN(n)) {
        gradeText = s;
        break;
      }
    }
  }

  const status = grade?.status ?? e?.status;
  if (status != null) statusText = String(status).trim();

  return { gradeText, statusText };
}

function gradeRowColumnId(entry: unknown): string | null {
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

export function getGradeForColumn(
  gradeResults: unknown[],
  columnId: string,
): ExtractedGrade | null {
  if (!Array.isArray(gradeResults)) return null;
  const colStr = String(columnId);
  for (const entry of gradeResults) {
    const cid = gradeRowColumnId(entry);
    if (cid !== null && cid === colStr) {
      return extractGradeFromEntry(entry);
    }
  }
  return null;
}
