"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { StudyArenaProvider } from "@/components/study-arena/StudyArenaProvider";
import { StudyArenaFloatingWidget } from "@/components/study-arena/StudyArenaFloatingWidget";
import { StudyArenaFalseSessionModal } from "@/components/study-arena/StudyArenaFalseSessionModal";
import { LiveActivitySync } from "@/components/study-arena/LiveActivitySync";
import { CloudSyncProvider } from "@/components/providers/CloudSyncProvider";
import { CloudSyncIndicator } from "@/components/providers/CloudSyncIndicator";

export function AppProviders({ children }: { children: ReactNode }) {
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    // Registra el handler del esquema iestudio:// para el callback OAuth en iOS.
    // Es una importación dinámica para que no falle en web.
    import("@/lib/capacitor-auth")
      .then(({ setupMobileAuthUrlHandler }) =>
        setupMobileAuthUrlHandler().then((fn) => {
          cleanup = fn;
        }),
      )
      .catch(() => {});
    return () => {
      cleanup?.();
    };
  }, []);

  return (
    <SessionProvider>
      <CloudSyncProvider>
        <StudyArenaProvider>
          <LiveActivitySync />
          <StudyArenaFloatingWidget />
          <StudyArenaFalseSessionModal />
          {children}
        </StudyArenaProvider>
      </CloudSyncProvider>
    </SessionProvider>
  );
}
