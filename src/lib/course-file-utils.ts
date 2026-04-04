import type { CourseFileKind, CourseFileStored } from "@/types/dashboard";

export function newEntityId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function kindFromFile(file: File): CourseFileKind {
  const name = file.name.toLowerCase();
  const mime = file.type.toLowerCase();
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (
    mime.startsWith("text/") ||
    name.endsWith(".md") ||
    name.endsWith(".txt")
  ) {
    return "nota";
  }
  if (
    mime.includes("presentation") ||
    name.endsWith(".pptx") ||
    name.endsWith(".ppt") ||
    name.endsWith(".key")
  ) {
    return "slide";
  }
  if (mime.startsWith("http") || name.startsWith("http")) return "enlace";
  return "other";
}

export function isoDate(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function fileFromStored(f: CourseFileStored): CourseFileStored {
  return { ...f, folderId: f.folderId ?? null };
}
