"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSession } from "next-auth/react";
import { CLOUD_SYNC_PUSH_REQUEST_EVENT } from "@/lib/cloud-sync-push";
import { CLOUD_SYNC_PULL_REQUEST_EVENT } from "@/lib/cloud-sync-pull";
import {
  applyCloudEntries,
  collectSyncableEntries,
  syncSnapshotSignature,
} from "@/lib/user-cloud-storage";

const PUSH_INTERVAL_MS = 12_000;

/**
 * Cadencia del pull. Es adaptativa porque desde que el pull es condicional
 * (304 + ETag) una comprobación cuesta ~200 B en vez de ~450 KB: podemos
 * mirar cada 3 s mientras estás usando la app y espaciar a 30 s cuando no.
 * Con la pestaña oculta no se pulsa nada — al volver, el listener de foco
 * dispara un pull inmediato.
 */
const PULL_INTERVAL_ACTIVE_MS = 3_000;
const PULL_INTERVAL_IDLE_MS = 30_000;
/** Tiempo sin interacción tras el cual se considera que estás inactivo. */
const ACTIVITY_WINDOW_MS = 60_000;

/** Mensaje legible desde JSON `{ error, detail }` o cuerpo texto. */
async function readApiErrorMessage(res: Response): Promise<string> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const j = (await res.json().catch(() => ({}))) as {
      detail?: string;
      error?: string;
    };
    if (typeof j.detail === "string" && j.detail.trim()) {
      return j.detail.trim().slice(0, 220);
    }
    if (typeof j.error === "string" && j.error.trim()) {
      return j.error.trim().slice(0, 220);
    }
  }
  const text = await res.text().catch(() => "");
  return (text.trim().slice(0, 220) || `HTTP ${res.status}`);
}

export type CloudSyncStatus = {
  /** null = aún no sabemos; false = Neon/API desactivada (503). */
  cloudEnabled: boolean | null;
  lastUploadOkAt: number | null;
  lastUploadError: string | null;
  lastReceiveOkAt: number | null;
  lastReceiveError: string | null;
  isUploading: boolean;
  isReceiving: boolean;
  /**
   * Primer GET /api/user-sync tras autenticarse ya terminó (localStorage puede
   * estar rellenado por la nube). Hasta entonces, paneles BB deben mostrar carga.
   */
  initialSyncDone: boolean;
};

const initialStatus: CloudSyncStatus = {
  cloudEnabled: null,
  lastUploadOkAt: null,
  lastUploadError: null,
  lastReceiveOkAt: null,
  lastReceiveError: null,
  isUploading: false,
  isReceiving: false,
  initialSyncDone: false,
};

const CloudSyncContext = createContext<CloudSyncStatus | null>(null);

export function useCloudSyncStatus(): CloudSyncStatus | null {
  return useContext(CloudSyncContext);
}

