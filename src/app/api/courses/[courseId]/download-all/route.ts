export const runtime = "nodejs";

import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import archiver from "archiver";
import { load } from "cheerio";

const BLACKBOARD_BASE = "https://blackboard.ie.edu";
const MAX_DEPTH = 20;
const MAX_SEGMENT_LENGTH = 80;

type DownloadAllBody = {
  basePath?: string;
  baseUrl?: string;
  cookieHeader?: string;
  xsrfToken?: string;
  courseName?: string;
  /** En Vercel / sin disco escribible: empaqueta en ZIP (temp + stream al cliente). */
  responseMode?: "json" | "zip";
};

type BbContentsResponse = {
  results?: BbContentItem[];
  paging?: { nextPage?: string; count?: number };
};

type BbAttachmentsResponse = {
  results?: BbAttachment[];
};

type BbContentItem = {
  id?: string;
  title?: string;
  contentHandler?: string;
  contentDetail?: Record<string, unknown>;
  parentId?: string;
  body?: {
    rawText?: string;
    displayText?: string;
  };
};

type BbAttachment = {
  id?: string;
  title?: string;
  fileName?: string;
  name?: string;
  downloadUrl?: string;
  permanentUrl?: string;
  url?: string;
  links?: { download?: { href?: string } };
};

type TreeFolder = { name: string; parentPath: string | null };
type TreeFile = { name: string; parentPath: string | null; relativePath: string };
type DownloadTree = { folders: TreeFolder[]; files: TreeFile[] };

/* ── Helpers ── */

function sanitizeName(input: string, fallback: string): string {
  const out = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  const safe = out || fallback;
  if (safe.length <= MAX_SEGMENT_LENGTH) return safe;
  const ext = path.extname(safe);
  const base = safe.slice(0, MAX_SEGMENT_LENGTH - ext.length).trim();
  return (base || fallback) + ext;
}

function getFileInfo(item: BbContentItem): {
  permanentUrl: string;
  fileName: string;
} | null {
  const detail = item.contentDetail;
  if (!detail || typeof detail !== "object") return null;
  const wrapper = (detail as Record<string, unknown>)["resource/x-bb-file"];
  if (!wrapper || typeof wrapper !== "object") return null;
  const file = (wrapper as Record<string, unknown>).file;
  if (!file || typeof file !== "object") return null;
  const f = file as Record<string, unknown>;
  const permanentUrl = typeof f.permanentUrl === "string" ? f.permanentUrl : "";
  const fileName = typeof f.fileName === "string" ? f.fileName : "";
  if (!permanentUrl) return null;
  return { permanentUrl, fileName };
}

const CONTAINER_HANDLERS = new Set([
  "resource/x-bb-folder",
  "resource/x-bb-lesson",
  "resource/x-bb-learning-module",
  "resource/x-bb-document",
  "resource/x-bb-item",
]);

/* ── Blackboard fetch ── */

async function bbFetchJson(
  baseUrl: string,
  endpointPath: string,
  cookieHeader: string,
  xsrfToken: string,
): Promise<BbContentsResponse> {
  const headers: HeadersInit = { Accept: "application/json" };
  if (cookieHeader) headers["Cookie"] = cookieHeader;
  if (xsrfToken) headers["X-Blackboard-xsrf-token"] = xsrfToken;
  const url = endpointPath.startsWith("http")
    ? endpointPath
    : `${baseUrl}${endpointPath}`;
  const res = await fetch(url, { method: "GET", headers, redirect: "follow" });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Blackboard ${res.status}: ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as BbContentsResponse;
}

async function bbFetchAllResults(
  baseUrl: string,
  endpointPath: string,
  cookieHeader: string,
  xsrfToken: string,
): Promise<BbContentItem[]> {
  const all: BbContentItem[] = [];
  const sep = endpointPath.includes("?") ? "&" : "?";
  let nextPath = `${endpointPath}${sep}limit=200`;
  let guard = 0;
  while (nextPath && guard < 50) {
    guard += 1;
    const page = await bbFetchJson(baseUrl, nextPath, cookieHeader, xsrfToken);
    if (Array.isArray(page.results)) all.push(...page.results);
    const np = page.paging?.nextPage;
    nextPath = typeof np === "string" && np.startsWith("/") ? np : "";
  }
  return all;
}

