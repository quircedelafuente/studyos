"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useCloudSyncStatus } from "@/components/providers/CloudSyncProvider";
import type { CourseFileStored, CourseFolder } from "@/types/dashboard";
import { courseAccentFromId } from "@/lib/course-avatar";
import { idbGetBlob } from "@/lib/course-files-idb";
import {
  IESTUDIO_FILE_DRAG_MIME,
  addDroppedFilesToCourse,
  createFolderInCourse,
  deleteFileFromCourse,
  deleteFolderFromCourse,
  hasIestudioFileDrag,
  moveCourseFileToFolder,
  openCourseFile,
  parseIestudioFileDrag,
} from "@/lib/course-mutations";
import {
  MANUAL_COURSES_CHANGED_EVENT,
  MANUAL_COURSES_STORAGE_KEY,
  loadManualCourses,
  ensureManualCourseForBbLearnId,
} from "@/lib/manual-courses-storage";
import { BB_COURSES_STORAGE_CHANGED } from "@/lib/blackboard-storage";
import {
  BB_COURSE_CURATION_CHANGED,
} from "@/lib/bb-course-curation";
import {
  BB_COURSE_FILTER_CHANGED,
  loadCourseFilterMode,
  saveCourseFilterMode,
} from "@/lib/bb-course-filter-prefs";
import { readBbDisplayedCoursesSnapshot } from "@/lib/bb-displayed-courses";
import {
  courseCategoryTotals,
  type CourseFilterMode,
} from "@/lib/blackboard-api";
import { loadBbConfig } from "@/lib/blackboard-config";
import { bridgeBlackboardAuthSnapshot } from "@/lib/blackboard-bridge-client";
import {
  importBlackboardTree,
  importBlackboardTreeFromZipBuffer,
  type DownloadTree,
} from "@/lib/bb-download-import";
import {
  downloadManifestToCourseFolder,
  pickWritableDirectory,
  supportsFolderPicker,
} from "@/lib/bb-manifest-to-local";
import { CourseFilterSelect } from "./CourseFilterSelect";
import { CourseGlyph } from "./CourseGlyph";
import { IconFolder } from "./icons";

function fileBadge(kind: CourseFileStored["kind"]) {
  const map: Record<CourseFileStored["kind"], string> = {
    pdf: "PDF",
    nota: "Nota",
    slide: "Slides",
    enlace: "Enlace",
    other: "Archivo",
  };
  return map[kind];
}

const TEXT_PREVIEW_MAX = 120_000;

/** Host desplegado (p. ej. Vercel): sin escritura en disco del servidor. */
function isDeployedHost(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h !== "localhost" && h !== "127.0.0.1";
}

function sanitizeLocalFolderName(name: string, fallback: string): string {
  const out = name
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return out || fallback;
}

function guessMimeFromName(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".gif")) return "image/gif";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".svg")) return "image/svg+xml";
  if (n.endsWith(".txt") || n.endsWith(".md") || n.endsWith(".csv"))
    return "text/plain";
  return "";
}

function effectiveMime(blob: Blob, file: CourseFileStored): string {
  return (blob.type && blob.type !== "application/octet-stream"
    ? blob.type
    : guessMimeFromName(file.name)) || "application/octet-stream";
}

function shouldPreviewAsText(mime: string, file: CourseFileStored): boolean {
  if (mime.startsWith("text/") || mime === "application/json") return true;
  if (file.kind === "nota" && !mime.startsWith("image/")) {
    return (
      mime === "" ||
      mime === "application/octet-stream" ||
      !mime.startsWith("application/pdf")
    );
  }
  return false;
}

function FileInlinePreview({
  file,
  onClose,
  onOpenExternal,
}: {
  file: CourseFileStored;
  onClose: () => void;
  onOpenExternal: () => void;
}) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "text"; text: string; truncated: boolean }
    | { status: "blob"; url: string; mime: string }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    const urlRef = { current: null as string | null };

    (async () => {
      const blob = await idbGetBlob(file.blobKey ?? file.id);
      if (cancelled) return;
      if (!blob) {
        setState({
          status: "error",
          message:
            "No se encontró el archivo en el almacenamiento local del navegador.",
        });
        return;
      }

      const mime = effectiveMime(blob, file);

      if (shouldPreviewAsText(mime, file)) {
        try {
          const slice =
            blob.size > TEXT_PREVIEW_MAX + 1
              ? blob.slice(0, TEXT_PREVIEW_MAX + 1)
              : blob;
          let text = await slice.text();
          const truncated =
            blob.size > TEXT_PREVIEW_MAX || text.length > TEXT_PREVIEW_MAX;
          if (text.length > TEXT_PREVIEW_MAX) {
            text = text.slice(0, TEXT_PREVIEW_MAX);
          }
          if (cancelled) return;
          setState({ status: "text", text, truncated });
        } catch {
          const url = URL.createObjectURL(blob);
          urlRef.current = url;
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          setState({ status: "blob", url, mime });
        }
        return;
      }

      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      setState({ status: "blob", url, mime });
    })();

    return () => {
      cancelled = true;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [file.id, file.blobKey, file.name, file.kind]);

  const isPdf = (mime: string) =>
    mime === "application/pdf" ||
    file.kind === "pdf" ||
    file.name.toLowerCase().endsWith(".pdf");

  return (
    <div className="mt-1 border-t border-[var(--border)] bg-[var(--surface-muted)]/60 px-2 py-3 pl-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
          Vista previa
        </span>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onOpenExternal}
            className="rounded-lg border border-[var(--border)] bg-[var(--canvas)] px-2.5 py-1 text-xs font-medium text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
          >
            Abrir en pestaña
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2.5 py-1 text-xs font-medium text-[var(--ink-muted)] transition hover:bg-[var(--border)]/40 hover:text-[var(--ink)]"
          >
            Cerrar
          </button>
        </div>
      </div>

      {state.status === "loading" ? (
        <p className="py-6 text-center text-sm text-[var(--ink-muted)]">
          Cargando vista previa…
        </p>
      ) : null}

      {state.status === "error" ? (
        <p className="py-4 text-center text-sm text-red-600/90">
          {state.message}
        </p>
      ) : null}

      {state.status === "text" ? (
        <pre className="max-h-[min(24rem,50vh)] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--border)] bg-[var(--canvas)] p-3 font-mono-cli text-xs leading-relaxed text-[var(--ink)]">
          {state.text}
          {state.truncated ? (
            <span className="mt-2 block text-[var(--ink-muted)]">
              … (recortado; usa “Abrir en pestaña” para ver el archivo completo)
            </span>
          ) : null}
        </pre>
      ) : null}

      {state.status === "blob" ? (
        isPdf(state.mime) ? (
          <iframe
            title={`Vista previa: ${file.name}`}
            src={state.url}
            className="h-[min(32rem,55vh)] w-full rounded-lg border border-[var(--border)] bg-white"
          />
        ) : state.mime.startsWith("image/") ? (
          // eslint-disable-next-line @next/next/no-img-element -- URL de objeto local (blob)
          <img
            src={state.url}
            alt=""
            className="mx-auto max-h-[min(28rem,50vh)] max-w-full rounded-lg border border-[var(--border)] object-contain"
          />
        ) : (
          <div className="rounded-lg border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--ink-muted)]">
            <p>No hay vista previa integrada para este tipo de archivo.</p>
            <p className="mt-2">
              Usa{" "}
              <span className="font-medium text-[var(--ink)]">Abrir en pestaña</span>{" "}
              para verlo con el programa predeterminado.
            </p>
          </div>
        )
      ) : null}
    </div>
  );
}

