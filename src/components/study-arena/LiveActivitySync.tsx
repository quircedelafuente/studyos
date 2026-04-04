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

  const activityActiveRef = useRef(false);
  const prevRunIdRef      = useRef<string | null>(null);
  const prevPausedRef     = useRef<boolean>(false);
  const prevFocusRef      = useRef<number>(100);
  const prevDistractRef   = useRef<number>(0);

  // Refs para el intervalo periódico (sin generar closures sobre props)
  const activeSessionRef = useRef(activeSession);
  const focusScoreRef    = useRef(focusScore);
  const distractRef      = useRef(distractionCount);
  const progressRef      = useRef(progressPct);

  useEffect(() => { activeSessionRef.current = activeSession; }, [activeSession]);
  useEffect(() => { focusScoreRef.current    = focusScore;    }, [focusScore]);
  useEffect(() => { distractRef.current      = distractionCount; }, [distractionCount]);
  useEffect(() => { progressRef.current      = progressPct;   }, [progressPct]);

  // ── Arrancar / terminar Live Activity ───────────────────────────────────
  useEffect(() => {
    if (!isCapacitorIOS()) return;

    const runId  = activeSession?.arenaRunId ?? null;
    const prevId = prevRunIdRef.current;

    if (runId === prevId) return;
    prevRunIdRef.current = runId;

    void (async () => {
      let LiveActivity: Awaited<typeof import("@/plugins/LiveActivityPlugin")>["default"] | null = null;
      try {
        LiveActivity = (await import("@/plugins/LiveActivityPlugin")).default;
      } catch (e) {
        console.error("[LiveActivitySync] error importando plugin:", e);
        return;
      }

      let supported = false;
      try {
        supported = (await LiveActivity.isSupported()).supported;
      } catch (e) {
        console.error("[LiveActivitySync] isSupported error:", e);
      }

      // Terminar actividad anterior si existía
      if (activityActiveRef.current) {
        await LiveActivity.end().catch((e: unknown) =>
          console.error("[LiveActivitySync] end() error:", e),
        );
        activityActiveRef.current = false;
      }

      // Arrancar nueva actividad
      if (runId !== null && activeSession && supported) {
        const totalSec       = Math.round(activeSession.totalDurationMs / 1000);
        const endTimestampMs = computeEndTimestampMs(activeSession);

        try {
          const res = await LiveActivity.start({
            sessionTitle:         activeSession.planTitle,
            subject:              activeSession.focus || activeSession.sessionTitle || "",
            totalDurationSeconds: totalSec,
            endTimestampMs,
            focusScore,
          });
          if (res.activityId) {
            activityActiveRef.current = true;
            prevPausedRef.current     = false;
            prevFocusRef.current      = focusScore;
            prevDistractRef.current   = 0;
            console.log(`[LiveActivitySync] ✅ actividad iniciada id=${res.activityId}`);
          } else {
            console.warn("[LiveActivitySync] start() devolvió activityId vacío — Live Activities puede estar deshabilitado en Ajustes");
          }
        } catch (e) {
          console.error("[LiveActivitySync] start() error:", e);
        }
      }
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
  // Evita deriva acumulada entre el ring de React y el Text(timerInterval) nativo.
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

  // ── Detección de vuelta al primer plano (cross-device sync) ──────────────
  // Cuando el usuario trae la app al frente, forzamos un pull de la nube para
  // detectar sesiones iniciadas en otro dispositivo mientras estaba en segundo plano.
  useEffect(() => {
    if (!isCapacitorIOS()) return;

    let cleanup: (() => void) | null = null;

    void import("@capacitor/app").then(({ App }) => {
      const listenerPromise = App.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) return;
        // Dispara un pull inmediato; si hay una sesión nueva en la nube,
        // CloudSyncProvider → applyCloudEntries → STUDY_ARENA_CHANGED_EVENT
        // → StudyArenaProvider recarga → este componente arranca la actividad.
        requestCloudSyncPull();
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