async function bbDownloadBinary(
  absoluteUrl: string,
  cookieHeader: string,
  xsrfToken: string,
): Promise<Buffer> {
  const headers: HeadersInit = {};
  if (cookieHeader) headers["Cookie"] = cookieHeader;
  if (xsrfToken) headers["X-Blackboard-xsrf-token"] = xsrfToken;
  const res = await fetch(absoluteUrl, { method: "GET", headers, redirect: "follow" });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Descarga ${res.status}: ${detail.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function pickString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getAttachmentDownloadUrl(att: BbAttachment): string {
  return (
    pickString(att.downloadUrl) ||
    pickString(att.permanentUrl) ||
    pickString(att.url) ||
    pickString(att.links?.download?.href)
  );
}

function getAttachmentFileName(att: BbAttachment): string {
  const guessedFromUrl = (() => {
    const raw = getAttachmentDownloadUrl(att);
    if (!raw) return "";
    const clean = raw.split("?")[0] ?? "";
    const segment = clean.split("/").pop() ?? "";
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  })();
  return (
    pickString(att.fileName) ||
    pickString(att.name) ||
    pickString(att.title) ||
    guessedFromUrl
  );
}

function decodeHtmlQuotes(input: string): string {
  return input.replace(/&quot;/g, "\"");
}

/* ── Recursive crawler ── */

type CrawlStats = {
  downloaded: number;
  folders: number;
  visited: number;
  skipped: number;
};

async function crawlContents(
  courseId: string,
  currentFolder: string,
  baseUrl: string,
  cookieHeader: string,
  xsrfToken: string,
  seenIds: Set<string>,
  depth: number,
  tree: DownloadTree,
  treePath: string | null,
  containerId?: string,
): Promise<CrawlStats> {
  if (depth > MAX_DEPTH) return { downloaded: 0, folders: 0, visited: 0, skipped: 0 };

  const enc = encodeURIComponent(courseId);
  const endpointPath = containerId
    ? `/learn/api/v1/courses/${enc}/contents/${encodeURIComponent(containerId)}/children`
    : `/learn/api/v1/courses/${enc}/contents`;

  let results: BbContentItem[];
  try {
    results = await bbFetchAllResults(baseUrl, endpointPath, cookieHeader, xsrfToken);
  } catch {
    return { downloaded: 0, folders: 0, visited: 0, skipped: 0 };
  }

  let downloaded = 0;
  let folders = 0;
  let visited = 0;
  let skipped = 0;

  for (const item of results) {
    visited += 1;
    const handler = typeof item.contentHandler === "string" ? item.contentHandler : "";
    const title = sanitizeName(item.title ?? "", "Untitled");

    // Try attachments for every item type (folder, lesson, item, page, etc.).
    // Some Blackboard entries keep real files only in /attachments.
    if (item.id) {
      try {
        const attachmentsPath = `/learn/api/v1/courses/${enc}/contents/${encodeURIComponent(item.id)}/attachments`;
        const attachmentsRes = (await bbFetchJson(
          baseUrl,
          attachmentsPath,
          cookieHeader,
          xsrfToken,
        )) as BbAttachmentsResponse;
        const attachments = Array.isArray(attachmentsRes.results) ? attachmentsRes.results : [];

        for (const att of attachments) {
          const rawUrl = getAttachmentDownloadUrl(att);
          if (!rawUrl) continue;
          const absolute = rawUrl.startsWith("http") ? rawUrl : `${baseUrl}${rawUrl}`;
          const fileName = sanitizeName(getAttachmentFileName(att) || `${title}-attachment`, "attachment");
          try {
            const fileBytes = await bbDownloadBinary(absolute, cookieHeader, xsrfToken);
            const targetFile = path.join(currentFolder, fileName);
            await writeFile(targetFile, fileBytes);
            downloaded += 1;

            const relPath = treePath ? `${treePath}/${fileName}` : fileName;
            tree.files.push({ name: fileName, parentPath: treePath, relativePath: relPath });
          } catch {
            skipped += 1;
          }
        }
      } catch {
        // /attachments can return 403/404 for unsupported content; ignore and continue.
      }
    }

    if (handler === "resource/x-bb-document") {
      const html =
        (typeof item.body?.rawText === "string" && item.body.rawText.trim()) ||
        (typeof item.body?.displayText === "string" && item.body.displayText.trim()) ||
        "";

      if (html) {
        try {
          const $ = load(html);
          const anchors = $("a[data-bbfile]");
          for (const el of anchors.toArray()) {
            try {
              const href = $(el).attr("href") ?? "";
              if (!href) continue;
              const absolute = href.startsWith("http") ? href : `${baseUrl}${href}`;

              const bbFileRaw = $(el).attr("data-bbfile") ?? "";
              if (!bbFileRaw) continue;
              const bbFileJson = decodeHtmlQuotes(bbFileRaw);
              const parsed = JSON.parse(bbFileJson) as { displayName?: string };
              const fileName = sanitizeName(parsed.displayName ?? "document-attachment", "document-attachment");

              const fileBytes = await bbDownloadBinary(absolute, cookieHeader, xsrfToken);
              const targetFile = path.join(currentFolder, fileName);
              await writeFile(targetFile, fileBytes);
              downloaded += 1;

              const relPath = treePath ? `${treePath}/${fileName}` : fileName;
              tree.files.push({ name: fileName, parentPath: treePath, relativePath: relPath });
            } catch {
              skipped += 1;
            }
          }
        } catch {
          skipped += 1;
        }
      }
    }

    if (CONTAINER_HANDLERS.has(handler)) {
      if (!item.id || seenIds.has(item.id)) { skipped += 1; continue; }
      seenIds.add(item.id);

      const isUltraDocumentBody =
        handler === "resource/x-bb-document" &&
        title.trim().toLowerCase() === "ultradocumentbody";

      const nextFolder = isUltraDocumentBody ? currentFolder : path.join(currentFolder, title);
      if (!isUltraDocumentBody) {
        await mkdir(nextFolder, { recursive: true });
        folders += 1;
        tree.folders.push({ name: title, parentPath: treePath });
      }

      const childPath = isUltraDocumentBody
        ? treePath
        : (treePath ? `${treePath}/${title}` : title);
      const sub = await crawlContents(
        courseId, nextFolder, baseUrl, cookieHeader, xsrfToken,
        seenIds, depth + 1, tree, childPath, item.id,
      );
      downloaded += sub.downloaded;
      folders += sub.folders;
      visited += sub.visited;
      skipped += sub.skipped;
      continue;
    }

    if (handler === "resource/x-bb-file") {
      const info = getFileInfo(item);
      if (!info) { skipped += 1; continue; }

      const fileName = sanitizeName(info.fileName || item.title || "file", "file");
      const absolute = info.permanentUrl.startsWith("http")
        ? info.permanentUrl
        : `${baseUrl}${info.permanentUrl}`;

      try {
        const fileBytes = await bbDownloadBinary(absolute, cookieHeader, xsrfToken);
        const targetFile = path.join(currentFolder, fileName);
        await writeFile(targetFile, fileBytes);
        downloaded += 1;

        const relPath = treePath ? `${treePath}/${fileName}` : fileName;
        tree.files.push({ name: fileName, parentPath: treePath, relativePath: relPath });
      } catch {
        skipped += 1;
      }
      continue;
    }

    console.log("Ignorado:", title, handler);
    skipped += 1;
  }

  return { downloaded, folders, visited, skipped };
}

function buildZipBuffer(
  filesRoot: string,
  tree: DownloadTree,
  manifest: Record<string, unknown>,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 5 } });
    const chunks: Buffer[] = [];
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.once("error", reject);
    archive.once("end", () => resolve(Buffer.concat(chunks)));
    archive.append(JSON.stringify(manifest), {
      name: "__iestudio_manifest__.json",
    });
    const rootResolved = path.resolve(filesRoot);
    for (const f of tree.files) {
      const rel = f.relativePath.replace(/\\/g, "/");
      const absNorm = path.resolve(filesRoot, ...rel.split("/"));
      if (
        absNorm !== rootResolved &&
        !absNorm.startsWith(rootResolved + path.sep)
      ) {
        continue;
      }
      archive.file(absNorm, { name: rel });
    }
    void archive.finalize().catch(reject);
  });
}

