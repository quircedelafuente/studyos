import { idbDeleteMany, idbGetBlob, idbPutBlob } from "@/lib/course-files-idb";
import { isoDate, kindFromFile, newEntityId } from "@/lib/course-file-utils";
import { loadManualCourses, saveManualCourses } from "@/lib/manual-courses-storage";
import type { CourseFileStored, CourseFolder, ManualCourse } from "@/types/dashboard";

/** Arrastre interno de archivos entre carpetas en Documentos. */
export const IESTUDIO_FILE_DRAG_MIME = "application/x-iestudio-course-file";

export type IestudioFileDragPayload = { courseId: string; fileId: string };

export function hasIestudioFileDrag(dt: DataTransfer): boolean {
  return Array.from(dt.types).includes(IESTUDIO_FILE_DRAG_MIME);
}

export function parseIestudioFileDrag(
  dt: DataTransfer,
): IestudioFileDragPayload | null {
  try {
    const raw = dt.getData(IESTUDIO_FILE_DRAG_MIME);
    if (!raw?.trim()) return null;
    const o = JSON.parse(raw) as unknown;
    if (o === null || typeof o !== "object") return null;
    const r = o as Record<string, unknown>;
    if (typeof r.courseId !== "string" || typeof r.fileId !== "string")
      return null;
    return { courseId: r.courseId, fileId: r.fileId };
  } catch {
    return null;
  }
}

function mapCourse(
  courses: ManualCourse[],
  courseId: string,
  fn: (c: ManualCourse) => ManualCourse,
): ManualCourse[] {
  return courses.map((c) => (c.id === courseId ? fn(c) : c));
}

export async function addDroppedFilesToCourse(
  courseId: string,
  fileList: File[],
  folderId: string | null,
): Promise<void> {
  const files = [...fileList].filter((f) => f.size > 0 && !f.name.startsWith("."));
  if (files.length === 0) return;

  const added: CourseFileStored[] = [];
  for (const file of files) {
    const id = newEntityId();
    await idbPutBlob(id, file);
    added.push({
      id,
      name: file.name,
      kind: kindFromFile(file),
      updatedAt: isoDate(),
      folderId,
      blobKey: id,
    });
  }

  const courses = loadManualCourses();
  if (!courses.some((c) => c.id === courseId)) return;
  const next = mapCourse(courses, courseId, (c) => ({
    ...c,
    files: [...c.files, ...added],
  }));
  saveManualCourses(next);
}

export function createFolderInCourse(
  courseId: string,
  name: string,
  parentId: string | null,
): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const courses = loadManualCourses();
  const next = mapCourse(courses, courseId, (c) => ({
    ...c,
    folders: [
      ...c.folders,
      { id: newEntityId(), name: trimmed, parentId },
    ],
  }));
  saveManualCourses(next);
}

/** Mueve un archivo del curso a otra carpeta (o a la raíz con `null`). */
export function moveCourseFileToFolder(
  courseId: string,
  fileId: string,
  targetFolderId: string | null,
): void {
  const courses = loadManualCourses();
  const course = courses.find((c) => c.id === courseId);
  if (!course) return;
  const file = course.files.find((f) => f.id === fileId);
  if (!file) return;
  if (file.folderId === targetFolderId) return;
  if (targetFolderId !== null) {
    const folderOk = course.folders.some((fol) => fol.id === targetFolderId);
    if (!folderOk) return;
  }
  const next = mapCourse(courses, courseId, (c) => ({
    ...c,
    files: c.files.map((f) =>
      f.id === fileId
        ? { ...f, folderId: targetFolderId, updatedAt: isoDate() }
        : f,
    ),
  }));
  saveManualCourses(next);
}

export function deleteFileFromCourse(courseId: string, fileId: string): void {
  const courses = loadManualCourses();
  const course = courses.find((c) => c.id === courseId);
  const file = course?.files.find((f) => f.id === fileId);
  const key = file?.blobKey ?? fileId;
  void idbDeleteMany([key]);

  const next = mapCourse(courses, courseId, (c) => ({
    ...c,
    files: c.files.filter((f) => f.id !== fileId),
  }));
  saveManualCourses(next);
}

function collectFolderDescendants(
  folders: CourseFolder[],
  rootId: string,
): Set<string> {
  const ids = new Set<string>([rootId]);
  let added = true;
  while (added) {
    added = false;
    for (const f of folders) {
      if (f.parentId !== null && ids.has(f.parentId) && !ids.has(f.id)) {
        ids.add(f.id);
        added = true;
      }
    }
  }
  return ids;
}

export function deleteFolderFromCourse(
  courseId: string,
  folderId: string,
): void {
  const courses = loadManualCourses();
  const course = courses.find((c) => c.id === courseId);
  if (!course) return;

  const removeIds = collectFolderDescendants(course.folders, folderId);
  const filesToRemove = course.files.filter(
    (f) => f.folderId !== null && removeIds.has(f.folderId),
  );
  void idbDeleteMany(
    filesToRemove.map((f) => f.blobKey ?? f.id).filter(Boolean),
  );

  const next = mapCourse(courses, courseId, (c) => ({
    ...c,
    folders: c.folders.filter((f) => !removeIds.has(f.id)),
    files: c.files.filter(
      (f) => f.folderId === null || !removeIds.has(f.folderId),
    ),
  }));
  saveManualCourses(next);
}

export async function purgeCourseBlobs(course: ManualCourse): Promise<void> {
  const keys = course.files
    .map((f) => f.blobKey ?? f.id)
    .filter((k): k is string => Boolean(k));
  await idbDeleteMany(keys);
}

export async function openCourseFile(file: CourseFileStored): Promise<void> {
  const key = file.blobKey ?? file.id;
  const blob = await idbGetBlob(key);
  if (!blob) {
    window.alert(
      "No se encontró el archivo en el almacenamiento local (puede ser un dato antiguo sin binario).",
    );
    return;
  }
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}
