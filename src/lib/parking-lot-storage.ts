export type ParkingLotNoteSource = "session" | "manual";

export type ParkingLotNote = {
  id: string;
  text: string;
  createdAt: string;
  source: ParkingLotNoteSource;
  /** Presente si la nota se capturó durante una sesión de Study Arena */
  sessionKey?: string;
  /** Id único por ejecución de sesión (mismo plan+día puede repetirse) */
  arenaRunId?: string;
};

export const PARKING_LOT_STORAGE_KEY = "iestudio-parking-lot-notes";

export const PARKING_LOT_CHANGED_EVENT = "iestudio-parking-lot-changed";

export function formatParkingNoteTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isNote(x: unknown): x is ParkingLotNote {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.text === "string" &&
    typeof o.createdAt === "string" &&
    (o.source === "session" || o.source === "manual")
  );
}

export function loadParkingLotNotes(): ParkingLotNote[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PARKING_LOT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: ParkingLotNote[] = [];
    for (const item of parsed) {
      if (!isNote(item)) continue;
      const n: ParkingLotNote = {
        id: item.id,
        text: item.text.slice(0, 2000),
        createdAt: item.createdAt,
        source: item.source,
      };
      if (typeof item.sessionKey === "string" && item.sessionKey.trim()) {
        n.sessionKey = item.sessionKey.trim();
      }
      if (typeof item.arenaRunId === "string" && item.arenaRunId.trim()) {
        n.arenaRunId = item.arenaRunId.trim();
      }
      out.push(n);
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export function saveParkingLotNotes(notes: ParkingLotNote[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PARKING_LOT_STORAGE_KEY, JSON.stringify(notes));
    window.dispatchEvent(new CustomEvent(PARKING_LOT_CHANGED_EVENT));
  } catch {
    // quota
  }
}

export function addParkingLotNote(
  text: string,
  opts: { source: ParkingLotNoteSource; sessionKey?: string; arenaRunId?: string },
): ParkingLotNote | null {
  const t = text.trim();
  if (!t) return null;
  const note: ParkingLotNote = {
    id: crypto.randomUUID(),
    text: t,
    createdAt: new Date().toISOString(),
    source: opts.source,
    ...(opts.sessionKey?.trim() ? { sessionKey: opts.sessionKey.trim() } : {}),
    ...(opts.arenaRunId?.trim() ? { arenaRunId: opts.arenaRunId.trim() } : {}),
  };
  const all = loadParkingLotNotes();
  saveParkingLotNotes([note, ...all]);
  return note;
}

export function deleteParkingLotNote(id: string): void {
  const all = loadParkingLotNotes();
  saveParkingLotNotes(all.filter((n) => n.id !== id));
}

export function updateParkingLotNote(id: string, text: string): void {
  const t = text.trim();
  if (!t) return;
  const all = loadParkingLotNotes();
  const idx = all.findIndex((n) => n.id === id);
  if (idx === -1) return;
  const prev = all[idx];
  const next: ParkingLotNote = {
    ...prev,
    text: t.slice(0, 2000),
  };
  const copy = [...all];
  copy[idx] = next;
  saveParkingLotNotes(copy);
}

export function getParkingNotesForSession(sessionKey: string): ParkingLotNote[] {
  const k = sessionKey.trim();
  if (!k) return [];
  return loadParkingLotNotes()
    .filter((n) => n.sessionKey === k)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Notas capturadas en una ejecución concreta de Study Arena (por `arenaRunId`). */
export function getParkingNotesForRun(arenaRunId: string): ParkingLotNote[] {
  const id = arenaRunId.trim();
  if (!id) return [];
  return loadParkingLotNotes()
    .filter((n) => n.arenaRunId === id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
