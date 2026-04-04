"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const DeviceModeContext = createContext(false);

function detectMobileClient(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
    return true;
  }
  return window.matchMedia?.("(max-width: 768px) and (pointer: coarse)").matches ?? false;
}

export function DeviceModeProvider({ children }: { children: ReactNode }) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setIsMobile(detectMobileClient());
    const mq = window.matchMedia?.("(max-width: 768px) and (pointer: coarse)");
    const onMq = () => setIsMobile(detectMobileClient());
    mq?.addEventListener?.("change", onMq);
    return () => mq?.removeEventListener?.("change", onMq);
  }, []);

  return (
    <DeviceModeContext.Provider value={isMobile}>{children}</DeviceModeContext.Provider>
  );
}

export function useDeviceMode(): boolean {
  return useContext(DeviceModeContext);
}
