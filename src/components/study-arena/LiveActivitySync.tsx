"use client";

import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { useStudyArena } from "@/components/study-arena/StudyArenaProvider";
import { requestCloudSyncPull } from "@/lib/cloud-sync-pull";

function isCapacitorIOS(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

/**
 * Calcula el timestamp de fin con precisión de milisegundos a partir del
 * estado interno de la sesión, sin depender del tick de React (500 ms).
 */
function computeEndTimestampMs(session: {
  paused: boolean;
  segmentStartMs: number | null;
  elapsedActiveMs: number;
  totalDurationMs: number;
}): number {
  const nowMs = Date.now();
  const elapsed =
    session.paused || session.segmentStartMs == null
      ? session.elapsedActiveMs
      : session.elapsedActiveMs + (nowMs - session.segmentStartMs);
  return nowMs + Math.max(0, session.totalDurationMs - elapsed);
}

export function LiveActivitySync() {
  const {
    activeSession,
    focusScore,
    distractionCount,
    paused,
    progressPct,
  } = useStudyArena();

  // ── State refs ─────────────────────────────────────────────────────────
  const activityActiveRef = useRef(false);
  const prevRunIdRef      = useRef<string | null>(null);
  const prevPausedRef     = useRef<boolean>(false);
  const prevFocusRef      = useRef<number>(100);
  const prevDistractRef   = useRef<number>(0);

  /**
   * true mientras la app está en primer plano.
   * Se asume true en el arranque porque el componente solo se monta cuando la
   * app está activa.
   */
  const isAppActiveRef  = useRef(true);

  /**
   * Se activa cuando un start() fue bloqueado porque la app estaba en segundo
   * plano. Se ejecuta en cuanto la app vuelve al primer plano.
   */
  const pendingStartRef = useRef(false);

  // Refs para el intervalo periódico (sin generar closures sobre props)
  const activeSessionRef = useRef(activeSession);
  const focusScoreRef    = useRef(focusScore);
  const distractRef      = useRef(distractionCount);
  const progressRef      = useRef(progressPct);

  useEffect(() => { activeSessionRef.current = activeSession; }, [activeSession]);
  useEffect(() => { focusScoreRef.current    = focusScore;    }, [focusScore]);
  useEffect(() => { distractRef.current      = distractionCount; }, [distractionCount]);
  useEffect(() => { progressRef.current      = progressPct;   }, [progressPct]);

  // ── Helper: ejecutar un start() contra el plugin ────────────────────────
  const doStart = async (
    session: NonNullable<typeof activeSession>,
    fScore: number,
  ): Promise<boolean> => {
    try {
      const { default: LiveActivity } = await import("@/plugins/LiveActivityPlugin");
      const { supported } = await LiveActivity.isSupported();
      if (!supported) return false;

      const endTimestampMs = computeEndTimestampMs(session);
      const res = await LiveActivity.start({
        sessionTitle:         session.planTitle,
        subject:              session.focus || session.sessionTitle || "",
        totalDurationSeconds: Math.round(session.totalDurationMs / 1000),
        endTimestampMs,
        focusScore: fScore,
      });

      if (res.activityId) {
        activityActiveRef.current = true;
        pendingStartRef.current   = false;
        prevPausedRef.current     = false;
        prevFocusRef.current      = fScore;
        prevDistractRef.current   = 0;
        console.log(`[LiveActivitySync] ✅ actividad iniciada id=${res.activityId}`);
        return true;
      }

      // activityId vacío = app en background; reintentaremos en primer plano
      console.warn("[LiveActivitySync] start() devolvió activityId vacío — marcando como pendiente");
      pendingStartRef.current = true;
      return false;
    } catch (e) {
      console.error("[LiveActivitySync] start() error:", e);
      pendingStartRef.current = true;
      return false;
    }
  };

  // ── Arrancar / terminar Live Activity cuando cambia el arenaRunId ────────
  useEffect(() => {
    if (!isCapacitorIOS()) return;

    const runId  = activeSession?.arenaRunId ?? null;
    const prevId = prevRunIdRef.current;

    if (runId === prevId) return;
    prevRunIdRef.current = runId;

    void (async () => {
      const { default: LiveActivity } = await import("@/plugins/LiveActivityPlugin").catch(() => ({
        default: null,
      }));
      if (!LiveActivity) return;

      // Terminar actividad anterior si existía
      if (activityActiveRef.current) {
        await LiveActivity.end().catch((e: unknown) =>
          console.error("[LiveActivitySync] end() error:", e),
        );
        activityActiveRef.current = false;
      }

      if (runId === null || !activeSession) {
        pendingStartRef.current = false;
        return;
      }

      // Si la app está en segundo plano, diferir el start
      if (!isAppActiveRef.current) {
        console.log("[LiveActivitySync] app en segundo plano — start aplazado");
        pendingStartRef.current = true;
        return;
      }

      await doStart(activeSession, focusScore);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession?.arenaRunId]);

  // ── Actualizar en pausa / focus / distracciones ──────────────────────────
  useEffect(() => {
    if (!isCapacitorIOS()) return;
    if (!activityActiveRef.current || !activeSession) return;

    const pausedChanged   = paused !== prevPausedRef.current;
    const focusChanged    = focusScore !== prevFocusRef.current;
    const distractChanged = distractionCount !== prevDistractRef.current;

    if (!pausedChanged && !focusChanged && !distractChanged) return;

    prevPausedRef.current   = paused;
    prevFocusRef.current    = focusScore;
    prevDistractRef.current = distractionCount;

    const endTimestampMs = computeEndTimestampMs(activeSession);
    const remSec         = Math.round(Math.max(0, endTimestampMs - Date.now()) / 1000);

    void import("@/plugins/LiveActivityPlugin")
      .then(({ default: LiveActivity }) =>
        LiveActivity?.update({
          endTimestampMs,
          focusScore,
          distractionCount,
          isPaused:               paused,
          pausedSecondsRemaining: remSec,
          subject:                activeSession.focus || activeSession.sessionTitle || "",
          progressPercent:        progressPct,
        }).catch((e: unknown) => console.error("[LiveActivitySync] update() error:", e)),
      )
      .catch((e: unknown) => console.error("[LiveActivitySync] update import error:", e));
  }, [paused, focusScore, distractionCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Recalibración periódica del contador (cada 60 s) ─────────────────────
  useEffect(() => {
    if (!isCapacitorIOS()) return;

    const id = window.setInterval(() => {
      const session = activeSessionRef.current;
      if (!activityActiveRef.current || !session || session.paused) return;

      const endTimestampMs = computeEndTimestampMs(session);
      const remSec         = Math.round(Math.max(0, endTimestampMs - Date.now()) / 1000);

      void import("@/plugins/LiveActivityPlugin")
        .then(({ default: LiveActivity }) =>
          LiveActivity?.update({
            endTimestampMs,
            focusScore:             focusScoreRef.current,
            distractionCount:       distractRef.current,
            isPaused:               false,
            pausedSecondsRemaining: remSec,
            subject:                session.focus || session.sessionTitle || "",
            progressPercent:        progressRef.current,
          }).catch(() => undefined),
        )
        .catch(() => undefined);
    }, 60_000);

    return () => window.clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Gestión del estado de primer/segundo plano ───────────────────────────
  useEffect(() => {
    if (!isCapacitorIOS()) return;

    let cleanup: (() => void) | null = null;

    void import("@capacitor/app").then(({ App }) => {
      const listenerPromise = App.addListener("appStateChange", ({ isActive }) => {
        isAppActiveRef.current = isActive;

        if (!isActive) return;

        // App vuelve al primer plano: pull inmediato para detectar sesiones
        // iniciadas en otro dispositivo mientras estábamos en segundo plano.
        requestCloudSyncPull();

        // Si había un start() pendiente (bloqueado por background), ejecutarlo ahora.
        if (pendingStartRef.current && !activityActiveRef.current) {
          const session = activeSessionRef.current;
          if (session) {
            pendingStartRef.current = false;
            console.log("[LiveActivitySync] ejecutando start() pendiente tras volver al primer plano");
            void doStart(session, focusScoreRef.current);
          }
        }
      });

      cleanup = () => {
        listenerPromise.then((l) => l.remove()).catch(() => undefined);
      };
    });

    return () => {
      cleanup?.();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
