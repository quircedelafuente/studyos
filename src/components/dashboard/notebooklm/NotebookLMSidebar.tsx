"use client";

import { useState } from "react";
import { apiJson, NotebookApiError } from "./api-client";

type Notebook = {
  id: string;
  title: string;
  sources_count: number;
  created_at: string | null;
};

type Props = {
  notebooks: Notebook[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreated: (created: Notebook) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
};

export function NotebookLMSidebar({
  notebooks,
  selectedId,
  onSelect,
  onCreated,
  onDelete,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleCreate() {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setCreateError("El título no puede estar vacío.");
      return;
    }
    if (cleanTitle.length > 120) {
      setCreateError("El título no puede superar 120 caracteres.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const created = await apiJson<Notebook>("/api/notebooklm/notebooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: cleanTitle }),
      });
      setTitle("");
      await onCreated(created);
      onSelect(created.id);
    } catch (err) {
      if (err instanceof NotebookApiError) {
        setCreateError(err.detail);
      } else {
        setCreateError("No se pudo crear el notebook.");
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(notebook: Notebook) {
    const confirmed = window.confirm(
      `¿Eliminar el cuaderno "${notebook.title}"? Esta acción no se puede deshacer.`,
    );
    if (!confirmed) return;
    setDeletingId(notebook.id);
    setCreateError(null);
    try {
      await onDelete(notebook.id);
    } catch (err) {
      if (err instanceof NotebookApiError) {
        setCreateError(err.detail);
      } else {
        setCreateError("No se pudo eliminar el cuaderno.");
      }
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] p-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (createError) setCreateError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="Nuevo notebook..."
            className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--canvas)] px-2.5 py-1.5 text-xs text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--ink)] focus:outline-none"
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating || !title.trim()}
            className="shrink-0 rounded-lg bg-[var(--ink)] px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-80 disabled:opacity-40"
          >
            {creating ? "..." : "+"}
          </button>
        </div>
        {createError ? (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
            {createError}
          </div>
        ) : null}
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        {notebooks.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-[var(--ink-faint)]">
            No hay notebooks
          </p>
        ) : (
          <ul className="space-y-1">
            {notebooks.map((nb) => {
              const active = nb.id === selectedId;
              return (
                <li key={nb.id}>
                  <div
                    className={`flex items-center gap-1 rounded-xl px-1 py-1 transition ${
                      active ? "bg-[var(--ink)] text-white" : "hover:bg-[var(--surface-muted)]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(nb.id)}
                      className={`min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left ${
                        active ? "text-white" : "text-[var(--ink)]"
                      }`}
                    >
                      <span className="block truncate text-sm font-medium">{nb.title}</span>
                      <span
                        className={`text-[11px] ${active ? "text-white/70" : "text-[var(--ink-faint)]"}`}
                      >
                        {nb.sources_count} fuente{nb.sources_count !== 1 && "s"}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(nb)}
                      disabled={deletingId === nb.id}
                      className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold ${
                        active
                          ? "text-white/80 hover:bg-white/10"
                          : "text-red-600 hover:bg-red-50"
                      } disabled:opacity-50`}
                      title="Eliminar cuaderno"
                      aria-label={`Eliminar ${nb.title}`}
                    >
                      {deletingId === nb.id ? "..." : "🗑"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
    </aside>
  );
}
