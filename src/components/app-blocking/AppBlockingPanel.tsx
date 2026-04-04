"use client";

import { useCallback, useEffect, useState } from "react";
import type { ScreenTimeStatus } from "@/plugins/ScreenTimePlugin";

async function getPlugin() {
  const { default: ScreenTime } = await import("@/plugins/ScreenTimePlugin");
  return ScreenTime;
}

/** Races a promise against a timeout; returns the fallback value if it wins. */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((res) => setTimeout(() => res(fallback), ms))]);
}

export function AppBlockingPanel() {
  const [status, setStatus] = useState<ScreenTimeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const plugin = await getPlugin();
      const notAvailable: import("@/plugins/ScreenTimePlugin").ScreenTimeStatus = {
        supported: false, authorized: false, selectionCount: 0, isBlocking: false,
      };
      // If the native class is missing, Capacitor silently drops the call and the
      // promise never settles. Race with a 5 s timeout so we don't hang forever.
      const s = await withTimeout(plugin.getStatus(), 5000, notAvailable);
      setStatus(s);
    } catch {
      setStatus({ supported: false, authorized: false, selectionCount: 0, isBlocking: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleAuthorize = async () => {
    setActionLoading(true);
    try {
      const plugin = await getPlugin();
      const fallback = { authorized: false, error: "timeout" };
      const res = await withTimeout(plugin.requestAuthorization(), 30000, fallback);
      if (!res.authorized && res.error && res.error !== "timeout") {
        alert(`No se pudo autorizar: ${res.error}`);
      }
      await refresh();
    } finally {
      setActionLoading(false);
    }
  };

  const handlePickApps = async () => {
    setActionLoading(true);
    try {
      const plugin = await getPlugin();
      await withTimeout(plugin.presentAppPicker(), 120000, { count: 0 });
      await refresh();
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-[var(--ink-muted)]">Cargando…</span>
      </div>
    );
  }

  if (!status?.supported) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="rounded-2xl bg-[var(--surface-muted)] p-5">
          <svg className="mx-auto h-10 w-10 text-[var(--ink-faint)]" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 2L4 6v6c0 4.97 3.37 9.63 8 10.93C17.63 21.63 21 16.97 21 12V6l-9-4z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-[var(--ink)]">Configuración pendiente</p>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            El plugin nativo de Screen Time necesita estar compilado en el proyecto Xcode.
          </p>
        </div>
        <div className="w-full rounded-2xl bg-[var(--surface)] p-4 text-left">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-indigo-400">Pasos en Xcode</p>
          <ol className="space-y-1.5 text-xs text-[var(--ink-muted)]">
            <li>1. Añade <code className="rounded bg-[var(--surface-muted)] px-1 text-[var(--ink)]">ScreenTimePlugin.swift</code> al target <strong>App</strong></li>
            <li>2. Enlaza <code className="rounded bg-[var(--surface-muted)] px-1 text-[var(--ink)]">FamilyControls.framework</code> y <code className="rounded bg-[var(--surface-muted)] px-1 text-[var(--ink)]">ManagedSettings.framework</code></li>
            <li>3. Build Settings → Code Signing Entitlements → <code className="rounded bg-[var(--surface-muted)] px-1 text-[var(--ink)]">App/App.entitlements</code></li>
            <li>4. Ejecuta <code className="rounded bg-[var(--surface-muted)] px-1 text-[var(--ink)]">ruby ios/App/setup_screen_time.rb</code> para hacerlo automáticamente</li>
          </ol>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition active:opacity-70"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-0 overflow-y-auto pb-[env(safe-area-inset-bottom,0px)]">
      {/* Header */}
      <div className="px-5 pb-4 pt-6">
        <h1 className="text-xl font-black tracking-tight text-[var(--ink)]">Bloqueo de Apps</h1>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Bloquea apps distractoras automáticamente durante las sesiones del Study Arena.
        </p>
      </div>

      {/* Cómo funciona */}
      <div className="mx-4 mb-4 rounded-2xl bg-indigo-500/10 p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-indigo-400">Cómo funciona</p>
        <ul className="mt-2 space-y-1.5 text-sm text-[var(--ink-muted)]">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 text-green-400">▶</span>
            <span>Al <strong className="text-[var(--ink)]">iniciar</strong> una sesión, las apps seleccionadas se bloquean.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 text-yellow-400">⏸</span>
            <span>Durante una <strong className="text-[var(--ink)]">pausa</strong>, el bloqueo se levanta temporalmente.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 text-red-400">■</span>
            <span>Al <strong className="text-[var(--ink)]">finalizar</strong> la sesión, todo vuelve a la normalidad.</span>
          </li>
        </ul>
      </div>

      {/* Step 1: Authorization */}
      <div className="mx-4 mb-3 rounded-2xl bg-[var(--surface)] p-4">
        <div className="mb-3 flex items-center gap-3">
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${status.authorized ? "bg-green-500/20 text-green-400" : "bg-[var(--surface-muted)] text-[var(--ink-muted)]"}`}>
            {status.authorized ? "✓" : "1"}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--ink)]">Autorizar Screen Time</p>
            <p className="text-xs text-[var(--ink-muted)]">
              {status.authorized ? "Autorizado correctamente" : "Necesario para que iOS acepte el bloqueo"}
            </p>
          </div>
        </div>
        {!status.authorized && (
          <button
            type="button"
            disabled={actionLoading}
            onClick={() => void handleAuthorize()}
            className="w-full rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white transition active:opacity-80 disabled:opacity-50"
          >
            {actionLoading ? "Solicitando…" : "Autorizar"}
          </button>
        )}
      </div>

      {/* Step 2: Select apps */}
      <div className="mx-4 mb-3 rounded-2xl bg-[var(--surface)] p-4">
        <div className="mb-3 flex items-center gap-3">
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${status.selectionCount > 0 ? "bg-green-500/20 text-green-400" : "bg-[var(--surface-muted)] text-[var(--ink-muted)]"}`}>
            {status.selectionCount > 0 ? "✓" : "2"}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--ink)]">Seleccionar apps a bloquear</p>
            <p className="text-xs text-[var(--ink-muted)]">
              {status.selectionCount > 0
                ? `${status.selectionCount} app${status.selectionCount !== 1 ? "s" : ""} / categoría${status.selectionCount !== 1 ? "s" : ""} seleccionadas`
                : "Ninguna seleccionada"}
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={!status.authorized || actionLoading}
          onClick={() => void handlePickApps()}
          className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-2.5 text-sm font-semibold text-[var(--ink)] transition active:opacity-80 disabled:opacity-40"
        >
          {actionLoading ? "Abriendo…" : status.selectionCount > 0 ? "Cambiar selección" : "Elegir apps"}
        </button>
      </div>

      {/* Status indicator */}
      {status.authorized && status.selectionCount > 0 && (
        <div className="mx-4 mb-4 rounded-2xl bg-[var(--surface)] p-4">
          <div className="flex items-center gap-3">
            <div className={`h-2.5 w-2.5 rounded-full ${status.isBlocking ? "bg-red-500 shadow-[0_0_6px_#ef4444]" : "bg-green-500"}`} />
            <p className="text-sm text-[var(--ink)]">
              {status.isBlocking
                ? "Bloqueo activo — sesión en curso"
                : "Sin bloqueo — esperando sesión"}
            </p>
          </div>
        </div>
      )}

      {/* Footer note */}
      <div className="mx-4 mt-2 rounded-2xl bg-[var(--surface-muted)] p-4">
        <p className="text-xs text-[var(--ink-faint)]">
          Esta función usa la API <strong>Screen Time / FamilyControls</strong> de Apple. Los ajustes se mantienen incluso si cierras la app. Al terminar la sesión se desactivan automáticamente.
        </p>
      </div>
    </div>
  );
}