export function CloudSyncProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const userId = session?.user?.id;
  const lastPushedSig = useRef<string>("");
  const pullInFlight = useRef(false);
  /** ETag de la última versión recibida del servidor (para el pull condicional). */
  const etagRef = useRef<string | null>(null);
  /** Marca de la última interacción del usuario, para la cadencia adaptativa. */
  const lastActivityRef = useRef<number>(Date.now());
  const [syncStatus, setSyncStatus] = useState<CloudSyncStatus>(initialStatus);

  const patch = useCallback((partial: Partial<CloudSyncStatus>) => {
    setSyncStatus((prev) => ({ ...prev, ...partial }));
  }, []);

  const push = useCallback(async () => {
    if (!userId) return;
    const entries = collectSyncableEntries();
    const sig = syncSnapshotSignature(entries);
    if (sig === lastPushedSig.current) return;
    patch({ isUploading: true, lastUploadError: null });
    try {
      const res = await fetch("/api/user-sync", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
        credentials: "same-origin",
      });
      if (res.status === 503) {
        const data = (await res.json().catch(() => ({}))) as {
          disabled?: boolean;
        };
        if (data.disabled) {
          patch({ cloudEnabled: false, lastUploadError: null });
          return;
        }
      }
      if (res.ok) {
        lastPushedSig.current = sig;
        patch({
          lastUploadOkAt: Date.now(),
          lastUploadError: null,
          cloudEnabled: true,
        });
      } else {
        const msg = await readApiErrorMessage(res);
        patch({
          lastUploadError: msg || `HTTP ${res.status}`,
        });
      }
    } catch (e) {
      patch({
        lastUploadError:
          e instanceof Error ? e.message.slice(0, 120) : "Error de red",
      });
    } finally {
      patch({ isUploading: false });
    }
  }, [userId, patch]);

  const pull = useCallback(async () => {
    if (!userId || pullInFlight.current) return;
    pullInFlight.current = true;
    patch({ isReceiving: true, lastReceiveError: null });
    try {
      const headers: Record<string, string> = {};
      if (etagRef.current) headers["If-None-Match"] = etagRef.current;
      const res = await fetch("/api/user-sync", {
        credentials: "same-origin",
        cache: "no-store",
        headers,
      });
      /** Nada ha cambiado en el servidor: no hay payload que procesar. */
      if (res.status === 304) {
        patch({
          cloudEnabled: true,
          lastReceiveOkAt: Date.now(),
          lastReceiveError: null,
        });
        return;
      }
      if (res.status === 503) {
        const data = (await res.json().catch(() => ({}))) as {
          disabled?: boolean;
        };
        if (data.disabled) {
          patch({
            cloudEnabled: false,
            lastReceiveOkAt: null,
            lastReceiveError: null,
          });
          return;
        }
      }
      if (!res.ok) {
        const msg = await readApiErrorMessage(res);
        patch({
          lastReceiveError: msg || `HTTP ${res.status}`,
        });
        return;
      }
      const data = (await res.json()) as {
        disabled?: boolean;
        entries?: Record<string, string>;
      };
      if (data.disabled) {
        patch({ cloudEnabled: false });
        return;
      }
      etagRef.current = res.headers.get("ETag") ?? etagRef.current;
      patch({
        cloudEnabled: true,
        lastReceiveOkAt: Date.now(),
        lastReceiveError: null,
      });

      const serverEntries = data.entries ?? {};
      const serverSig = syncSnapshotSignature(serverEntries);
      const localEntries = collectSyncableEntries();
      const localSig = syncSnapshotSignature(localEntries);

      if (serverSig === localSig) {
        lastPushedSig.current = localSig;
        return;
      }

      const localIsEmpty = Object.keys(localEntries).length === 0;
      const localNotChanged = localSig === lastPushedSig.current;

      if (localIsEmpty || localNotChanged) {
        applyCloudEntries(serverEntries);
        lastPushedSig.current = syncSnapshotSignature(collectSyncableEntries());
      }
    } catch (e) {
      patch({
        lastReceiveError:
          e instanceof Error ? e.message.slice(0, 120) : "Sin conexión",
      });
    } finally {
      pullInFlight.current = false;
      patch({ isReceiving: false });
    }
  }, [userId, patch]);

  useEffect(() => {
    if (status !== "authenticated" || !userId) {
      lastPushedSig.current = "";
      etagRef.current = null;
      setSyncStatus(initialStatus);
      return;
    }
    let cancelled = false;
    void (async () => {
      patch({ isReceiving: true, lastReceiveError: null, initialSyncDone: false });
      try {
        const res = await fetch("/api/user-sync", { credentials: "same-origin" });
        if (cancelled) return;
        if (res.status === 503) {
          const d = (await res.json().catch(() => ({}))) as {
            disabled?: boolean;
          };
          if (d.disabled) {
            patch({ cloudEnabled: false, isReceiving: false, initialSyncDone: true });
            return;
          }
        }
        if (!res.ok) {
          const msg = await readApiErrorMessage(res);
          patch({
            lastReceiveError: msg || `HTTP ${res.status}`,
            isReceiving: false,
            initialSyncDone: true,
          });
          return;
        }
        const data = (await res.json()) as {
          disabled?: boolean;
          entries?: Record<string, string>;
        };
        if (data.disabled) {
          patch({ cloudEnabled: false, isReceiving: false, initialSyncDone: true });
          return;
        }
        etagRef.current = res.headers.get("ETag") ?? null;
        patch({
          cloudEnabled: true,
          lastReceiveOkAt: Date.now(),
          lastReceiveError: null,
        });
        const server = data.entries ?? {};
        const serverKeyCount = Object.keys(server).length;
        const local = collectSyncableEntries();
        const localKeyCount = Object.keys(local).length;

        if (serverKeyCount === 0 && localKeyCount > 0) {
          await push();
        } else if (serverKeyCount > 0 && localKeyCount === 0) {
          applyCloudEntries(server);
          lastPushedSig.current = syncSnapshotSignature(collectSyncableEntries());
        } else if (serverKeyCount > 0 && localKeyCount > 0) {
          /**
           * Importante: NO sobrescribir localStorage con la nube en el arranque
           * si ya hay datos locales. Eso puede borrar cambios locales recientes
           * (p. ej. sesiones completadas guardadas manualmente) si el servidor
           * aún no los tiene.
           *
           * Estrategia:
           * - primero subimos el snapshot local (PUT hace merge con lo existente)
           * - luego hacemos un GET y aplicamos el estado del servidor (ahora incluye
           *   lo local + las claves que este dispositivo no tenía).
           */
          await push();
          const res2 = await fetch("/api/user-sync", {
            credentials: "same-origin",
            cache: "no-store",
          });
          if (res2.ok) {
            const data2 = (await res2.json()) as { entries?: Record<string, string> };
            etagRef.current = res2.headers.get("ETag") ?? etagRef.current;
            applyCloudEntries(data2.entries ?? {});
            lastPushedSig.current = syncSnapshotSignature(collectSyncableEntries());
          }
        }
      } catch (e) {
        if (!cancelled) {
          patch({
            lastReceiveError:
              e instanceof Error ? e.message.slice(0, 120) : "Sin conexión",
          });
        }
      } finally {
        if (!cancelled) {
          patch({ isReceiving: false, initialSyncDone: true });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, userId, push, patch]);

  useEffect(() => {
    if (status !== "authenticated" || !userId) return;
    const onImmediatePush = () => {
      lastPushedSig.current = "";
      void push();
    };
    const onImmediatePull = () => {
      void pull();
    };
    window.addEventListener(CLOUD_SYNC_PUSH_REQUEST_EVENT, onImmediatePush);
    window.addEventListener(CLOUD_SYNC_PULL_REQUEST_EVENT, onImmediatePull);
    return () => {
      window.removeEventListener(CLOUD_SYNC_PUSH_REQUEST_EVENT, onImmediatePush);
      window.removeEventListener(CLOUD_SYNC_PULL_REQUEST_EVENT, onImmediatePull);
    };
  }, [status, userId, push, pull]);

  /** Registra interacción para decidir si la cadencia es rápida o lenta. */
  useEffect(() => {
    if (status !== "authenticated" || !userId) return;
    const bump = () => {
      lastActivityRef.current = Date.now();
    };
    const opts: AddEventListenerOptions = { passive: true };
    window.addEventListener("pointerdown", bump, opts);
    window.addEventListener("keydown", bump, opts);
    window.addEventListener("wheel", bump, opts);
    window.addEventListener("touchstart", bump, opts);
    return () => {
      window.removeEventListener("pointerdown", bump, opts);
      window.removeEventListener("keydown", bump, opts);
      window.removeEventListener("wheel", bump, opts);
      window.removeEventListener("touchstart", bump, opts);
    };
  }, [status, userId]);

  useEffect(() => {
    if (status !== "authenticated" || !userId) return;

    /**
     * El push mantiene su cadencia fija: `push()` sale antes de tocar la red si
     * la firma local no ha cambiado, así que en reposo no cuesta nada.
     */
    const pushId = window.setInterval(() => {
      void push();
    }, PUSH_INTERVAL_MS);

    /**
     * El pull se auto-reprograma en vez de usar setInterval, para poder cambiar
     * el ritmo sobre la marcha y no disparar nada con la pestaña oculta.
     */
    let stopped = false;
    let pullTimer: number | undefined;

    const nextDelay = () =>
      Date.now() - lastActivityRef.current < ACTIVITY_WINDOW_MS
        ? PULL_INTERVAL_ACTIVE_MS
        : PULL_INTERVAL_IDLE_MS;

    const schedule = (delay: number) => {
      if (stopped) return;
      pullTimer = window.setTimeout(tick, delay);
    };

    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === "visible") {
        await pull();
      }
      schedule(nextDelay());
    };

    schedule(nextDelay());

    /** Al volver a la app: pull inmediato. Al irte: push para no perder nada. */
    const onVisible = () => {
      lastActivityRef.current = Date.now();
      void pull();
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        void push();
      } else {
        onVisible();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVisible);

    return () => {
      stopped = true;
      window.clearInterval(pushId);
      if (pullTimer) window.clearTimeout(pullTimer);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVisible);
    };
  }, [status, userId, pull, push]);

  useEffect(() => {
    if (status !== "authenticated" || !userId) return;
    const flush = () => {
      const entries = collectSyncableEntries();
      void fetch("/api/user-sync", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
        keepalive: true,
        credentials: "same-origin",
      });
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [status, userId]);

  const value = useMemo(() => syncStatus, [syncStatus]);

  return (
    <CloudSyncContext.Provider value={value}>{children}</CloudSyncContext.Provider>
  );
}
