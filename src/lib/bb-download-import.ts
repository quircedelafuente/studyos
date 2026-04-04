"use client";

import JSZip from "jszip";
import { idbGetBlob, idbPutBlob } from "@/lib/course-files-idb";
import { newEntityId, isoDate } from "@/lib/course-file-utils";
import {
  loadManualCourses,
  saveManualCourses,
  ensureManualCourseForBbLearnId,
} from "@/lib/manual-courses-storage";
import type { CourseFileKind, CourseFileStored, CourseFolder } from "@/types/dashboard";

type TreeFolder = { name: string; parentPath: string | null };
type TreeFile = { name: string; parentPath: string | null; relativePath: string };
export type DownloadTree = { folders: TreeFolder[]; files: TreeFile[] };

function kindFromName(name: string): CourseFileKind {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return "pdf";
  if (n.endsWith(".pptx") || n.endsWith(".ppt") || n.endsWith(".key")) return "slide";
  if (n.endsWith(".txt") || n.endsWith(".md")) return "nota";
  return "other";
}

function buildFolderPathById(folders: CourseFolder[]): Map<string, string> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const cache = new Map<string, string>();

  function resolve(id: string): string {
    if (cache.has(id)) return cache.get(id)!;
    const f = byId.get(id);
    if (!f) return "";
    const parent = f.parentId ? resolve(f.parentId) : "";
    const full = parent ? `${parent}/${f.name}` : f.name;
    cache.set(id, full);
    return full;
  }

  for (const f of folders) resolve(f.id);
  return cache;
}

/**
 * Imports a Blackboard download tree into IEStudio's folder/file storage.
 * Skips folders and files that already exist (matched by name + path).
 *
 * Si pasas `getBlob`, se usa en lugar de pedir cada archivo al API `/serve` (Vercel / ZIP).
 */
export async function importBlackboardTree(
  courseId: string,
  courseName: string,
  diskBasePath: string,
  tree: DownloadTree,
  onProgress?: (done: number, total: number) => void,
  getBlob?: (relativePath: string) => Promise<Blob | null>,
): Promise<{ importedFiles: number; importedFolders: number; skippedFiles: number }> {
  ensureManualCourseForBbLearnId(courseId, courseName);

  const courses = loadManualCourses();
  const idx = courses.findIndex((c) => c.id === courseId);
  if (idx === -1) return { importedFiles: 0, importedFolders: 0, skippedFiles: 0 };

  const course = courses[idx]!;

  const existingFolderPaths = buildFolderPathById(course.folders);
  const existingFolderPathToId = new Map<string, string>();
  for (const [id, p] of existingFolderPaths) existingFolderPathToId.set(p, id);

  const existingFileByKey = new Map<string, CourseFileStored>();
  for (const f of course.files) {
    const folderPath = f.folderId ? (existingFolderPaths.get(f.folderId) ?? "") : "";
    const key = folderPath ? `${folderPath}/${f.name}` : f.name;
    existingFileByKey.set(key, f);
  }

  const folderIdByPath = new Map<string, string>(existingFolderPathToId);
  const newFolders: CourseFolder[] = [];

  const sortedFolders = [...tree.folders].sort((a, b) => {
    const da = a.parentPath ? a.parentPath.split("/").length : 0;
    const db = b.parentPath ? b.parentPath.split("/").length : 0;
    return da - db;
  });

  for (const tf of sortedFolders) {
    const folderPath = tf.parentPath ? `${tf.parentPath}/${tf.name}` : tf.name;
    if (folderIdByPath.has(folderPath)) continue;

    const id = newEntityId();
    const parentId = tf.parentPath ? (folderIdByPath.get(tf.parentPath) ?? null) : null;
    folderIdByPath.set(folderPath, id);
    newFolders.push({ id, name: tf.name, parentId });
  }

  if (newFolders.length > 0) {
    const copy = [...courses];
    copy[idx] = { ...copy[idx]!, folders: [...copy[idx]!.folders, ...newFolders] };
    saveManualCourses(copy);
  }

  const filesToImport: TreeFile[] = [];
  const staleFileIds = new Set<string>();
  let skippedFiles = 0;

  for (const tf of tree.files) {
    const key = tf.parentPath ? `${tf.parentPath}/${tf.name}` : tf.name;
    const existing = existingFileByKey.get(key);
    if (!existing) {
      filesToImport.push(tf);
      continue;
    }

    // If metadata exists but blob is missing/corrupt, force reimport.
    try {
      const blob = await idbGetBlob(existing.blobKey ?? existing.id);
      if (!blob) {
        staleFileIds.add(existing.id);
        filesToImport.push(tf);
        continue;
      }
    } catch {
      staleFileIds.add(existing.id);
      filesToImport.push(tf);
      continue;
    }

    skippedFiles += 1;
  }

  const newFiles: CourseFileStored[] = [];
  const total = filesToImport.length;
  let done = 0;

  for (const tf of filesToImport) {
    let blob: Blob | null = null;
    try {
      if (getBlob) {
        blob = await getBlob(tf.relativePath);
      } else {
        const diskPath = `${diskBasePath}/${tf.relativePath}`;
        const serveUrl = `/api/courses/${encodeURIComponent(courseId)}/download-all/serve?path=${encodeURIComponent(diskPath)}`;
        const res = await fetch(serveUrl);
        if (res.ok) blob = await res.blob();
      }
      if (!blob) {
        done += 1;
        onProgress?.(done, total);
        continue;
      }
      const fileId = newEntityId();
      await idbPutBlob(fileId, blob);

      const folderId = tf.parentPath ? (folderIdByPath.get(tf.parentPath) ?? null) : null;
      newFiles.push({
        id: fileId,
        name: tf.name,
        kind: kindFromName(tf.name),
        updatedAt: isoDate(),
        folderId,
        blobKey: fileId,
      });
    } catch {
      // Skip failed files silently
    }
    done += 1;
    onProgress?.(done, total);
  }

  if (newFiles.length > 0 || staleFileIds.size > 0) {
    const freshCourses = loadManualCourses();
    const fi = freshCourses.findIndex((c) => c.id === courseId);
    if (fi !== -1) {
      const currentFiles = freshCourses[fi]!.files;
      const cleanedFiles =
        staleFileIds.size > 0
          ? currentFiles.filter((f) => !staleFileIds.has(f.id))
          : currentFiles;
      const copy = [...freshCourses];
      copy[fi] = { ...copy[fi]!, files: [...cleanedFiles, ...newFiles] };
      saveManualCourses(copy);
    }
  }

  return { importedFiles: newFiles.length, importedFolders: newFolders.length, skippedFiles };
}

