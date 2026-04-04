"use client";

import { importBlackboardTree, type DownloadTree } from "@/lib/bb-download-import";

type WindowWithFs = Window & {
  showDirectoryPicker?: (options?: {
    mode?: "read" | "readwrite";
  }) => Promise<FileSystemDirectoryHandle>;
};

export function supportsFolderPicker(): boolean {
  if (typeof window === "undefined") return false;
  return typeof (window as WindowWithFs).showDirectoryPicker === "function";
}

/** Elige una carpeta en el disco del usuario (Chrome/Edge; HTTPS). */
export async function pickWritableDirectory(): Promise<FileSystemDirectoryHandle> {
  const w = window as WindowWithFs;
  const pick = w.showDirectoryPicker;
  if (typeof pick !== "function") {
    throw new Error("showDirectoryPicker no está disponible");
  }
  return pick.call(w, { mode: "readwrite" });
}

async function writeBlobUnderRoot(
  root: FileSystemDirectoryHandle,
  relativePath: string,
  blob: Blob,
): Promise<void> {
  const parts = relativePath.split("/").filter(Boolean);
  if (parts.length === 0) return;
  let dir = root;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i]!, { create: true });
  }
  const fileName = parts[parts.length - 1]!;
  const fh = await dir.getFileHandle(fileName, { create: true });
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
}

type ManifestFile = DownloadTree["files"][number] & { sourceUrl: string };

function isManifestFile(f: DownloadTree["files"][number]): f is ManifestFile {
  return typeof f.sourceUrl === "string" && f.sourceUrl.length > 0;
}

/**
 * Descarga cada archivo vía API /fetch, lo escribe en la carpeta elegida (misma estructura)
 * e importa los blobs a IEStudio (IndexedDB).
 */
export async function downloadManifestToCourseFolder(
  courseId: string,
  courseDisplayName: string,
  baseUrl: string,
  cookieHeader: string,
  xsrfToken: string,
  tree: DownloadTree,
  courseRoot: FileSystemDirectoryHandle,
  onProgress?: (label: string, done: number, total: number) => void,
): Promise<{
  written: number;
  failed: number;
  importedFiles: number;
  importedFolders: number;
  skippedFiles: number;
}> {
  const withUrls = tree.files.filter(isManifestFile);
  const total = withUrls.length;
  const blobByPath = new Map<string, Blob>();
  let written = 0;
  let failed = 0;

  for (let i = 0; i < withUrls.length; i++) {
    const f = withUrls[i]!;
    onProgress?.("Guardando en tu carpeta", i, total);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(courseId)}/download-all/fetch`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: f.sourceUrl,
            baseUrl,
            cookieHeader,
            xsrfToken,
          }),
        },
      );
      if (!res.ok) {
        failed += 1;
        continue;
      }
      const blob = await res.blob();
      await writeBlobUnderRoot(courseRoot, f.relativePath, blob);
      blobByPath.set(f.relativePath, blob);
      written += 1;
    } catch {
      failed += 1;
    }
  }

  onProgress?.("Importando a IEStudio", total, total);
  const imported = await importBlackboardTree(
    courseId,
    courseDisplayName,
    "",
    tree,
    (done, t) => onProgress?.("Importando a IEStudio", done, t),
    (relativePath) => Promise.resolve(blobByPath.get(relativePath) ?? null),
  );

  return { written, failed, ...imported };
}
