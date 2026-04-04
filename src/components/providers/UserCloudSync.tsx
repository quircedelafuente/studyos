"use client";

import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef } from "react";
import { useDeviceMode } from "@/components/providers/DeviceModeContext";
import {
  applyCloudEntries,
  applyCloudEntriesSmartMerge,
  collectSyncableEntries,
  collectSyncableEntriesForUpload,
  getCloudServerAppliedAt,
  IESTUDIO_CLOUD_PUSH_REQUEST,
  normalizeCloudPayload,
  setCloudServerAppliedAt,
  syncSnapshotSignature,
} from "@/lib/user-cloud-storage";

const PUSH_INTERVAL_MS = 12_000;

export function UserCloudSync() {
  const { data: session, status } = useSession();
  const userId = session?.user?.id;
  const isMobile = useDeviceMode();
  const lastPushedSig = useRef<string>("");

  const syncPullIfServerNewer = useCallback(async () => {
    const res = await fetch("/api/user-sync", { credentials: "same-origin" });
    if (!res.ok) return;
    const data = (await res.json()) as {
      disabled?: boolean;
      entries?: Record<string, unknown>;
      updatedAt?: string | null;
    };
    if (data.disabled) return;
    const serverEntries = normalizeCloudPayload(data.entries ?? {});
    const hasPayload = Object.keys(serverEntries).length > 0;
    if (!hasPayload && !data.updatedAt) return;
    if (data.updatedAt) {
      const applied = getCloudServerAppliedAt();
      if (applied !== null && data.updatedAt <= applied) return;
    }
    if (hasPayload) {
      applyCloudEntriesSmartMerge(serverEntries);
    }
    if (data.updatedAt) {
      setCloudServerAppliedAt(data.updatedAt);
    }
    lastPushedSig.current = syncSnapshotSignature(collectSyncableEntries());
  }, []);

  const push = useCallback(async () => {
    if (!userId?.trim()) return;
    await syncPullIfServerNewer();
    const entries = collectSyncableEntriesForUpload(isMobile);
    const sig = syncSnapshotSignature(entries);
    if (sig === lastPushedSig.current) return;
    const res = await fetch("/api/user-sync", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries, merge: isMobile }),
      credentials: "same-origin",
    });
    if (res.ok) {
      const body = (await res.json()) as { updatedAt?: string };
      if (body.updatedAt) setCloudServerAppliedAt(body.updatedAt);
      lastPushedSig.current = sig;
    }
  }, [userId, isMobile, syncPullIfServerNewer]);

  useEffect(() => {
    if (status !== "authenticated" || !userId?.trim()) {
      lastPushedSig.current = "";
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        let res = await fetch("/api/user-sync", {
          credentials: "same-origin",
        });
        if (cancelled) return;
        if (!res.ok && res.status === 401) {
          await new Promise((r) => setTimeout(r, 1200));
          if (cancelled) return;
          res = await fetch("/api/user-sync", {
            credentials: "same-origin",
          });
        }
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as {
          disabled?: boolean;
          entries?: Record<string, unknown>;
          updatedAt?: string | null;
        };
        if (data.disabled) return;
        const server = normalizeCloudPayload(data.entries ?? {});
        if (Object.keys(server).length === 0) {
          await push();
        } else {
          applyCloudEntriesSmartMerge(server);
          if (data.updatedAt) setCloudServerAppliedAt(data.updatedAt);
          lastPushedSig.current = syncSnapshotSignature(
            collectSyncableEntries(),
          );
          await push();
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
    if (status !== "authenticated" || !userId?.trim()) return;
    void push();
    const id = window.setInterval(() => {
      void push();
    }, PUSH_INTERVAL_MS);
    const onVis = () => {
      if (document.visibilityState === "hidden") void push();
      if (document.visibilityState === "visible") void syncPullIfServerNewer();
    };
    document.addEventListener("visibilitychange", onVis);
    const onOnline = () => {
      void syncPullIfServerNewer();
      void push();
    };
    window.addEventListener("online", onOnline);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onOnline);
    };
  }, [status, userId, push, syncPullIfServerNewer]);

  useEffect(() => {
    if (status !== "authenticated" || !userId?.trim()) return;
    const onReq = () => {
      void push();
    };
    window.addEventListener(IESTUDIO_CLOUD_PUSH_REQUEST, onReq);
    return () =>
      window.removeEventListener(IESTUDIO_CLOUD_PUSH_REQUEST, onReq);
  }, [status, userId, push]);

  useEffect(() => {
    if (status !== "authenticated" || !userId?.trim()) return;
    const flush = () => {
      void push();
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [status, userId, push]);

  return null;
}