function zipDownloadBasename(courseLabel: string, courseId: string): string {
  const base = sanitizeName(courseLabel || courseId, "curso")
    .replace(/[\r\n]/g, "_")
    .slice(0, 100);
  const stem = base || "curso";
  const ascii = stem.replace(/[^\x20-\x7E]+/g, "_").replace(/["\\]/g, "_") || "curso";
  return `${ascii}.zip`;
}

/* ── Route handler ── */

export async function POST(
  req: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  try {
    const { courseId } = await params;
    const body = (await req.json().catch(() => ({}))) as DownloadAllBody;
    const rawBasePath = (body.basePath ?? "").trim();
    const wantZip = body.responseMode === "zip";
    const baseUrl = (body.baseUrl ?? BLACKBOARD_BASE).trim().replace(/\/+$/, "");
    const cookieHeader = typeof body.cookieHeader === "string" ? body.cookieHeader : "";
    const xsrfToken = typeof body.xsrfToken === "string" ? body.xsrfToken : "";
    const courseName = typeof body.courseName === "string" ? body.courseName.trim() : "";

    if (!courseId) {
      return Response.json({ error: "courseId requerido" }, { status: 400 });
    }

    const dirName = sanitizeName(courseName || courseId, "course");

    let finalPath: string;
    let workRoot: string | null = null;

    if (wantZip) {
      workRoot = path.join(os.tmpdir(), `iestudio-bb-${randomUUID()}`);
      finalPath = path.join(workRoot, dirName);
    } else {
      const basePath =
        rawBasePath || path.join(process.cwd(), "downloads", "blackboard");
      finalPath = path.join(basePath, dirName);
    }

    await mkdir(finalPath, { recursive: true });

    const tree: DownloadTree = { folders: [], files: [] };

    const stats = await crawlContents(
      courseId, finalPath, baseUrl, cookieHeader, xsrfToken,
      new Set<string>(), 0, tree, null,
    );

    if (wantZip) {
      const manifest = {
        version: 1 as const,
        courseId,
        courseName: courseName || courseId,
        tree,
        stats: {
          downloadedFiles: stats.downloaded,
          skippedItems: stats.skipped,
          visitedItems: stats.visited,
          createdFolders: stats.folders,
        },
      };
      let buf: Buffer;
      try {
        buf = await buildZipBuffer(finalPath, tree, manifest);
      } finally {
        if (workRoot) {
          await rm(workRoot, { recursive: true, force: true }).catch(() => {});
        }
      }
      const zipName = zipDownloadBasename(courseName, courseId);
      const utf8Name = encodeURIComponent(
        `${sanitizeName(courseName || courseId, "curso").slice(0, 100) || "curso"}.zip`,
      );
      return new Response(new Uint8Array(buf), {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${zipName}"; filename*=UTF-8''${utf8Name}`,
        },
      });
    }

    return Response.json({
      ok: true,
      message: "Descarga completada",
      courseId,
      path: finalPath,
      downloadedFiles: stats.downloaded,
      createdFolders: stats.folders,
      visitedItems: stats.visited,
      skippedItems: stats.skipped,
      tree,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Error desconocido";
    return Response.json(
      { ok: false, error: "Error en descarga recursiva", detail },
      { status: 500 },
    );
  }
}
