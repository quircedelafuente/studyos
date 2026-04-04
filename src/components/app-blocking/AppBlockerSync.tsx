"use client";

/**
 * AppBlockerSync — componente invisible que activa/desactiva el bloqueo de
 * Screen Time en función del estado de la sesión Study Arena.
 *
 * Montado siempre en AppProviders (sólo actúa en iOS nativo).
 */

import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { useStudyArena } from "@/components/study-arena/StudyArenaProvider";

function isCapacitorIOS(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

async function getPlugin() {
  const { default: ScreenTime } = await import("@/plugins/ScreenTimePlugin");
  return ScreenTime;
}

export function AppBlockerSync() {
  const { activeSession, paused } = useStudyArena();

  const prevRunIdRef = useRef<string | null>(null);
  const prevPausedRef = useRef<boolean>(false);
  const isAuthorizedRef = useRef<boolean>(false);
  const hasSelectionRef = useRef<boolean>(false);

  // Check once on mount whether the user has authorized and has apps selected
  useEffect(() => {
    if (!isCapacitorIOS()) return;
    void (async () => {
      try {
        const plugin = await getPlugin();
        const s = await plugin.getStatus();
        isAuthorizedRef.current = s.authorized;
        hasSelectionRef.current = s.selectionCount > 0;
      } catch {
        // not available
      }
    })();
  }, []);

  // React to session start / end
  useEffect(() => {
    if (!isCapacitorIOS()) return;

    const runId = activeSession?.arenaRunId ?? null;
    const prevId = prevRunIdRef.current;

    if (runId === prevId) return;
    prevRunIdRef.current = runId;

    void (async () => {
      if (!isAuthorizedRef.current || !hasSelectionRef.current) return;
      const plugin = await getPlugin();
      if (runId !== null && activeSession && !activeSession.paused) {
        // New session started — enable blocking
        await plugin.enableBlocking().catch(() => undefined);
        console.log("[AppBlockerSync] bloqueo activado (nueva sesión)");
      } else {
        // Session ended — disable blocking
        await plugin.disableBlocking().catch(() => undefined);
        console.log("[AppBlockerSync] bloqueo desactivado (sesión terminada)");
      }
    })();
  }, [activeSession?.arenaRunId]); // eslint-disable-line react-hooks/exhaustive-deps

  // React to pause / resume
  useEffect(() => {
    if (!isCapacitorIOS()) return;
    if (!activeSession) return;
    if (paused === prevPausedRef.current) return;
    prevPausedRef.current = paused;

    void (async () => {
      if (!isAuthorizedRef.current || !hasSelectionRef.current) return;
      const plugin = await getPlugin();
      if (paused) {
        await plugin.disableBlocking().catch(() => undefined);
        console.log("[AppBlockerSync] bloqueo desactivado (pausa)");
      } else {
        await plugin.enableBlocking().catch(() => undefined);
        console.log("[AppBlockerSync] bloqueo activado (reanudación)");
      }
    })();
  }, [paused]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