type ZipManifest = {
  version: number;
  courseId: string;
  courseName: string;
  tree: DownloadTree;
  stats?: {
    downloadedFiles?: number;
    skippedItems?: number;
    visitedItems?: number;
    createdFolders?: number;
  };
};

/**
 * Descarga el .zip al disco local del usuario (navegador) e importa a IEStudio desde el manifiesto.
 */
export async function importBlackboardTreeFromZipBuffer(
  buffer: ArrayBuffer,
  courseId: string,
  courseDisplayName: string,
  options?: {
    saveZipAs?: string;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<{
  importedFiles: number;
  importedFolders: number;
  skippedFiles: number;
  downloadedFiles: number;
  skippedItems: number;
}> {
  if (options?.saveZipAs && typeof document !== "undefined") {
    const blob = new Blob([buffer], { type: "application/zip" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const name = options.saveZipAs.endsWith(".zip")
      ? options.saveZipAs
      : `${options.saveZipAs}.zip`;
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const zip = await JSZip.loadAsync(buffer);
  const mf = zip.file("__iestudio_manifest__.json");
  if (!mf) {
    throw new Error(
      "ZIP sin manifiesto IEStudio. Vuelve a descargar desde Documentos.",
    );
  }
  const manifest = JSON.parse(await mf.async("string")) as ZipManifest;
  const tree = manifest.tree;

  const getBlob = async (relativePath: string) => {
    const entry = zip.file(relativePath);
    if (!entry) return null;
    return entry.async("blob");
  };

  const r = await importBlackboardTree(
    courseId,
    courseDisplayName,
    "",
    tree,
    options?.onProgress,
    getBlob,
  );

  return {
    ...r,
    downloadedFiles: manifest.stats?.downloadedFiles ?? tree.files.length,
    skippedItems: manifest.stats?.skippedItems ?? 0,
  };
}
