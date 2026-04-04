"use client";

import { useSession } from "next-auth/react";
import { useCloudSyncStatus } from "@/components/providers/CloudSyncProvider";

function formatTime(ts: number | null): string {
  if (ts == null) return "—";
  try {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function CloudSyncIndicator() {
  const { status } = useSession();
  const s = useCloudSyncStatus();

  if (status !== "authenticated") return null;

  if (!s) {
    return (
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[100] max-w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-[var(--border)] bg-[var(--sidebar)]/95 px-3 py-2 text-[11px] text-[var(--ink-muted)] shadow-lg backdrop-blur-sm"
        role="status"
        aria-live="polite"
      >
        <p className="font-semibold text-[var(--ink)]">Sincronización</p>
        <p className="mt-0.5">Inicializando…</p>
      </div>
    );
  }

  if (s.cloudEnabled === false) {
    return (
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[100] max-w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-900 shadow-lg backdrop-blur-sm dark:text-amber-100"
        role="status"
        aria-live="polite"
      >
        <p className="font-semibold">Nube desactivada</p>
        <p className="mt-0.5 opacity-90">
          La base de datos no está configurada en el servidor. Los datos solo
          están en este dispositivo.
        </p>
      </div>
    );
  }

  if (s.cloudEnabled === null && !s.lastReceiveError && !s.lastUploadError) {
    return (
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[100] max-w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-[var(--border)] bg-[var(--sidebar)]/95 px-3 py-2 text-[11px] text-[var(--ink-muted)] shadow-lg backdrop-blur-sm"
        role="status"
        aria-live="polite"
      >
        <p className="font-semibold text-[var(--ink)]">Sincronización</p>
        <p className="mt-0.5 flex items-center gap-2">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500" />
          Conectando con la nube…
        </p>
      </div>
    );
  }

  const upOk = s.lastUploadOkAt != null && !s.lastUploadError;
  const downOk = s.lastReceiveOkAt != null && !s.lastReceiveError;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[100] max-w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-[var(--border)] bg-[var(--sidebar)]/95 px-3 py-2 text-[11px] shadow-lg backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <p className="font-semibold text-[var(--ink)]">Sincronización</p>
      <ul className="mt-1.5 space-y-1 text-[var(--ink-muted)]">
        <li className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 shrink-0 rounded-full ${
              s.isUploading
                ? "animate-pulse bg-amber-500"
                : upOk
                  ? "bg-emerald-500"
                  : s.lastUploadError
                    ? "bg-red-500"
                    : "bg-[var(--ink-faint)]"
            }`}
            aria-hidden
          />
          <span>
            <span className="text-[var(--ink)]">Subida</span>
            {s.isUploading ? " (enviando…)" : null}: {formatTime(s.lastUploadOkAt)}
            {s.lastUploadError ? (
              <span className="block text-red-600 dark:text-red-400">
                {s.lastUploadError}
              </span>
            ) : null}
          </span>
        </li>
        <li className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 shrink-0 rounded-full ${
              s.isReceiving
                ? "animate-pulse bg-amber-500"
                : downOk
                  ? "bg-emerald-500"
                  : s.lastReceiveError
                    ? "bg-red-500"
                    : "bg-[var(--ink-faint)]"
            }`}
            aria-hidden
          />
          <span>
            <span className="text-[var(--ink)]">Recepción</span>
            {s.isReceiving ? " (descargando…)" : null}:{" "}
            {formatTime(s.lastReceiveOkAt)}
            {s.lastReceiveError ? (
              <span className="block text-red-600 dark:text-red-400">
                {s.lastReceiveError}
              </span>
            ) : null}
          </span>
        </li>
      </ul>
      <p className="mt-1.5 border-t border-[var(--border)] pt-1.5 text-[10px] text-[var(--ink-faint)]">
        Documentos locales no se suben. Sesión: Google.
      </p>
    </div>
  );
}
