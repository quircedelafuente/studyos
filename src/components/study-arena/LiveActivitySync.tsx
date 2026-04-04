"use client";

/**
 * LiveActivitySync — componente sin UI que sincroniza el estado del Study Arena
 * con la Live Activity de iOS (Dynamic Island / Lock Screen).
 *
 * Solo actúa en Capacitor iOS (≥ 16.2). En web o Android es un no-op.
 * Debe renderizarse DENTRO de <StudyArenaProvider>.
 */

import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { useStudyArena } from "@/components/study-arena/StudyArenaProvider";

function isCapacitorIOS(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

export function LiveActivitySync() {
  const {
    activeSession,
    timeRemainingMs,
    focusScore,
    distractionCount,
    paused,
    progressPct,
  } = useStudyArena();

  // Refs para evitar llamadas al plugin en cada render
  const activityActiveRef   = useRef(false);
  const prevRunIdRef        = useRef<string | null>(null);
  const prevPausedRef       = useRef<boolean>(false);
  const prevFocusRef        = useRef<number>(100);
  const prevDistractRef     = useRef<number>(0);

  // ── Arrancar / terminar Live Activity cuando cambia la sesión ────────────
  useEffect(() => {
    if (!isCapacitorIOS()) return;

    const runId = activeSession?.arenaRunId ?? null;
    const prevId = prevRunIdRef.current;

    if (runId === prevId) return;
    prevRunIdRef.current = runId;

    void (async () => {
      const { default: LiveActivity } = await import(
        "@/plugins/LiveActivityPlugin"
      ).catch(() => ({ default: null }));
      if (!LiveActivity) return;

      const { supported } = await LiveActivity.isSupported().catch(() => ({
        supported: false,
      }));

      // Terminar actividad anterior si la había
      if (activityActiveRef.current) {
        await LiveActivity.end().catch(() => {});
        activityActiveRef.current = false;
      }

      // Arrancar nueva actividad si hay sesión activa
      if (runId !== null && activeSession && supported) {
        const totalSec = Math.round(activeSession.totalDurationMs / 1000);
        const remMs    = timeRemainingMs > 0 ? timeRemainingMs : activeSession.totalDurationMs;

        await LiveActivity.start({
          sessionTitle:        activeSession.planTitle,
          subject:             activeSession.focus || activeSession.sessionTitle || "",
          totalDurationSeconds: totalSec,
          endTimestampMs:      Date.now() + remMs,
          focusScore,
        }).catch(() => {});

        activityActiveRef.current = true;
        prevPausedRef.current     = false;
        prevFocusRef.current      = focusScore;
        prevDistractRef.current   = 0;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession?.arenaRunId]);

  // ── Actualizar cuando cambia pausa / focus / distracciones ───────────────
  useEffect(() => {
    if (!isCapacitorIOS()) return;
    if (!activityActiveRef.current || !activeSession) return;

    const pausedChanged     = paused !== prevPausedRef.current;
    const focusChanged      = focusScore !== prevFocusRef.current;
    const distractChanged   = distractionCount !== prevDistractRef.current;

    if (!pausedChanged && !focusChanged && !distractChanged) return;

    prevPausedRef.current   = paused;
    prevFocusRef.current    = focusScore;
    prevDistractRef.current = distractionCount;

    const remMs  = timeRemainingMs > 0 ? timeRemainingMs : 0;
    const remSec = Math.round(remMs / 1000);

    void import("@/plugins/LiveActivityPlugin")
      .then(({ default: LiveActivity }) =>
        LiveActivity?.update({
          endTimestampMs:          Date.now() + remMs,
          focusScore,
          distractionCount,
          isPaused:                paused,
          pausedSecondsRemaining:  remSec,
          subject:                 activeSession.focus || activeSession.sessionTitle || "",
          progressPercent:         progressPct,
        }).catch(() => {}),
      )
      .catch(() => {});
  }, [paused, focusScore, distractionCount]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
