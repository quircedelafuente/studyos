"use client";

import { useCloudSync } from "@/components/providers/CloudSyncContext";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function relTime(ts: number | null): string {
  if (ts == null) return "—";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "hace un momento";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  return `hace ${Math.floor(s / 3600)} h`;
}

/** Solo escritorio: estado de Neon + comprobación del snapshot sincronizado. */
export function CloudSyncIndicator() {
  const s = useCloudSync();

  if (s.phase === "unauthenticated") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--ink-muted)]">
        <span className="h-2 w-2 rounded-full bg-[var(--ink-faint)]" aria-hidden />
        Sesión requerida para la nube
      </div>
    );
  }

  if (s.phase === "pulling" || !s.initialSyncDone) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--ink-muted)]">
        <span
          className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--ink-muted)] border-t-transparent"
          aria-hidden
        />
        Sincronizando con la base de datos…
      </div>
    );
  }

  if (s.phase === "no_database") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden />
        <span className="font-medium text-amber-900 dark:text-amber-100">
          DATABASE_URL no configurada en el servidor
        </span>
        <span className="text-[var(--ink-muted)]">
          (Vercel → Env → Neon). Sin BD no hay copia en la nube.
        </span>
      </div>
    );
  }

  if (s.phase === "error") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden />
        <span className="font-medium text-red-800 dark:text-red-200">
          Error de sincronización: {s.errorMessage ?? "desconocido"}
        </span>
        <button
          type="button"
          onClick={() => void s.refresh()}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 font-semibold text-[var(--ink)] hover:bg-[var(--surface-muted)]"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const srv = s.serverStats;
  const loc = s.localStats;
  const ok =
    srv &&
    loc &&
    srv.totalKeys > 0 &&
    loc.totalKeys > 0 &&
    srv.bbKeys > 0;

  return (
    <div className="flex flex-col gap-1.5 text-[11px] leading-snug text-[var(--ink-muted)] md:flex-row md:items-center md:gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-400"}`}
          title={ok ? "Hay datos de Blackboard en Neon" : "Faltan claves BB en servidor o en local"}
          aria-hidden
        />
        <span className="font-semibold text-[var(--ink)]">Nube (Neon)</span>
        {srv ? (
          <span>
            Servidor: <strong className="text-[var(--ink)]">{srv.totalKeys}</strong> claves (
            <strong>{srv.bbKeys}</strong> BB) · {formatBytes(srv.approxBytes)}
          </span>
        ) : (
          <span>Sin lectura de stats</span>
        )}
        {s.serverUpdatedAt ? (
          <span className="text-[var(--ink-faint)]">
            · actualizado servidor {new Date(s.serverUpdatedAt).toLocaleString("es")}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-1 md:border-t-0 md:border-l md:pt-0 md:pl-3">
        {loc ? (
          <span>
            Este dispositivo: <strong className="text-[var(--ink)]">{loc.totalKeys}</strong> claves (
            <strong>{loc.bbKeys}</strong> BB) · {formatBytes(loc.approxBytes)}
          </span>
        ) : null}
        {s.lastSuccessfulPushAt != null ? (
          <span className="text-[var(--ink-faint)]">· subida {relTime(s.lastSuccessfulPushAt)}</span>
        ) : null}
        <button
          type="button"
          onClick={() => void s.refresh()}
          className="rounded-lg border border-[var(--border)] bg-[var(--canvas)] px-2 py-1 font-semibold text-[var(--ink)] hover:bg-[var(--surface-muted)]"
        >
          Comprobar / actualizar
        </button>
      </div>
    </div>
  );
}