/** Ruta legible para la carpeta padre al crear (o "Raíz"). */
function folderPathLabel(
  folders: CourseFolder[],
  folderId: string | null,
): string {
  if (folderId === null) return "Raíz";
  const byId = new Map(folders.map((f) => [f.id, f]));
  const parts: string[] = [];
  let id: string | null = folderId;
  let guard = 0;
  while (id !== null && guard++ < 500) {
    const f = byId.get(id);
    if (!f) return "Raíz";
    parts.unshift(f.name);
    id = f.parentId;
  }
  return parts.length ? parts.join(" / ") : "Raíz";
}

type DocCourseVM = {
  id: string;
  name: string;
  accent: string;
  files: CourseFileStored[];
  folders: CourseFolder[];
};

type DocumentsEmptyKind =
  | "ok"
  | "syncing"
  | "no_config"
  | "no_bb_cache"
  | "filtered";

/** `root` = raíz del curso; string = id de carpeta. */
type DocDropHighlight = null | "root" | string;

function tryHandleInternalFileDrop(
  e: React.DragEvent,
  courseId: string,
  targetFolderId: string | null,
  onRefresh: () => void,
): boolean {
  const payload = parseIestudioFileDrag(e.dataTransfer);
  if (!payload || payload.courseId !== courseId) return false;
  moveCourseFileToFolder(courseId, payload.fileId, targetFolderId);
  onRefresh();
  return true;
}

type FileRowProps = {
  courseId: string;
  file: CourseFileStored;
  onRefresh: () => void;
  previewFileId: string | null;
  onToggleFilePreview: (fileId: string) => void;
  onDragEnd?: () => void;
};

function FileRow({
  courseId,
  file: f,
  onRefresh,
  previewFileId,
  onToggleFilePreview,
  onDragEnd,
}: FileRowProps) {
  const previewOpen = previewFileId === f.id;

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(
          IESTUDIO_FILE_DRAG_MIME,
          JSON.stringify({ courseId, fileId: f.id }),
        );
        e.dataTransfer.setData("text/plain", f.name);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={onDragEnd}
      className={`cursor-grab rounded-lg border transition active:cursor-grabbing ${
        previewOpen
          ? "border-[var(--border-strong)] bg-[var(--surface-muted)]/50"
          : "border-transparent hover:border-[var(--border)] hover:bg-[var(--surface-muted)]"
      }`}
    >
      <div className="flex items-stretch gap-0.5">
        <button
          type="button"
          draggable={false}
          onClick={() => onToggleFilePreview(f.id)}
          aria-expanded={previewOpen}
          className="flex min-w-0 flex-1 items-start gap-2 px-2 py-2 text-left"
        >
          <span
            className={`font-mono-cli mt-0.5 shrink-0 rounded border px-1 py-0.5 text-[9px] font-medium uppercase ${
              f.pinned
                ? "border-[var(--ink)] bg-[var(--ink)] text-white"
                : "border-[var(--border)] text-[var(--ink-muted)]"
            }`}
          >
            {fileBadge(f.kind)}
          </span>
          <span className="min-w-0">
            <span className="line-clamp-2 text-xs font-medium leading-snug text-[var(--ink)]">
              {f.name}
            </span>
          </span>
        </button>
        <button
          type="button"
          draggable={false}
          title="Quitar archivo"
          onClick={() => {
            deleteFileFromCourse(courseId, f.id);
            onRefresh();
          }}
          className="shrink-0 self-start rounded-lg px-1.5 py-2 text-[10px] font-semibold text-[var(--ink-muted)] hover:text-red-600"
        >
          ×
        </button>
      </div>
      {previewOpen ? (
        <FileInlinePreview
          file={f}
          onClose={() => onToggleFilePreview(f.id)}
          onOpenExternal={() => void openCourseFile(f)}
        />
      ) : null}
    </div>
  );
}

type FolderTreeItemProps = {
  courseId: string;
  folder: CourseFolder;
  folders: CourseFolder[];
  files: CourseFileStored[];
  onRefresh: () => void;
  dropHighlight: DocDropHighlight;
  setDropHighlight: (v: DocDropHighlight) => void;
  selectedParentId: string | null;
  onSelectParentId: (id: string) => void;
  previewFileId: string | null;
  onToggleFilePreview: (fileId: string) => void;
  onFileDragEnd?: () => void;
};

