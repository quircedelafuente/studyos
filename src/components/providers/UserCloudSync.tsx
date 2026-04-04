"use client";

import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef } from "react";
import {
  applyCloudEntries,
  collectSyncableEntries,
  syncSnapshotSignature,
} from "@/lib/user-cloud-storage";

const PUSH_INTERVAL_MS = 12_000;

export function UserCloudSync() {
  const { data: session, status } = useSession();
  const userId = session?.user?.id;
  const lastPushedSig = useRef<string>("");

  const push = useCallback(async () => {
    if (!userId) return;
    const entries = collectSyncableEntries();
    const sig = syncSnapshotSignature(entries);
    if (sig === lastPushedSig.current) return;
    const res = await fetch("/api/user-sync", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries }),
      credentials: "same-origin",
    });
    if (res.ok) lastPushedSig.current = sig;
  }, [userId]);

  useEffect(() => {
    if (status !== "authenticated" || !userId) {
      lastPushedSig.current = "";
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/user-sync", { credentials: "same-origin" });
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as {
          disabled?: boolean;
          entries?: Record<string, string>;
        };
        if (data.disabled) return;
        const server = data.entries ?? {};
        if (Object.keys(server).length === 0) {
          await push();
        } else {
          applyCloudEntries(server);
          lastPushedSig.current = syncSnapshotSignature(
            collectSyncableEntries(),
          );
        }
      } catch {
        /* offline */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, userId, push]);

  useEffect(() => {
    if (status !== "authenticated" || !userId) return;
    const id = window.setInterval(() => {
      void push();
    }, PUSH_INTERVAL_MS);
    const onVis = () => {
      if (document.visibilityState === "hidden") void push();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [status, userId, push]);

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

  return null;
}
