"use client";

import { useCallback, useEffect, useState } from "react";
import { NotebookLMAuthBanner } from "./notebooklm/NotebookLMAuthBanner";
import { ChatTab } from "./notebooklm/ChatTab";
import { ArtifactsTab } from "./notebooklm/ArtifactsTab";
import { SettingsTab } from "./notebooklm/SettingsTab";
import { apiJson, NotebookApiError } from "./notebooklm/api-client";

type Notebook = {
  id: string;
  title: string;
  sources_count: number;
  created_at: string | null;
};

type DetailTab = "chat" | "artifacts" | "settings";

const DETAIL_TABS: { id: DetailTab; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "artifacts", label: "Artefactos" },
  { id: "settings", label: "Ajustes" },
];

export function NotebookLMPanel() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [backendOffline, setBackendOffline] = useState(false);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("chat");
  const [loadingNotebooks, setLoadingNotebooks] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Check auth on mount
  const checkAuth = useCallback(async () => {
    setBackendOffline(false);
    try {
      await apiJson<{ authenticated: boolean; connected: boolean }>(
        "/api/notebooklm/auth/status",
      );
      setAuthenticated(true);
    } catch (err) {
      if (err instanceof NotebookApiError) {
        if (err.status === 401) {
          setAuthenticated(false);
          setBackendOffline(false);
          return;
        }
        if (err.status === 503) {
          setAuthenticated(false);
          setBackendOffline(true);
          return;
        }
      }
      setAuthenticated(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const fetchNotebooks = useCallback(async () => {
    setLoadingNotebooks(true);
    setLoadError(null);
    try {
      const data = await apiJson<Notebook[]>("/api/notebooklm/notebooks");
      setNotebooks(data);
      if (data.length === 0) {
        setSelectedId(null);
      } else if (!selectedId || !data.some((nb) => nb.id === selectedId)) {
        setSelectedId(data[0].id);
      }
    } catch (err) {
      const msg =
        err instanceof NotebookApiError
          ? err.detail
          : "No se pudieron cargar los notebooks.";
      setLoadError(msg);
    } finally {
      setLoadingNotebooks(false);
    }
  }, [selectedId]);

  useEffect(() => {
    if (authenticated) fetchNotebooks();
  }, [authenticated, fetchNotebooks]);

  const selectedNotebook = notebooks.find((nb) => nb.id === selectedId);

  function handleDeleted() {
    setSelectedId(null);
    setWorkspaceOpen(false);
    fetchNotebooks();
  }

  async function handleDeleteNotebook(id: string) {
    await apiJson(`/api/notebooklm/notebooks/${id}`, { method: "DELETE" });
    setNotebooks((prev) => prev.filter((nb) => nb.id !== id));
    setSelectedId((prev) => {
      if (prev !== id) return prev;
      const remaining = notebooks.filter((nb) => nb.id !== id);
      return remaining[0]?.id ?? null;
    });
    if (selectedId === id) setWorkspaceOpen(false);
  }

  async function handleCreated(created: Notebook) {
    setNotebooks((prev) => [created, ...prev.filter((nb) => nb.id !== created.id)]);
    setSelectedId(created.id);
    setDetailTab("chat");
    await fetchNotebooks();
  }

  async function handleCreateNotebook() {
    const title = newTitle.trim();
    if (!title) {
      setCreateError("El título no puede estar vacío.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const created = await apiJson<Notebook>("/api/notebooklm/notebooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      setNewTitle("");
      await handleCreated(created);
      setWorkspaceOpen(true);
    } catch (err) {
      setCreateError(
        err instanceof NotebookApiError ? err.detail : "No se pudo crear el notebook.",
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <header className="shrink-0 border-b border-[var(--border)] px-4 py-4 md:px-10">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
          NotebookLM
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Notebooks</h1>
      </header>

      {/* Auth/availability banners */}
      {authenticated === false && !backendOffline && <NotebookLMAuthBanner />}
      {backendOffline && (
        <div className="mx-4 mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 md:mx-10">
          Backend de NotebookLM no disponible. Inicia `npm run notebooklm:backend`.
          <button
            type="button"
            onClick={checkAuth}
            className="ml-2 font-semibold underline"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Loading state */}
      {authenticated === null && (
        <p className="py-12 text-center text-xs text-[var(--ink-faint)]">
          Conectando con el backend...
        </p>
      )}

      {/* Main content */}
      {authenticated && (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {!workspaceOpen || !selectedNotebook ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4 md:px-10">
              <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                <p className="mb-2 text-xs font-semibold text-[var(--ink-muted)]">
                  Crear notebook
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => {
                      setNewTitle(e.target.value);
                      if (createError) setCreateError(null);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && handleCreateNotebook()}
                    placeholder="Nuevo notebook..."
                    className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm focus:border-[var(--ink)] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleCreateNotebook}
                    disabled={creating}
                    className="min-h-[44px] shrink-0 rounded-lg bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    {creating ? "Creando..." : "Crear"}
                  </button>
                </div>
                {createError ? (
                  <p className="mt-2 text-xs text-red-700">{createError}</p>
                ) : null}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {loadingNotebooks ? (
                  <p className="py-8 text-center text-sm text-[var(--ink-faint)]">
                    Cargando notebooks...
                  </p>
                ) : loadError ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {loadError}
                    <button type="button" className="ml-2 underline" onClick={fetchNotebooks}>
                      Reintentar
                    </button>
                  </div>
                ) : notebooks.length === 0 ? (
                  <p className="py-8 text-center text-sm text-[var(--ink-faint)]">
                    No hay notebooks.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {notebooks.map((nb) => (
                      <li key={nb.id}>
                        <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--canvas)] p-3">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedId(nb.id);
                              setWorkspaceOpen(true);
                              setDetailTab("chat");
                            }}
                            className="min-w-0 flex-1 text-left"
                          >
                            <p className="truncate text-sm font-semibold text-[var(--ink)]">
                              {nb.title}
                            </p>
                            <p className="text-[11px] text-[var(--ink-faint)]">
                              {nb.sources_count} fuente{nb.sources_count !== 1 && "s"}
                            </p>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteNotebook(nb.id)}
                            className="rounded-md px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                          >
                            Eliminar
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="shrink-0 border-b border-[var(--border)] px-4 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setWorkspaceOpen(false)}
                    className="flex min-h-[40px] min-w-[40px] shrink-0 items-center justify-center rounded-md border border-[var(--border)] px-2 py-1 text-xs font-semibold text-[var(--ink)]"
                    aria-label="Volver"
                    title="Volver"
                  >
                    ←
                  </button>
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--ink)]">
                    {selectedNotebook.title}
                  </p>
                  </div>
                  <nav className="flex w-full shrink-0 flex-wrap gap-2 sm:ml-auto sm:w-auto sm:justify-end">
                  {DETAIL_TABS.map((tab) => {
                    const active = detailTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setDetailTab(tab.id)}
                        className={`min-h-[40px] rounded-lg px-3 py-2 text-xs font-semibold transition ${
                          active
                            ? "bg-[var(--ink)] text-white"
                            : "border border-[var(--border)] text-[var(--ink)] hover:bg-[var(--surface-muted)]"
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                  </nav>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {detailTab === "chat" && <ChatTab notebookId={selectedId!} />}
                {detailTab === "artifacts" && <ArtifactsTab notebookId={selectedId!} />}
                {detailTab === "settings" && (
                  <SettingsTab notebookId={selectedId!} onDeleted={handleDeleted} />
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
