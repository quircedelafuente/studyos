"use client";

import { useSession } from "next-auth/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useDeviceMode } from "@/components/providers/DeviceModeContext";
import {
  applyCloudEntriesSmartMerge,
  collectSyncableEntries,
  collectSyncableEntriesForUpload,
  computeCloudEntryStats,
  getCloudServerAppliedAt,
  IESTUDIO_CLOUD_PUSH_REQUEST,
  normalizeCloudPayload,
  setCloudServerAppliedAt,
  syncSnapshotSignature,
} from "@/lib/user-cloud-storage";

const PUSH_INTERVAL_MS = 12_000;

const FETCH_OPTS: RequestInit = {
  credentials: "same-origin",
  cache: "no-store",
};

export type CloudSyncPhase =
  | "unauthenticated"
  | "pulling"
  | "ready"
  | "error"
  | "no_database";

export type CloudSyncSnapshot = {
  phase: CloudSyncPhase;
  serverUpdatedAt: string | null;
  serverStats: { totalKeys: number; bbKeys: number; approxBytes: number } | null;
  localStats: { totalKeys: number; bbKeys: number; approxBytes: number } | null;
  lastPullAt: number | null;
  lastSuccessfulPushAt: number | null;
  errorMessage: string | null;
  initialSyncDone: boolean;
  refresh: () => Promise<void>;
};

const defaultSnapshot: CloudSyncSnapshot = {
  phase: "unauthenticated",
  serverUpdatedAt: null,
  serverStats: null,
  localStats: null,
  lastPullAt: null,
  lastSuccessfulPushAt: null,
  errorMessage: null,
  initialSyncDone: false,
  refresh: async () => {},
};

const CloudSyncContext = createContext<CloudSyncSnapshot>(defaultSnapshot);

export function useCloudSync(): CloudSyncSnapshot {
  return useContext(CloudSyncContext);
}

export function CloudSyncProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const userId = session?.user?.id;
  const isMobile = useDeviceMode();
  const lastPushedSig = useRef<string>("");

  const [phase, setPhase] = useState<CloudSyncPhase>("unauthenticated");
  const [serverUpdatedAt, setServerUpdatedAt] = useState<string | null>(null);
  const [serverStats, setServerStats] = useState<CloudSyncSnapshot["serverStats"]>(null);
  const [localStats, setLocalStats] = useState<CloudSyncSnapshot["localStats"]>(null);
  const [lastPullAt, setLastPullAt] = useState<number | null>(null);
  const [lastSuccessfulPushAt, setLastSuccessfulPushAt] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [initialSyncDone, setInitialSyncDone] = useState(false);

  const bumpLocalStats = useCallback(() => {
    setLocalStats(computeCloudEntryStats(collectSyncableEntries()));
  }, []);

  const syncPullIfServerNewer = useCallback(async () => {
    const res = await fetch("/api/user-sync", FETCH_OPTS);
    if (!res.ok) return;
    const data = (await res.json()) as {
      disabled?: boolean;
      entries?: Record<string, unknown>;
      updatedAt?: string | null;
      stats?: { totalKeys: number; bbKeys: number; approxBytes: number } | null;
    };
    if (data.disabled) return;
    if (data.stats) setServerStats(data.stats);
    if (typeof data.updatedAt === "string") setServerUpdatedAt(data.updatedAt);
    const serverEntries = normalizeCloudPayload(data.entries ?? {});
    const hasPayload = Object.keys(serverEntries).length > 0;
    if (!hasPayload && !data.updatedAt) return;
    if (data.updatedAt) {
      const applied = getCloudServerAppliedAt();
      if (applied !== null && data.updatedAt <= applied) return;
    }
    if (hasPayload) {
      applyCloudEntriesSmartMerge(serverEntries);
      bumpLocalStats();
    }
    if (data.updatedAt) setCloudServerAppliedAt(data.updatedAt);
    lastPushedSig.current = syncSnapshotSignature(collectSyncableEntries());
    setLastPullAt(Date.now());
  }, [bumpLocalStats]);

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
      ...FETCH_OPTS,
    });
    if (res.ok) {
      const body = (await res.json()) as { updatedAt?: string };
      if (body.updatedAt) {
        setCloudServerAppliedAt(body.updatedAt);
        setServerUpdatedAt(body.updatedAt);
      }
      lastPushedSig.current = sig;
      setLastSuccessfulPushAt(Date.now());
      bumpLocalStats();
    }
  }, [userId, isMobile, syncPullIfServerNewer, bumpLocalStats]);

  const runBootstrap = useCallback(async () => {
    if (!userId?.trim()) return;
    setPhase("pulling");
    setErrorMessage(null);
    try {
      let res = await fetch("/api/user-sync", FETCH_OPTS);
      if (!res.ok && res.status === 401) {
        await new Promise((r) => setTimeout(r, 1200));
        res = await fetch("/api/user-sync", FETCH_OPTS);
      }
      if (!res.ok) {
        setPhase("error");
        setErrorMessage(`No se pudo leer la nube (HTTP ${res.status}).`);
        setInitialSyncDone(true);
        return;
      }
      const data = (await res.json()) as {
        disabled?: boolean;
        entries?: Record<string, unknown>;
        updatedAt?: string | null;
        stats?: { totalKeys: number; bbKeys: number; approxBytes: number } | null;
      };
      if (data.disabled) {
        setPhase("no_database");
        setServerStats(null);
        setServerUpdatedAt(null);
        setInitialSyncDone(true);
        bumpLocalStats();
        return;
      }
      if (data.stats) setServerStats(data.stats);
      if (typeof data.updatedAt === "string") setServerUpdatedAt(data.updatedAt);

      const server = normalizeCloudPayload(data.entries ?? {});
      if (Object.keys(server).length === 0) {
        await push();
      } else {
        applyCloudEntriesSmartMerge(server);
        if (data.updatedAt) setCloudServerAppliedAt(data.updatedAt);
        lastPushedSig.current = syncSnapshotSignature(collectSyncableEntries());
        bumpLocalStats();
        await push();
      }
      setLastPullAt(Date.now());
      setPhase("ready");
      setInitialSyncDone(true);
    } catch (e) {
      setPhase("error");
      setErrorMessage(e instanceof Error ? e.message : "Error de red");
      setInitialSyncDone(true);
    }
  }, [userId, push, bumpLocalStats]);

  const refresh = useCallback(async () => {
    await runBootstrap();
    await push();
  }, [runBootstrap, push]);

  useEffect(() => {
    if (status === "authenticated" && userId?.trim()) {
      setPhase((p) => (p === "unauthenticated" ? "pulling" : p));
    }
  }, [status, userId]);

  useEffect(() => {
    if (status !== "authenticated" || !userId?.trim()) {
      lastPushedSig.current = "";
      setPhase("unauthenticated");
      setInitialSyncDone(false);
      setServerStats(null);
      setServerUpdatedAt(null);
      return;
    }
    void runBootstrap();
  }, [status, userId, runBootstrap]);

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

  const value = useMemo<CloudSyncSnapshot>(
    () => ({
      phase,
      serverUpdatedAt,
      serverStats,
      localStats,
      lastPullAt,
      lastSuccessfulPushAt,
      errorMessage,
      initialSyncDone,
      refresh,
    }),
    [
      phase,
      serverUpdatedAt,
      serverStats,
      localStats,
      lastPullAt,
      lastSuccessfulPushAt,
      errorMessage,
      initialSyncDone,
      refresh,
    ],
  );

  return (
    <CloudSyncContext.Provider value={value}>{children}</CloudSyncContext.Provider>
  );
}
