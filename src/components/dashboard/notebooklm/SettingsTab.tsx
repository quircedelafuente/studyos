"use client";

import { useCallback, useEffect, useState } from "react";
import { apiJson, NotebookApiError } from "./api-client";

type ShareInfo = {
  is_public: boolean;
  access: string;
  view_level: string;
  share_url: string | null;
  shared_users: { email: string; permission: string; display_name: string | null }[];
};

type Props = {
  notebookId: string;
  onDeleted: () => void;
};

export function SettingsTab({ notebookId, onDeleted }: Props) {
  const [share, setShare] = useState<ShareInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchShare = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiJson<ShareInfo>(
        `/api/notebooklm/notebooks/${notebookId}/sharing`,
      );
      setShare(data);
    } catch (err) {
      setError(
        err instanceof NotebookApiError
          ? err.detail
          : "No se pudo cargar la configuración.",
      );
    } finally {
      setLoading(false);
    }
  }, [notebookId]);

  useEffect(() => {
    fetchShare();
  }, [fetchShare]);

  async function togglePublic() {
    if (!share) return;
    setToggling(true);
    setError(null);
    try {
      const data = await apiJson<{ is_public: boolean; share_url: string | null }>(
        `/api/notebooklm/notebooks/${notebookId}/sharing`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ public: !share.is_public }),
        },
      );
      setShare((prev) =>
        prev ? { ...prev, is_public: data.is_public, share_url: data.share_url } : prev,
      );
    } catch (err) {
      setError(
        err instanceof NotebookApiError
          ? err.detail
          : "No se pudo actualizar el acceso público.",
      );
    } finally {
      setToggling(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await apiJson(`/api/notebooklm/notebooks/${notebookId}`, {
        method: "DELETE",
      });
      onDeleted();
    } catch (err) {
      setError(
        err instanceof NotebookApiError ? err.detail : "No se pudo eliminar el notebook.",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4">
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      ) : null}
      {/* Sharing section */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--canvas)] p-4">
        <h3 className="text-sm font-semibold text-[var(--ink)]">Compartir</h3>

        {loading ? (
          <p className="mt-2 text-xs text-[var(--ink-faint)]">Cargando...</p>
        ) : share ? (
          <div className="mt-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-[var(--ink)]">
                  Acceso público
                </p>
                <p className="text-[11px] text-[var(--ink-faint)]">
                  {share.is_public
                    ? "Cualquiera con el enlace puede ver"
                    : "Solo tú puedes acceder"}
                </p>
              </div>
              <button
                type="button"
                onClick={togglePublic}
                disabled={toggling}
                className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                  share.is_public ? "bg-emerald-500" : "bg-zinc-300"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    share.is_public ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {share.share_url && (
              <div className="flex items-center gap-2 rounded-lg bg-[var(--surface-muted)] px-3 py-2">
                <p className="min-w-0 flex-1 truncate font-mono-cli text-[11px] text-[var(--ink-muted)]">
                  {share.share_url}
                </p>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(share.share_url!)}
                  className="shrink-0 text-[11px] font-semibold text-[var(--ink)] hover:underline"
                >
                  Copiar
                </button>
              </div>
            )}

            {share.shared_users.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-[var(--ink)]">
                  Usuarios con acceso
                </p>
                <ul className="space-y-1">
                  {share.shared_users.map((u) => (
                    <li
                      key={u.email}
                      className="flex items-center justify-between text-xs text-[var(--ink-muted)]"
                    >
                      <span>{u.display_name ?? u.email}</span>
                      <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[10px]">
                        {u.permission}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : null}
      </section>

      {/* Danger zone */}
      <section className="rounded-xl border border-red-200 bg-red-50 p-4">
        <h3 className="text-sm font-semibold text-red-900">Zona peligrosa</h3>
        <p className="mt-1 text-xs text-red-700">
          Eliminar este notebook es irreversible.
        </p>
        {!confirmDelete ? (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="mt-3 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100"
          >
            Eliminar notebook
          </button>
        ) : (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700 disabled:opacity-40"
            >
              {deleting ? "Eliminando..." : "Confirmar eliminación"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
            >
              Cancelar
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
