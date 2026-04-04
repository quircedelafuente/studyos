"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { StudyArenaProvider } from "@/components/study-arena/StudyArenaProvider";
import { StudyArenaFloatingWidget } from "@/components/study-arena/StudyArenaFloatingWidget";
import { StudyArenaFalseSessionModal } from "@/components/study-arena/StudyArenaFalseSessionModal";
import { CloudSyncProvider } from "@/components/providers/CloudSyncProvider";
import { CloudSyncIndicator } from "@/components/providers/CloudSyncIndicator";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <CloudSyncProvider>
        <CloudSyncIndicator />
        <StudyArenaProvider>
          <StudyArenaFloatingWidget />
          <StudyArenaFalseSessionModal />
          {children}
        </StudyArenaProvider>
      </CloudSyncProvider>
    </SessionProvider>
  );
}
