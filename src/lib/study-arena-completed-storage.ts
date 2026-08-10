"use client";

import { requestCloudSyncPush, requestCloudSyncPushDebounced } from "@/lib/cloud-sync-push";

export const STUDY_ARENA_COMPLETED_STORAGE_KEY = "iestudio-study-arena-completed";
export const STUDY_ARENA_COMPLETED_DELETED_KEY = "iestudio-study-arena-completed-deleted";
export const STUDY_ARENA_COMPLETED_CHANGED_EVENT = "iestudio-study-arena-completed-changed";

export type CompletedSession = {
  /** Unique id per completion (not per session option — same session can be redone). */
  completionId: string;
  completedAt: string; // ISO timestamp
  /** Unique id per run — used to look up Parking Lot notes. */
  arenaRunId: string;

  // Session option fields
  key: string;
  planId: string;
  planTitle: string;
  date: string; // YYYY-MM-DD
  studyHours: number;
  focus: string;
  sessionTitle?: string;

  // Metrics
  focusScore: number; // 0-100
  distractionCount: number;
  elapsedActiveMs: number;
  totalDurationMs: number;
  startedAtMs: number;
};

/** Historial largo: todas las sesiones completadas por día (mismo esquema de sync en nube). */
export const MAX_COMPLETED_SESSIONS = 10_000;

function isCompletedSession(x: unknown): x is CompletedSession {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.completionId === "string" &&
    typeof o.completedAt === "string" &&
    typeof o.arenaRunId === "string" &&
    typeof o.key === "string" &&
    typeof o.planId === "string" &&
    typeof o.planTitle === "string" &&
    typeof o.date === "string" &&
    typeof o.studyHours === "number" &&
    typeof o.focus === "string" &&
    typeof o.focusScore === "number" &&
    typeof o.distractionCount === "number" &&
    typeof o.elapsedActiveMs === "number" &&
    typeof o.totalDurationMs === "number" &&
    typeof o.startedAtMs === "number"
  );
}

/** Carga el set de completionIds borrados explícitamente (tombstones). */
function loadDeletedIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STUDY_ARENA_COMPLETED_DELETED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function saveDeletedIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STUDY_ARENA_COMPLETED_DELETED_KEY,
      JSON.stringify([...ids]),
    );
  } catch {
    // quota
  }
  requestCloudSyncPush();
}

/** Carga el array raw sin aplicar filtro de tombstones (para uso interno). */
function loadRawCompletedSessions(): CompletedSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STUDY_ARENA_COMPLETED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCompletedSession);
  } catch {
    return [];
  }
}

export function loadCompletedSessions(): CompletedSession[] {
  if (typeof window === "undefined") return [];
  const deleted = loadDeletedIds();
  const seen = new Set<string>();
  const list = loadRawCompletedSessions()
    .filter((s) => {
      // Tombstones: se guardan tanto completionId (histórico) como arenaRunId.
      // Mirar los dos es lo que hace que borrar elimine también los clones del
      // mismo run que haya podido crear la sincronización.
      if (deleted.has(s.completionId) || deleted.has(s.arenaRunId)) return false;
      // Deduplicar por arenaRunId (puede haber duplicados por race en sync)
      if (seen.has(s.arenaRunId)) return false;
      seen.add(s.arenaRunId);
      return true;
    });
  // Más recientes primero
  return list.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
}

function saveCompletedSessionsList(sessions: CompletedSession[], immediate = false): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STUDY_ARENA_COMPLETED_STORAGE_KEY,
      JSON.stringify(sessions),
    );
    window.dispatchEvent(new CustomEvent(STUDY_ARENA_COMPLETED_CHANGED_EVENT));
  } catch {
    // quota
  }
  if (immediate) {
    requestCloudSyncPush();
  } else {
    requestCloudSyncPushDebounced(2500);
  }
}

/**
 * Borra una sesión completada.
 *
 * Se marca el `arenaRunId` además del `completionId` porque la fusión en la nube
 * puede haber dejado varios registros del mismo run con completionIds
 * distintos. Marcando solo uno, los clones sobrevivían y al recargar la sesión
 * reaparecía: se veía como si el borrado no hubiera funcionado.
 */
export function deleteCompletedSession(completionId: string): void {
  const existing = loadRawCompletedSessions();
  const target = existing.find((s) => s.completionId === completionId);
  const runId = target?.arenaRunId;

  const deleted = loadDeletedIds();
  deleted.add(completionId);
  if (runId) deleted.add(runId);
  saveDeletedIds(deleted);

  // Fuera del array local todos los registros de ese run, no solo el pulsado.
  const next = existing.filter(
    (s) => s.completionId !== completionId && (!runId || s.arenaRunId !== runId),
  );
  saveCompletedSessionsList(next, true);
}

export function saveCompletedSession(session: Omit<CompletedSession, "completionId" | "completedAt">): void {
  const existing = loadRawCompletedSessions();
  // Deduplicar: si ya existe una entrada con el mismo arenaRunId, no guardar de nuevo
  if (existing.some((s) => s.arenaRunId === session.arenaRunId)) return;
  const record: CompletedSession = {
    ...session,
    completionId: crypto.randomUUID(),
    completedAt: new Date().toISOString(),
  };
  // Prepend newest first, cap at MAX
  const next = [record, ...existing].slice(0, MAX_COMPLETED_SESSIONS);
  saveCompletedSessionsList(next);
}
