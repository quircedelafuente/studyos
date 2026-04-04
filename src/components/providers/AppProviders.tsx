"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { StudyArenaProvider } from "@/components/study-arena/StudyArenaProvider";
import { StudyArenaFloatingWidget } from "@/components/study-arena/StudyArenaFloatingWidget";
import { StudyArenaFalseSessionModal } from "@/components/study-arena/StudyArenaFalseSessionModal";
import { UserCloudSync } from "@/components/providers/UserCloudSync";
import { DeviceModeProvider } from "@/components/providers/DeviceModeContext";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <DeviceModeProvider>
        <UserCloudSync />
        <StudyArenaProvider>
          <StudyArenaFloatingWidget />
          <StudyArenaFalseSessionModal />
          {children}
        </StudyArenaProvider>
      </DeviceModeProvider>
    </SessionProvider>
  );
}