function FolderTreeItem({
  courseId,
  folder,
  folders,
  files,
  onRefresh,
  dropHighlight,
  setDropHighlight,
  selectedParentId,
  onSelectParentId,
  previewFileId,
  onToggleFilePreview,
  onFileDragEnd,
}: FolderTreeItemProps) {
  const subfolders = useMemo(
    () =>
      folders
        .filter((f) => f.parentId === folder.id)
        .sort((a, b) => a.name.localeCompare(b.name, "es")),
    [folders, folder.id],
  );
  const filesHere = useMemo(
    () =>
      files
        .filter((f) => f.folderId === folder.id)
        .sort((a, b) => a.name.localeCompare(b.name, "es")),
    [files, folder.id],
  );

  const folderDropHandlers = {
    onDragOver: (e: React.DragEvent) => {
      const internal = hasIestudioFileDrag(e.dataTransfer);
      const files = Array.from(e.dataTransfer.types).includes("Files");
      if (!internal && !files) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = internal ? "move" : "copy";
    },
    onDragEnter: (e: React.DragEvent) => {
      if (
        !hasIestudioFileDrag(e.dataTransfer) &&
        !Array.from(e.dataTransfer.types).includes("Files")
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      setDropHighlight(folder.id);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
        setDropHighlight(null);
      }
    },
    onDrop: async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropHighlight(null);
      if (tryHandleInternalFileDrop(e, courseId, folder.id, onRefresh)) return;
      const { files: dt } = e.dataTransfer;
      if (dt?.length) {
        await addDroppedFilesToCourse(courseId, Array.from(dt), folder.id);
        onRefresh();
      }
    },
  };

  function handleDeleteFolder(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (
      !window.confirm(
        `¿Eliminar la carpeta “${folder.name}” y todo su contenido?`,
      )
    ) {
      return;
    }
    deleteFolderFromCourse(courseId, folder.id);
    onRefresh();
  }

  const isEmpty = subfolders.length === 0 && filesHere.length === 0;
  const isSelected = selectedParentId === folder.id;

  function toggleDetailsOpen(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const el = (e.currentTarget as HTMLElement).closest("details");
    if (el) el.open = !el.open;
  }

  return (
    <details
      className={`group rounded-xl border bg-[var(--surface-muted)]/40 transition ${
        isSelected
          ? "border-[var(--ink)] ring-1 ring-[var(--ink)]/30"
          : "border-[var(--border)]"
      } ${
        dropHighlight === folder.id
          ? "ring-2 ring-[var(--ink)] ring-offset-2 ring-offset-[var(--canvas)]"
          : ""
      }`}
      {...folderDropHandlers}
    >
      <summary className="flex cursor-default list-none items-center gap-2 px-3 py-2.5 text-sm [&::-webkit-details-marker]:hidden">
        <button
          type="button"
          data-folder-chevron
          onClick={toggleDetailsOpen}
          className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-[var(--ink-muted)] transition hover:bg-[var(--surface-muted)] group-open:[&_svg]:rotate-90"
          aria-label="Abrir o cerrar carpeta"
        >
          <svg
            className="h-4 w-4 transition-transform duration-200"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
        <button
          type="button"
          data-folder-select
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSelectParentId(folder.id);
          }}
          aria-pressed={isSelected}
          aria-label={`Seleccionar “${folder.name}” como destino al crear carpeta`}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-0.5 text-left outline-none ring-[var(--ink)] focus-visible:ring-2"
        >
          <IconFolder className="h-4 w-4 shrink-0 text-[var(--ink-muted)]" />
          <span className="min-w-0 flex-1 truncate font-medium text-[var(--ink)]">
            {folder.name}
          </span>
        </button>
        <button
          type="button"
          data-folder-delete
          title="Eliminar carpeta"
          onClick={handleDeleteFolder}
          className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-[var(--ink-muted)] hover:bg-red-500/10 hover:text-red-600"
        >
          ×
        </button>
      </summary>
      <div className="space-y-2 border-t border-[var(--border)] bg-[var(--canvas)] px-2 py-3 pl-4">
        {subfolders.map((sf) => (
          <FolderTreeItem
            key={sf.id}
            courseId={courseId}
            folder={sf}
            folders={folders}
            files={files}
            onRefresh={onRefresh}
            dropHighlight={dropHighlight}
            setDropHighlight={setDropHighlight}
            selectedParentId={selectedParentId}
            onSelectParentId={onSelectParentId}
            previewFileId={previewFileId}
            onToggleFilePreview={onToggleFilePreview}
            onFileDragEnd={onFileDragEnd}
          />
        ))}
        {filesHere.map((f) => (
          <FileRow
            key={f.id}
            courseId={courseId}
            file={f}
            onRefresh={onRefresh}
            previewFileId={previewFileId}
            onToggleFilePreview={onToggleFilePreview}
            onDragEnd={onFileDragEnd}
          />
        ))}
        {isEmpty ? (
          <p className="px-1 py-2 text-center text-xs text-[var(--ink-faint)]">
            Carpeta vacía. Suelta archivos del ordenador o arrastra aquí un archivo
            del curso para moverlo.
          </p>
        ) : null}
      </div>
    </details>
  );
}

type RootTreeProps = {
  courseId: string;
  folders: CourseFolder[];
  files: CourseFileStored[];
  onRefresh: () => void;
  dropHighlight: DocDropHighlight;
  setDropHighlight: (v: DocDropHighlight) => void;
  selectedParentId: string | null;
  onSelectParentId: (id: string | null) => void;
  previewFileId: string | null;
  onToggleFilePreview: (fileId: string) => void;
  onFileDragEnd?: () => void;
};

