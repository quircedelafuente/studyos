"use client";

import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { useStudyArena } from "@/components/study-arena/StudyArenaProvider";

function isCapacitorIOS(): boolean {
  const native = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform();
  return native && platform === "ios";
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

  const activityActiveRef = useRef(false);
  const prevRunIdRef      = useRef<string | null>(null);
  const prevPausedRef     = useRef<boolean>(false);
  const prevFocusRef      = useRef<number>(100);
  const prevDistractRef   = useRef<number>(0);

  // ── Arrancar / terminar Live Activity ───────────────────────────────────
  useEffect(() => {
    const native   = Capacitor.isNativePlatform();
    const platform = Capacitor.getPlatform();
    console.log(`[LiveActivitySync] isNative=${native} platform=${platform}`);

    if (!isCapacitorIOS()) {
      console.log("[LiveActivitySync] no es iOS nativo, saliendo");
      return;
    }

    const runId  = activeSession?.arenaRunId ?? null;
    const prevId = prevRunIdRef.current;
    console.log(`[LiveActivitySync] runId=${runId} prevId=${prevId}`);

    if (runId === prevId) {
      console.log("[LiveActivitySync] runId sin cambios, noop");
      return;
    }
    prevRunIdRef.current = runId;

    void (async () => {
      console.log("[LiveActivitySync] importando plugin...");
      let LiveActivity: Awaited<typeof import("@/plugins/LiveActivityPlugin")>["default"] | null = null;
      try {
        LiveActivity = (await import("@/plugins/LiveActivityPlugin")).default;
        console.log("[LiveActivitySync] plugin importado:", LiveActivity);
      } catch (e) {
        console.error("[LiveActivitySync] error importando plugin:", e);
        return;
      }

      if (!LiveActivity) {
        console.error("[LiveActivitySync] plugin es null tras import");
        return;
      }

      let supported = false;
      try {
        const res = await LiveActivity.isSupported();
        supported = res.supported;
        console.log(`[LiveActivitySync] isSupported → ${supported}`);
      } catch (e) {
        console.error("[LiveActivitySync] isSupported error:", e);
      }

      // Terminar actividad anterior
      if (activityActiveRef.current) {
        console.log("[LiveActivitySync] terminando actividad anterior");
        await LiveActivity.end().catch((e: unknown) =>
          console.error("[LiveActivitySync] end() error:", e),
        );
        activityActiveRef.current = false;
      }

      // Arrancar nueva actividad
      if (runId !== null && activeSession && supported) {
        const totalSec = Math.round(activeSession.totalDurationMs / 1000);
        const remMs    = timeRemainingMs > 0 ? timeRemainingMs : activeSession.totalDurationMs;
        const endTs    = Date.now() + remMs;

        console.log(`[LiveActivitySync] start() title="${activeSession.planTitle}" subject="${activeSession.focus}" totalSec=${totalSec} endTs=${endTs} focusScore=${focusScore}`);

        try {
          const res = await LiveActivity.start({
            sessionTitle:         activeSession.planTitle,
            subject:              activeSession.focus || activeSession.sessionTitle || "",
            totalDurationSeconds: totalSec,
            endTimestampMs:       endTs,
            focusScore,
          });
          console.log(`[LiveActivitySync] start() → activityId="${res.activityId}"`);
          if (res.activityId) {
            activityActiveRef.current = true;
            prevPausedRef.current     = false;
            prevFocusRef.current      = focusScore;
            prevDistractRef.current   = 0;
          } else {
            console.warn("[LiveActivitySync] start() devolvió activityId vacío — Live Activities puede estar deshabilitado en Ajustes");
          }
        } catch (e) {
          console.error("[LiveActivitySync] start() error:", e);
        }
      } else {
        console.log(`[LiveActivitySync] no se arranca (runId=${runId} supported=${supported} hasSession=${!!activeSession})`);
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

    const remMs  = timeRemainingMs > 0 ? timeRemainingMs : 0;
    const remSec = Math.round(remMs / 1000);

    void import("@/plugins/LiveActivityPlugin")
      .then(({ default: LiveActivity }) =>
        LiveActivity?.update({
          endTimestampMs:         Date.now() + remMs,
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

  return null;
}
