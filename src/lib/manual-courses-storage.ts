import type { CourseFileStored, CourseFolder, ManualCourse } from "@/types/dashboard";

export const MANUAL_COURSES_STORAGE_KEY = "iestudio-manual-courses";

export const MANUAL_COURSES_CHANGED_EVENT = "iestudio-manual-courses-changed";

function isCourseFileKind(
  x: unknown,
): x is CourseFileStored["kind"] {
  return (
    x === "pdf" ||
    x === "nota" ||
    x === "slide" ||
    x === "enlace" ||
    x === "other"
  );
}

function isCourseFileStored(x: unknown): x is CourseFileStored {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (!isCourseFileKind(o.kind)) return false;
  if (typeof o.id !== "string" || typeof o.name !== "string") return false;
  if (typeof o.updatedAt !== "string") return false;
  const fid = o.folderId;
  if (fid !== null && typeof fid !== "string") return false;
  if (o.blobKey !== undefined && typeof o.blobKey !== "string") return false;
  return true;
}

function normalizeFiles(raw: unknown): CourseFileStored[] {
  if (!Array.isArray(raw)) return [];
  const list = raw.filter(isCourseFileStored);
  return list.map((f) => ({
    ...f,
    folderId: f.folderId ?? null,
  }));
}

function isCourseFolder(x: unknown): x is CourseFolder {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.name !== "string") return false;
  const p = o.parentId;
  if (p !== null && typeof p !== "string") return false;
  return true;
}

function normalizeFolders(raw: unknown): CourseFolder[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isCourseFolder).map((f) => ({
    id: f.id,
    name: f.name.trim() || "Carpeta",
    parentId: f.parentId,
  }));
}

function isManualCourseLoose(x: unknown): x is Omit<ManualCourse, "files" | "folders"> & {
  files?: unknown;
  folders?: unknown;
} {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    typeof o.short === "string" &&
    typeof o.createdAt === "string"
  );
}

function normalizeManualCourse(x: unknown): ManualCourse | null {
  if (!isManualCourseLoose(x)) return null;
  return {
    id: x.id,
    name: x.name,
    short: x.short,
    createdAt: x.createdAt,
    folders: normalizeFolders(x.folders),
    files: normalizeFiles(x.files),
  };
}

export function loadManualCourses(): ManualCourse[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(MANUAL_COURSES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: ManualCourse[] = [];
    for (const item of parsed) {
      const c = normalizeManualCourse(item);
      if (c) out.push(c);
    }
    return out;
  } catch {
    return [];
  }
}

export function saveManualCourses(courses: ManualCourse[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(MANUAL_COURSES_STORAGE_KEY, JSON.stringify(courses));
    window.dispatchEvent(new Event(MANUAL_COURSES_CHANGED_EVENT));
  } catch {
    /* ignore quota */
  }
}

/** Crea o actualiza el curso manual con id = learnCourseId (Blackboard o local). */
export function ensureManualCourseForBbLearnId(
  learnCourseId: string,
  name: string,
): void {
  const id = learnCourseId.trim();
  if (!id) return;
  const displayName = name.trim() || "Curso";
  const courses = loadManualCourses();
  const idx = courses.findIndex((c) => c.id === id);
  if (idx === -1) {
    const next: ManualCourse = {
      id,
      name: displayName,
      short: "",
      createdAt: new Date().toISOString(),
      folders: [],
      files: [],
    };
    saveManualCourses(
      [...courses, next].sort((a, b) => a.name.localeCompare(b.name, "es")),
    );
    return;
  }
  const existing = courses[idx]!;
  if (existing.name === displayName) return;
  const copy = [...courses];
  copy[idx] = { ...existing, name: displayName };
  saveManualCourses(copy.sort((a, b) => a.name.localeCompare(b.name, "es")));
}
