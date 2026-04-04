export const runtime = "nodejs";

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const MIME_MAP: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".md": "text/markdown",
  ".json": "application/json",
  ".zip": "application/zip",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
};

function guessMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_MAP[ext] ?? "application/octet-stream";
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const filePath = searchParams.get("path");

  if (!filePath) {
    return Response.json({ error: "path query param requerido" }, { status: 400 });
  }

  const resolved = path.resolve(filePath);

  try {
    const info = await stat(resolved);
    if (!info.isFile()) {
      return Response.json({ error: "No es un archivo" }, { status: 404 });
    }
  } catch {
    return Response.json({ error: "Archivo no encontrado" }, { status: 404 });
  }

  const data = await readFile(resolved);
  const mime = guessMime(resolved);

  return new Response(data, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(data.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
