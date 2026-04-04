"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiJson, NotebookApiError } from "./api-client";

type Source = {
  id: string;
  title: string | null;
  url: string | null;
  kind: string | null;
  status: string;
  created_at: string | null;
};

type Props = { notebookId: string };

type AddMode = "url" | "text" | null;

export function SourcesTab({ notebookId }: Props) {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [addMode, setAddMode] = useState<AddMode>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titleOverrides, setTitleOverrides] = useState<Record<string, string>>({});

  // Form state
  const [url, setUrl] = useState("");
  const [textTitle, setTextTitle] = useState("");
  const [textContent, setTextContent] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const titleOverridesKey = `iestudio-notebooklm-source-titles-${notebookId}`;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(titleOverridesKey);
      if (raw) setTitleOverrides(JSON.parse(raw) as Record<string, string>);
      else setTitleOverrides({});
    } catch {
      setTitleOverrides({});
    }
  }, [titleOverridesKey]);

  function persistTitleOverrides(next: Record<string, string>) {
    setTitleOverrides(next);
    try {
      window.localStorage.setItem(titleOverridesKey, JSON.stringify(next));
    } catch {
      // Ignore storage failures.
    }
  }

  const fetchSources = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiJson<Source[]>(
        `/api/notebooklm/notebooks/${notebookId}/sources`,
      );
      setSources(
        data.map((s) => ({
          ...s,
          title: titleOverrides[s.id] ?? s.title,
        })),
      );
    } catch (err) {
      setError(
        err instanceof NotebookApiError
          ? err.detail
          : "No se pudieron cargar las fuentes.",
      );
    } finally {
      setLoading(false);
    }
  }, [notebookId]);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  async function addUrl() {
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiJson(`/api/notebooklm/notebooks/${notebookId}/sources/url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      setUrl("");
      setAddMode(null);
      await fetchSources();
    } catch (err) {
      setError(err instanceof NotebookApiError ? err.detail : "No se pudo añadir la URL.");
    } finally {
      setBusy(false);
    }
  }

  async function addText() {
    if (!textTitle.trim() || !textContent.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiJson(`/api/notebooklm/notebooks/${notebookId}/sources/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: textTitle.trim(),
          content: textContent.trim(),
        }),
      });
      setTextTitle("");
      setTextContent("");
      setAddMode(null);
      await fetchSources();
    } catch (err) {
      setError(
        err instanceof NotebookApiError ? err.detail : "No se pudo añadir el texto.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function addFiles(files: File[]) {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      for (const file of files) {
        form.append("file", file);
      }
      const res = await fetch(`/api/notebooklm/notebooks/${notebookId}/sources/file`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        throw await (async () => {
          try {
            const data = await res.json();
            return new NotebookApiError(
              res.status,
              String(data?.error ?? "Upload failed"),
              String(data?.detail ?? data?.error ?? "Upload failed"),
              typeof data?.code === "string" ? data.code : undefined,
            );
          } catch {
            return new NotebookApiError(res.status, "Upload failed", "Upload failed");
          }
        })();
      }
      const payload = (await res.json().catch(() => null)) as
        | { uploaded?: Source[]; failed?: { filename: string; error: string }[] }
        | Source[]
        | Source
        | null;
      const uploadedRaw = payload && !Array.isArray(payload) && "uploaded" in payload
        ? (payload.uploaded ?? [])
        : payload;
      const uploadedList: Source[] = Array.isArray(uploadedRaw)
        ? uploadedRaw.filter(
            (v): v is Source =>
              Boolean(v) && typeof (v as Source).id === "string",
          )
        : uploadedRaw && typeof (uploadedRaw as Source).id === "string"
          ? [uploadedRaw as Source]
          : [];
      const failed = payload && !Array.isArray(payload) && "failed" in payload
        ? (payload.failed ?? [])
        : [];
      const nextOverrides = { ...titleOverrides };
      for (const u of uploadedList) {
        if (u?.id && u?.title) nextOverrides[u.id] = u.title;
      }
      persistTitleOverrides(nextOverrides);
      if (uploadedList.length > 0) {
        setSources((prev) => [...uploadedList, ...prev]);
      }
      if (failed.length > 0) {
        const names = failed.slice(0, 3).map((f) => f.filename).join(", ");
        setError(`Algunos archivos no se pudieron subir (${failed.length}): ${names}`);
      }
      if (fileRef.current) fileRef.current.value = "";
      await fetchSources();
    } catch (err) {
      setError(
        err instanceof NotebookApiError ? err.detail : "No se pudieron subir los archivos.",
      );
    } finally {
      setBusy(false);
    }
  }

  function triggerFilePicker() {
    if (busy) return;
    if (fileRef.current) {
      fileRef.current.value = "";
      fileRef.current.click();
    }
  }

  async function deleteSource(sourceId: string) {
    setError(null);
    try {
      await apiJson(
      `/api/notebooklm/notebooks/${notebookId}/sources/${sourceId}`,
      { method: "DELETE" },
    );
      setSources((prev) => prev.filter((s) => s.id !== sourceId));
    } catch (err) {
      setError(
        err instanceof NotebookApiError
          ? err.detail
          : "No se pudo eliminar la fuente.",
      );
    }
  }

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      ready: "bg-emerald-100 text-emerald-800",
      processing: "bg-amber-100 text-amber-800",
      error: "bg-red-100 text-red-800",
    };
    return (
      <span
        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${colors[status] ?? "bg-zinc-100 text-zinc-600"}`}
      >
        {status}
      </span>
    );
  };

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      {/* Add source controls */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setAddMode(addMode === "url" ? null : "url")}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
        >
          + URL
        </button>
        <button
          type="button"
          onClick={() => setAddMode(addMode === "text" ? null : "text")}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
        >
          + Texto
        </button>
        <button
          type="button"
          onClick={triggerFilePicker}
          disabled={busy}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
        >
          {busy ? "Subiendo..." : "+ Archivo"}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept=".pdf,.txt,.md,.csv,.docx,.epub"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          void addFiles(files);
        }}
      />

      {/* Add URL form */}
      {addMode === "url" && (
        <div className="flex gap-2 rounded-xl border border-[var(--border)] bg-[var(--canvas)] p-3">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addUrl()}
            placeholder="https://..."
            className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-white px-2.5 py-1.5 text-xs focus:border-[var(--ink)] focus:outline-none"
          />
          <button
            type="button"
            onClick={addUrl}
            disabled={busy}
            className="rounded-lg bg-[var(--ink)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Añadiendo..." : "Añadir"}
          </button>
        </div>
      )}

      {/* Add text form */}
      {addMode === "text" && (
        <div className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--canvas)] p-3">
          <input
            type="text"
            value={textTitle}
            onChange={(e) => setTextTitle(e.target.value)}
            placeholder="Título"
            className="rounded-lg border border-[var(--border)] bg-white px-2.5 py-1.5 text-xs focus:border-[var(--ink)] focus:outline-none"
          />
          <textarea
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
            placeholder="Contenido..."
            rows={4}
            className="rounded-lg border border-[var(--border)] bg-white px-2.5 py-1.5 text-xs focus:border-[var(--ink)] focus:outline-none"
          />
          <button
            type="button"
            onClick={addText}
            disabled={busy}
            className="self-end rounded-lg bg-[var(--ink)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Añadiendo..." : "Añadir texto"}
          </button>
        </div>
      )}

      {/* Sources list */}
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
          <button type="button" className="ml-2 font-semibold underline" onClick={fetchSources}>
            Reintentar
          </button>
        </div>
      ) : null}
      {loading ? (
        <p className="py-8 text-center text-xs text-[var(--ink-faint)]">
          Cargando fuentes...
        </p>
      ) : sources.length === 0 ? (
        <p className="py-8 text-center text-xs text-[var(--ink-faint)]">
          Sin fuentes. Añade una URL, texto o archivo.
        </p>
      ) : (
        <ul className="space-y-2">
          {sources.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[var(--ink)]">
                  {s.title ?? "Sin título"}
                </p>
                <p className="truncate text-[11px] text-[var(--ink-faint)]">
                  {s.kind ?? "unknown"}{s.url ? ` · ${s.url}` : ""}
                </p>
              </div>
              {statusBadge(s.status)}
              <button
                type="button"
                onClick={() => deleteSource(s.id)}
                className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-red-600 transition hover:bg-red-50"
              >
                Eliminar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