function RootFolderTree({
  courseId,
  folders,
  files,
  onRefresh,
  dropHighlight,
  setDropHighlight,
  selectedParentId,
  onSelectParentId,
  previewFileId,
  onToggleFilePreview,
  onFileDragEnd,
}: RootTreeProps) {
  const rootFolders = useMemo(
    () =>
      folders
        .filter((f) => f.parentId === null)
        .sort((a, b) => a.name.localeCompare(b.name, "es")),
    [folders],
  );
  const rootFiles = useMemo(
    () =>
      files
        .filter((f) => f.folderId === null)
        .sort((a, b) => a.name.localeCompare(b.name, "es")),
    [files],
  );

  const empty = rootFolders.length === 0 && rootFiles.length === 0;

  const rootSelected = selectedParentId === null;

  const rootDropHandlers = {
    onDragOver: (e: React.DragEvent) => {
      const internal = hasIestudioFileDrag(e.dataTransfer);
      const hasFiles = Array.from(e.dataTransfer.types).includes("Files");
      if (!internal && !hasFiles) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = internal ? "move" : "copy";
    },
    onDragEnter: (e: React.DragEvent) => {
      if (
        !hasIestudioFileDrag(e.dataTransfer) &&
        !Array.from(e.dataTransfer.types).includes("Files")
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      setDropHighlight("root");
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
        setDropHighlight(null);
      }
    },
    onDrop: async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropHighlight(null);
      if (tryHandleInternalFileDrop(e, courseId, null, onRefresh)) return;
      const { files: dt } = e.dataTransfer;
      if (dt?.length) {
        await addDroppedFilesToCourse(courseId, Array.from(dt), null);
        onRefresh();
      }
    },
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => onSelectParentId(null)}
        aria-pressed={rootSelected}
        className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition ${
          dropHighlight === "root"
            ? "border-[var(--border-strong)] bg-[var(--surface-muted)] text-[var(--ink)] ring-2 ring-[var(--ink)] ring-offset-2 ring-offset-[var(--canvas)]"
            : rootSelected
              ? "border-[var(--ink)] bg-[var(--surface-muted)] text-[var(--ink)] ring-1 ring-[var(--ink)]/30"
              : "border-[var(--border)] bg-[var(--canvas)] text-[var(--ink-muted)] hover:border-[var(--border-strong)] hover:text-[var(--ink)]"
        }`}
        {...rootDropHandlers}
      >
        <IconFolder className="h-4 w-4 shrink-0 opacity-70" />
        <span>Raíz del curso</span>
      </button>
      {rootFolders.map((f) => (
        <FolderTreeItem
          key={f.id}
          courseId={courseId}
          folder={f}
          folders={folders}
          files={files}
          onRefresh={onRefresh}
          dropHighlight={dropHighlight}
          setDropHighlight={setDropHighlight}
          selectedParentId={selectedParentId}
          onSelectParentId={onSelectParentId}
          previewFileId={previewFileId}
          onToggleFilePreview={onToggleFilePreview}
          onFileDragEnd={onFileDragEnd}
        />
      ))}
      {rootFiles.map((f) => (
        <FileRow
          key={f.id}
          courseId={courseId}
          file={f}
          onRefresh={onRefresh}
          previewFileId={previewFileId}
          onToggleFilePreview={onToggleFilePreview}
          onDragEnd={onFileDragEnd}
        />
      ))}
      {empty ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-10 text-center text-sm text-[var(--ink-faint)]">
          Sin archivos en la raíz. Crea una carpeta (desplegable) o suelta archivos
          en este panel.
        </p>
      ) : null}
    </div>
  );
}

export function DocumentsPanel() {
  const { status: sessionStatus } = useSession();
  const cloudSync = useCloudSyncStatus();
  const [courses, setCourses] = useState<DocCourseVM[]>([]);
  const [emptyKind, setEmptyKind] = useState<DocumentsEmptyKind>("ok");
  const [hydrated, setHydrated] = useState(false);
  const [activeId, setActiveId] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [selectedCreateParentId, setSelectedCreateParentId] = useState<
    string | null
  >(null);
  const [dragOverNavId, setDragOverNavId] = useState<string | null>(null);
  const [dragOverMain, setDragOverMain] = useState(false);
  const [dropHighlight, setDropHighlight] = useState<DocDropHighlight>(null);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [downloadAllBusy, setDownloadAllBusy] = useState(false);
  const [downloadAllMsg, setDownloadAllMsg] = useState<string | null>(null);
  const [downloadAllErr, setDownloadAllErr] = useState<string | null>(null);
  const [syncAllBusy, setSyncAllBusy] = useState(false);
  const [syncAllMsg, setSyncAllMsg] = useState<string | null>(null);
  const [syncAllErr, setSyncAllErr] = useState<string | null>(null);
  const [filterUi, setFilterUi] = useState<{
    mode: CourseFilterMode;
    catTotals: ReturnType<typeof courseCategoryTotals>;
    curatedLength: number;
  }>(() => ({
    mode: loadCourseFilterMode(),
    catTotals: courseCategoryTotals([]),
    curatedLength: 0,
  }));

  const toggleFilePreview = useCallback((fileId: string) => {
    setPreviewFileId((prev) => (prev === fileId ? null : fileId));
  }, []);

  const clearDropTargets = useCallback(() => {
    setDropHighlight(null);
    setDragOverMain(false);
  }, []);

  const refresh = useCallback(() => {
    const snap = readBbDisplayedCoursesSnapshot();
    setFilterUi({
      mode: snap.filterMode,
      catTotals: courseCategoryTotals(snap.curatedCourses),
      curatedLength: snap.curatedCourses.length,
    });
    if (
      sessionStatus === "authenticated" &&
      cloudSync &&
      !cloudSync.initialSyncDone &&
      cloudSync.cloudEnabled !== false
    ) {
      setEmptyKind("syncing");
      setCourses([]);
      setActiveId("");
      return;
    }
    if (!snap.hasConfig) {
      setEmptyKind("no_config");
      setCourses([]);
      setActiveId("");
      return;
    }
    if (snap.apiCourses.length === 0) {
      setEmptyKind("no_bb_cache");
      setCourses([]);
      setActiveId("");
      return;
    }
    if (snap.displayedCourses.length === 0) {
      setEmptyKind("filtered");
      setCourses([]);
      setActiveId("");
      return;
    }
    setEmptyKind("ok");
    for (const bb of snap.displayedCourses) {
      ensureManualCourseForBbLearnId(bb.learnCourseId, bb.name);
    }
    const manuals = loadManualCourses();
    const byId = new Map(manuals.map((m) => [m.id, m]));
    const list: DocCourseVM[] = snap.displayedCourses.map((bb) => {
      const manual = byId.get(bb.learnCourseId);
      return {
        id: bb.learnCourseId,
        name: bb.name,
        accent: courseAccentFromId(bb.learnCourseId),
        files: manual?.files ?? [],
        folders: manual?.folders ?? [],
      };
    });
    setCourses(list);
    setActiveId((prev) => {
      if (list.length === 0) return "";
      if (prev && list.some((c) => c.id === prev)) return prev;
      return list[0]!.id;
    });
  }, [sessionStatus, cloudSync?.initialSyncDone, cloudSync?.cloudEnabled]);

  useEffect(() => {
    refresh();
    setHydrated(true);
    function onStorage(e: StorageEvent) {
      if (e.key === MANUAL_COURSES_STORAGE_KEY) refresh();
    }
    window.addEventListener(MANUAL_COURSES_CHANGED_EVENT, refresh);
    window.addEventListener(BB_COURSES_STORAGE_CHANGED, refresh);
    window.addEventListener(BB_COURSE_CURATION_CHANGED, refresh);
    window.addEventListener(BB_COURSE_FILTER_CHANGED, refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(MANUAL_COURSES_CHANGED_EVENT, refresh);
      window.removeEventListener(BB_COURSES_STORAGE_CHANGED, refresh);
      window.removeEventListener(BB_COURSE_CURATION_CHANGED, refresh);
      window.removeEventListener(BB_COURSE_FILTER_CHANGED, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, [refresh]);

  useEffect(() => {
    setSelectedCreateParentId(null);
    setPreviewFileId(null);
  }, [activeId]);

  const active = courses.find((c) => c.id === activeId) ?? courses[0];

  useEffect(() => {
    if (!active || previewFileId === null) return;
    if (!active.files.some((f) => f.id === previewFileId)) {
      setPreviewFileId(null);
    }
  }, [active, previewFileId]);

  useEffect(() => {
    if (!active || selectedCreateParentId === null) return;
    const exists = active.folders.some((f) => f.id === selectedCreateParentId);
    if (!exists) setSelectedCreateParentId(null);
  }, [active, selectedCreateParentId]);

  const createLocationLabel = useMemo(
    () =>
      active
        ? folderPathLabel(active.folders, selectedCreateParentId)
        : "Raíz",
    [active, selectedCreateParentId],
  );

  function navDropProps(courseId: string, courseName: string) {
    return {
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      },
      onDragEnter: (e: React.DragEvent) => {
        e.preventDefault();
        setDragOverNavId(courseId);
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setDragOverNavId(null);
        }
      },
      onDrop: async (e: React.DragEvent) => {
        e.preventDefault();
        setDragOverNavId(null);
        const { files } = e.dataTransfer;
        if (files?.length) {
          ensureManualCourseForBbLearnId(courseId, courseName);
          await addDroppedFilesToCourse(courseId, Array.from(files), null);
          refresh();
        }
      },
    };
  }

  const mainDropProps =
    active && hydrated
      ? {
          onDragOver: (e: React.DragEvent) => {
            const internal = hasIestudioFileDrag(e.dataTransfer);
            const hasFiles = Array.from(e.dataTransfer.types).includes("Files");
            if (!internal && !hasFiles) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = internal ? "move" : "copy";
          },
          onDragEnter: (e: React.DragEvent) => {
            const internal = hasIestudioFileDrag(e.dataTransfer);
            const hasFiles = Array.from(e.dataTransfer.types).includes("Files");
            if (!internal && !hasFiles) return;
            e.preventDefault();
            setDragOverMain(true);
            setDropHighlight(null);
          },
          onDragLeave: (e: React.DragEvent) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setDragOverMain(false);
            }
          },
          onDrop: async (e: React.DragEvent) => {
            e.preventDefault();
            setDragOverMain(false);
            if (active && tryHandleInternalFileDrop(e, active.id, null, refresh)) {
              return;
            }
            const { files } = e.dataTransfer;
            if (files?.length && active) {
              ensureManualCourseForBbLearnId(active.id, active.name);
              await addDroppedFilesToCourse(
                active.id,
                Array.from(files),
                null,
              );
              refresh();
            }
          },
        }
      : {};

  function handleCreateFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!active || !newFolderName.trim()) return;
    createFolderInCourse(
      active.id,
      newFolderName.trim(),
      selectedCreateParentId,
    );
    setNewFolderName("");
    refresh();
  }

  async function handleDownloadAll() {
    if (!active || downloadAllBusy) return;
    const deployed = isDeployedHost();
    const canPick = supportsFolderPicker();

    let basePath = "";
    let responseMode: "json" | "zip" | "manifest" = "json";
    let courseDir: FileSystemDirectoryHandle | null = null;

    if (deployed && canPick) {
      responseMode = "manifest";
      try {
        const parentDir = await pickWritableDirectory();
        const safe = sanitizeLocalFolderName(active.name, active.id);
        courseDir = await parentDir.getDirectoryHandle(safe, { create: true });
      } catch (e) {
        if ((e as DOMException).name === "AbortError") return;
        throw e;
      }
    } else if (deployed && !canPick) {
      if (
        !window.confirm(
          "Este navegador no permite elegir una carpeta en tu disco. ¿Quieres descargar todo en un único archivo ZIP?",
        )
      ) {
        return;
      }
      responseMode = "zip";
    } else {
      const defaultPath = `./downloads/blackboard`;
      const basePathRaw = window.prompt(
        "Ruta base para guardar el curso (servidor Next.js local):",
        defaultPath,
      );
      if (basePathRaw === null) return;
      basePath = basePathRaw.trim();
      if (!basePath) return;
      responseMode = "json";
    }

    const config = loadBbConfig();
    setDownloadAllBusy(true);
    setDownloadAllErr(null);
    setDownloadAllMsg("Descargando estructura completa del curso...");
    try {
      const auth = await bridgeBlackboardAuthSnapshot(
        config?.baseUrl ?? "https://blackboard.ie.edu",
      );
      const baseUrl = config?.baseUrl ?? "https://blackboard.ie.edu";
      const res = await fetch(
        `/api/courses/${encodeURIComponent(active.id)}/download-all`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(responseMode === "json" ? { basePath } : {}),
            responseMode,
            baseUrl,
            cookieHeader: auth.cookieHeader,
            xsrfToken: auth.xsrfToken,
            courseName: active.name,
          }),
        },
      );
      const ct = res.headers.get("content-type") ?? "";

      if (responseMode === "manifest") {
        const payload = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          tree?: DownloadTree;
          error?: string;
          detail?: string;
          skippedItems?: number;
        };
        if (!res.ok || !payload.ok || !payload.tree || !courseDir) {
          throw new Error(
            payload.detail ??
              payload.error ??
              "No se pudo obtener el manifiesto del curso.",
          );
        }
        setDownloadAllMsg("Descargando archivo por archivo a tu carpeta…");
        const out = await downloadManifestToCourseFolder(
          active.id,
          active.name,
          baseUrl,
          auth.cookieHeader,
          auth.xsrfToken,
          payload.tree,
          courseDir,
          (label, done, total) => {
            setDownloadAllMsg(`${label}: ${done}/${total}…`);
          },
        );
        refresh();
        setDownloadAllMsg(
          `Listo: ${out.written} archivos guardados en la carpeta que elegiste${
            out.failed > 0 ? ` (${out.failed} fallidos)` : ""
          }. En IEStudio: ${out.importedFiles} archivos nuevos, ${out.importedFolders} carpetas (${out.skippedFiles} ya existían).`,
        );
        return;
      }

      if (responseMode === "zip" || ct.includes("application/zip")) {
        if (!res.ok) {
          const errBody = (await res.json().catch(() => ({}))) as {
            detail?: string;
            error?: string;
          };
          throw new Error(
            errBody.detail ??
              errBody.error ??
              `No se pudo generar el ZIP (HTTP ${res.status}).`,
          );
        }
        const buf = await res.arrayBuffer();
        const safe =
          active.name.replace(/[/\\?*:"|<>]/g, "_").trim().slice(0, 80) ||
          active.id;
        setDownloadAllMsg("Importando desde ZIP a IEStudio...");
        const imported = await importBlackboardTreeFromZipBuffer(
          buf,
          active.id,
          active.name,
          {
            saveZipAs: `${safe}.zip`,
            onProgress: (done, total) => {
              setDownloadAllMsg(`Importando archivos: ${done}/${total}...`);
            },
          },
        );
        refresh();
        setDownloadAllMsg(
          `Completado: ${imported.importedFiles} archivos y ${imported.importedFolders} carpetas en IEStudio (${imported.downloadedFiles} desde BB, ${imported.skippedItems} omitidos). El .zip también se guardó en tu carpeta de descargas.`,
        );
        return;
      }

      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        path?: string;
        downloadedFiles?: number;
        createdFolders?: number;
        visitedItems?: number;
        skippedItems?: number;
        tree?: DownloadTree;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !payload.ok) {
        const detail =
          payload.detail ?? payload.error ?? "No se pudo descargar el curso.";
        throw new Error(detail);
      }

      if (payload.tree && payload.path) {
        setDownloadAllMsg(
          `Importando ${payload.tree.files.length} archivos a IEStudio...`,
        );
        const imported = await importBlackboardTree(
          active.id,
          active.name,
          payload.path,
          payload.tree,
          (done, total) => {
            setDownloadAllMsg(
              `Importando archivos: ${done}/${total}...`,
            );
          },
        );
        refresh();
        setDownloadAllMsg(
          `Completado: ${imported.importedFiles} archivos y ${imported.importedFolders} carpetas importados a IEStudio (${payload.downloadedFiles ?? 0} descargados de BB, ${payload.skippedItems ?? 0} omitidos)`,
        );
      } else {
        setDownloadAllMsg(
          `${payload.message ?? "Descarga completada"}: ${payload.downloadedFiles ?? 0} archivos, ${payload.createdFolders ?? 0} carpetas → ${payload.path ?? basePath}`,
        );
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error inesperado al descargar.";
      setDownloadAllErr(
        message.includes("UNKNOWN_TYPE")
          ? "Tu extensión Blackboard Bridge está desactualizada. Recárgala en chrome://extensions y vuelve a intentarlo."
          : message,
      );
      setDownloadAllMsg(null);
    } finally {
      setDownloadAllBusy(false);
    }
  }

  async function handleSyncAllCourses() {
    if (syncAllBusy || courses.length === 0) return;
    const basePath = "./downloads/blackboard";
    const config = loadBbConfig();
    const baseUrl = config?.baseUrl ?? "https://blackboard.ie.edu";
    const deployed = isDeployedHost();
    const canPick = supportsFolderPicker();

    let parentRoot: FileSystemDirectoryHandle | undefined;
    let remoteMode: "manifest" | "zip" | null = null;

    if (deployed) {
      if (canPick) {
        try {
          parentRoot = await pickWritableDirectory();
        } catch (e) {
          if ((e as DOMException).name === "AbortError") return;
          setSyncAllErr(
            e instanceof Error ? e.message : "No se pudo elegir la carpeta.",
          );
          return;
        }
        remoteMode = "manifest";
      } else {
        if (
          !window.confirm(
            "Este navegador no permite elegir una carpeta. ¿Descargar cada curso como un ZIP?",
          )
        ) {
          setSyncAllErr(
            "Usa Chrome o Edge para guardar todos los cursos en carpetas, o acepta ZIP en el cuadro de confirmación.",
          );
          return;
        }
        remoteMode = "zip";
      }
    }

    setSyncAllBusy(true);
    setSyncAllErr(null);
    setSyncAllMsg("Obteniendo credenciales...");

    let auth: { cookieHeader: string; xsrfToken: string };
    try {
      auth = await bridgeBlackboardAuthSnapshot(baseUrl);
    } catch (err) {
      setSyncAllErr(
        err instanceof Error ? err.message : "Error al obtener credenciales.",
      );
      setSyncAllMsg(null);
      setSyncAllBusy(false);
      return;
    }

    let totalFiles = 0;
    let totalFolders = 0;
    let totalSkipped = 0;
    let coursesOk = 0;
    let coursesFailed = 0;
    const MAX_RETRIES = 3;

    for (let i = 0; i < courses.length; i++) {
      const c = courses[i]!;

      let payload: {
        ok?: boolean;
        path?: string;
        tree?: DownloadTree;
        error?: string;
        detail?: string;
      } | null = null;
      let lastErr = "";
      let courseDone = false;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        setSyncAllMsg(
          `Curso ${i + 1}/${courses.length}: ${c.name} — descargando de BB...${attempt > 1 ? ` (intento ${attempt})` : ""}`,
        );

        try {
          const res = await fetch(
            `/api/courses/${encodeURIComponent(c.id)}/download-all`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...(remoteMode ? {} : { basePath }),
                responseMode: remoteMode ?? "json",
                baseUrl,
                cookieHeader: auth.cookieHeader,
                xsrfToken: auth.xsrfToken,
                courseName: c.name,
              }),
            },
          );
          const ct = res.headers.get("content-type") ?? "";

          if (remoteMode === "manifest" && parentRoot) {
            const body = (await res.json().catch(() => ({}))) as {
              ok?: boolean;
              tree?: DownloadTree;
              error?: string;
              detail?: string;
            };
            if (res.ok && body?.ok && body.tree) {
              const safe = sanitizeLocalFolderName(c.name, c.id);
              const courseDir = await parentRoot.getDirectoryHandle(safe, {
                create: true,
              });
              setSyncAllMsg(
                `Curso ${i + 1}/${courses.length}: ${c.name} — guardando archivos en tu carpeta…`,
              );
              const out = await downloadManifestToCourseFolder(
                c.id,
                c.name,
                baseUrl,
                auth.cookieHeader,
                auth.xsrfToken,
                body.tree,
                courseDir,
                (label, done, total) => {
                  setSyncAllMsg(
                    `Curso ${i + 1}/${courses.length}: ${c.name} — ${label} ${done}/${total}…`,
                  );
                },
              );
              totalFiles += out.importedFiles;
              totalFolders += out.importedFolders;
              totalSkipped += out.skippedFiles;
              coursesOk += 1;
              refresh();
              courseDone = true;
              break;
            }
            lastErr = body?.detail ?? body?.error ?? `HTTP ${res.status}`;
          } else if (remoteMode === "zip" || ct.includes("application/zip")) {
            if (!res.ok) {
              const errBody = (await res.json().catch(() => ({}))) as {
                detail?: string;
                error?: string;
              };
              lastErr =
                errBody.detail ??
                errBody.error ??
                `HTTP ${res.status}`;
            } else {
              const buf = await res.arrayBuffer();
              const safe =
                c.name.replace(/[/\\?*:"|<>]/g, "_").trim().slice(0, 60) ||
                c.id;
              setSyncAllMsg(
                `Curso ${i + 1}/${courses.length}: ${c.name} — importando desde ZIP...`,
              );
              const imported = await importBlackboardTreeFromZipBuffer(
                buf,
                c.id,
                c.name,
                {
                  saveZipAs: `${safe}.zip`,
                  onProgress: (done, total) => {
                    setSyncAllMsg(
                      `Curso ${i + 1}/${courses.length}: ${c.name} — importando ${done}/${total}...`,
                    );
                  },
                },
              );
              totalFiles += imported.importedFiles;
              totalFolders += imported.importedFolders;
              totalSkipped += imported.skippedFiles;
              coursesOk += 1;
              refresh();
              courseDone = true;
              break;
            }
          } else {
            const body = (await res.json().catch(() => ({}))) as {
              ok?: boolean;
              path?: string;
              tree?: DownloadTree;
              error?: string;
              detail?: string;
            };
            if (res.ok && body?.ok && body.tree && body.path) {
              payload = body;
              break;
            }
            lastErr = body?.detail ?? body?.error ?? `HTTP ${res.status}`;
          }
        } catch (err) {
          lastErr =
            err instanceof Error ? err.message : "Error de red";
        }

        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 2000 * attempt));
        }
      }

      if (courseDone) {
        continue;
      }

      if (!payload?.tree || !payload.path) {
        coursesFailed += 1;
        setSyncAllMsg(
          `Curso ${i + 1}/${courses.length}: ${c.name} — falló (${lastErr}). Continuando...`,
        );
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }

      if (payload.tree.files.length > 0) {
        setSyncAllMsg(
          `Curso ${i + 1}/${courses.length}: ${c.name} — importando ${payload.tree.files.length} archivos...`,
        );

        const imported = await importBlackboardTree(
          c.id,
          c.name,
          payload.path,
          payload.tree,
          (done, total) => {
            setSyncAllMsg(
              `Curso ${i + 1}/${courses.length}: ${c.name} — importando ${done}/${total}...`,
            );
          },
        );
        totalFiles += imported.importedFiles;
        totalFolders += imported.importedFolders;
        totalSkipped += imported.skippedFiles;
      } else {
        totalSkipped += payload.tree.folders.length;
      }

      coursesOk += 1;
      refresh();
    }

    refresh();
    setSyncAllMsg(
      `Sincronización completada: ${coursesOk} cursos, ${totalFiles} archivos nuevos, ${totalFolders} carpetas nuevas${totalSkipped > 0 ? `, ${totalSkipped} ya existían` : ""}${coursesFailed > 0 ? `, ${coursesFailed} cursos con error` : ""}`,
    );
    setSyncAllBusy(false);
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col gap-4 overflow-hidden px-4 py-4 md:px-10 md:py-6">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Documentos
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">
            Por curso
          </h1>
        </div>
        {hydrated && courses.length > 0 ? (
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              onClick={handleSyncAllCourses}
              disabled={syncAllBusy || downloadAllBusy}
              className="rounded-xl bg-[var(--ink)] px-4 py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {syncAllBusy ? "Sincronizando..." : "Sincronizar todos los cursos"}
            </button>
            {syncAllMsg ? (
              <p className="max-w-sm text-right text-[11px] text-emerald-700">{syncAllMsg}</p>
            ) : null}
            {syncAllErr ? (
              <p className="max-w-sm text-right text-[11px] text-red-600">{syncAllErr}</p>
            ) : null}
          </div>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden md:flex-row md:gap-6">
        <aside className="flex w-full shrink-0 flex-col gap-3 md:h-full md:max-w-xs md:shrink-0">
          {hydrated &&
          emptyKind !== "no_config" &&
          emptyKind !== "syncing" ? (
            <div className="flex shrink-0 flex-col gap-2">
              <CourseFilterSelect
                id="docs-course-filter"
                value={filterUi.mode}
                onChange={(m) => {
                  setFilterUi((prev) => ({ ...prev, mode: m }));
                  saveCourseFilterMode(m);
                }}
                catTotals={filterUi.catTotals}
                allCoursesLength={filterUi.curatedLength}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--canvas)] px-2 py-1.5 text-sm text-[var(--ink)] outline-none"
                aria-label="Cursos a mostrar"
              />
            </div>
          ) : null}
          <div
            className="max-h-[min(45dvh,26rem)] overflow-y-auto overscroll-y-contain md:max-h-none md:min-h-0 md:flex-1"
            aria-label="Lista de cursos (desplazable)"
          >
            {!hydrated ? (
              <p className="text-sm text-[var(--ink-muted)]">Cargando…</p>
            ) : courses.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-6 text-sm text-[var(--ink-muted)]">
                {emptyKind === "syncing"
                  ? "Sincronizando datos desde la nube…"
                  : emptyKind === "no_config"
                  ? "Aún no hay cursos sincronizados. Cuando cargues datos desde otro dispositivo o conectes Blackboard en Assignments (icono de ajustes), aparecerán aquí."
                  : emptyKind === "no_bb_cache"
                    ? "Aún no hay cursos en caché. En Assignments, pulsa «Cargar cursos» con la sesión del LMS activa."
                    : emptyKind === "filtered"
                      ? "Ningún curso coincide con el filtro de semestre. Usa el desplegable de arriba o elige «Todos los cursos»."
                      : "No hay cursos en la lista."}
              </p>
            ) : (
              <nav className="flex flex-col gap-2 pb-1" aria-label="Cursos">
                {courses.map((c) => {
                  const on = c.id === active?.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setActiveId(c.id)}
                      className={`group flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                        on
                          ? "border-[var(--border-strong)] bg-[var(--surface)]"
                          : "border-[var(--border)] bg-[var(--surface-muted)] hover:border-[var(--border-strong)]"
                      } ${
                        dragOverNavId === c.id
                          ? "ring-2 ring-[var(--ink)] ring-offset-2 ring-offset-[var(--canvas)]"
                          : ""
                      }`}
                      {...navDropProps(c.id, c.name)}
                    >
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] text-[var(--ink)]"
                        style={{ backgroundColor: c.accent }}
                        aria-hidden
                      >
                        <CourseGlyph courseId={c.id} className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{c.name}</span>
                        <span className="text-xs text-[var(--ink-muted)]">
                          {c.files.length}{" "}
                          {c.files.length === 1 ? "archivo" : "archivos"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </nav>
            )}
          </div>
        </aside>

        <section
          className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 transition md:p-6 ${
            dragOverMain && dropHighlight === null
              ? "ring-2 ring-[var(--ink)] ring-offset-2 ring-offset-[var(--canvas)]"
              : ""
          }`}
          {...mainDropProps}
        >
        {active ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
              <div className="min-w-0">
                <h2 className="text-xl font-bold">{active.name}</h2>
                <p className="mt-2 text-sm text-[var(--ink-muted)]">
                  Selecciona en el árbol la raíz o una carpeta; el botón crea ahí.
                </p>
                {downloadAllMsg ? (
                  <p className="mt-2 text-xs text-emerald-700">{downloadAllMsg}</p>
                ) : null}
                {downloadAllErr ? (
                  <p className="mt-2 text-xs text-red-600">{downloadAllErr}</p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDownloadAll}
                  disabled={downloadAllBusy}
                  className="rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {downloadAllBusy ? "Descargando..." : "Descargar todo"}
                </button>
                <div className="h-1 w-20 shrink-0 bg-[var(--ink)]" aria-hidden />
              </div>
            </div>

            <form
              className="mt-4 flex flex-wrap items-end gap-3 border-b border-[var(--border)] pb-4"
              onSubmit={handleCreateFolder}
            >
              <div className="min-w-[min(100%,14rem)] flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                  Se creará dentro de
                </p>
                <p
                  className="mt-1 truncate rounded-xl border border-[var(--border)] bg-[var(--surface-muted)]/50 px-3 py-2 text-sm font-medium text-[var(--ink)]"
                  title={createLocationLabel}
                  aria-live="polite"
                >
                  {createLocationLabel}
                </p>
              </div>
              <div className="min-w-[12rem] flex-1">
                <label
                  htmlFor="new-folder-name"
                  className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]"
                >
                  Nombre de la carpeta
                </label>
                <input
                  id="new-folder-name"
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Nueva carpeta"
                  maxLength={80}
                  className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--ink-muted)]"
                />
              </div>
              <button
                type="submit"
                disabled={!newFolderName.trim()}
                className="rounded-xl bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Crear carpeta
              </button>
            </form>

            <div className="mt-4 flex min-h-[min(22rem,50vh)] flex-1 flex-col overflow-hidden">
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--canvas)] p-3">
                <RootFolderTree
                  courseId={active.id}
                  folders={active.folders}
                  files={active.files}
                  onRefresh={refresh}
                  dropHighlight={dropHighlight}
                  setDropHighlight={setDropHighlight}
                  selectedParentId={selectedCreateParentId}
                  onSelectParentId={setSelectedCreateParentId}
                  previewFileId={previewFileId}
                  onToggleFilePreview={toggleFilePreview}
                  onFileDragEnd={clearDropTargets}
                />
              </div>
            </div>
          </>
        ) : (
          <p className="text-[var(--ink-muted)]">
            Selecciona un curso en la columna izquierda o revisa la lista en Courses.
          </p>
        )}
        </section>
      </div>
    </div>
  );
}
