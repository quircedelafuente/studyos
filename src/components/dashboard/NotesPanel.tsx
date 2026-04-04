"use client";

import { useCallback, useEffect, useState } from "react";
import {
  addParkingLotNote,
  formatParkingNoteTime,
  loadParkingLotNotes,
  PARKING_LOT_CHANGED_EVENT,
  PARKING_LOT_STORAGE_KEY,
  updateParkingLotNote,
  type ParkingLotNote,
} from "@/lib/parking-lot-storage";
import { IconPencil, IconPlus } from "./icons";

type NoteModalMode = "create" | "edit";

function NoteModal({
  open,
  mode,
  note,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: NoteModalMode;
  note: ParkingLotNote | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!open) return;
    if (mode === "create") setDraft("");
    else if (note) setDraft(note.text);
  }, [open, mode, note]);

  if (!open) return null;

  const noteId = note?.id;

  function save() {
    const t = draft.trim();
    if (!t) return;
    if (mode === "create") {
      addParkingLotNote(t, { source: "manual" });
    } else if (noteId) {
      updateParkingLotNote(noteId, t);
    }
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Cerrar"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="note-modal-title"
        className="relative z-10 max-h-[min(90dvh,100%)] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl sm:rounded-2xl sm:p-5"
      >
        <h2 id="note-modal-title" className="text-lg font-extrabold text-[var(--ink)]">
          {mode === "create" ? "Nueva nota" : "Editar nota"}
        </h2>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={8}
          className="mt-4 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none"
          placeholder="Escribe aquí…"
        />
        <div className="mt-4 flex flex-wrap justify-end gap-2 pb-[env(safe-area-inset-bottom,0px)]">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-muted)]"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!draft.trim()}
            className="min-h-[44px] rounded-xl bg-[var(--ink)] px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

export function NotesPanel() {
  const [notes, setNotes] = useState<ParkingLotNote[]>([]);
  const [editing, setEditing] = useState<ParkingLotNote | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(() => {
    setNotes(loadParkingLotNotes());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    window.addEventListener(PARKING_LOT_CHANGED_EVENT, refresh);
    function onStorage(e: StorageEvent) {
      if (e.key === PARKING_LOT_STORAGE_KEY) refresh();
    }
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(PARKING_LOT_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, [refresh]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-col gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-3 md:px-6">
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight text-[var(--ink)]">Notas</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Ideas y apuntes en tarjetas. Las capturadas en Study Arena también aparecen aquí.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 self-start rounded-xl bg-[var(--ink)] px-4 py-2.5 text-sm font-bold text-white transition hover:opacity-90 sm:self-auto"
          aria-label="Nueva nota"
        >
          <IconPlus className="h-5 w-5" />
          Nueva
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-6 md:px-6">
        {notes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface-muted)] px-6 py-12 text-center text-sm text-[var(--ink-muted)]">
            No hay notas todavía. Pulsa <span className="font-bold text-[var(--ink)]">Nueva</span> para crear la primera,
            o captura ideas durante una sesión en Study Arena.
          </div>
        ) : (
          <ul className="mx-auto grid max-w-6xl grid-cols-1 justify-items-center gap-5 sm:grid-cols-2 sm:justify-items-stretch lg:grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))]">
            {notes.map((n) => (
              <li
                key={n.id}
                className="relative w-full max-w-[14.5rem] justify-self-center sm:max-w-none sm:justify-self-stretch"
                style={{ aspectRatio: "3 / 4" }}
              >
                <article className="absolute inset-0 flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[linear-gradient(165deg,color-mix(in_srgb,var(--surface)_92%,#f59e0b_8%)_0%,var(--surface)_55%)] shadow-sm">
                  <button
                    type="button"
                    onClick={() => setEditing(n)}
                    className="absolute right-2 top-2 z-10 rounded-lg border border-[var(--border)] bg-white/90 p-1.5 text-[var(--ink)] shadow-sm backdrop-blur-sm transition hover:bg-white"
                    aria-label="Editar nota"
                    title="Editar"
                  >
                    <IconPencil className="h-4 w-4" />
                  </button>
                  <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-11">
                    <p className="whitespace-pre-wrap text-sm leading-snug text-[var(--ink)]">{n.text}</p>
                  </div>
                  <footer className="shrink-0 border-t border-black/5 bg-black/[0.03] px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--ink-faint)]">
                      <time dateTime={n.createdAt}>{formatParkingNoteTime(n.createdAt)}</time>
                      <span
                        className={`rounded px-1.5 py-0.5 font-semibold ${
                          n.source === "session"
                            ? "bg-emerald-100/80 text-emerald-900"
                            : "bg-[var(--surface-muted)] text-[var(--ink-muted)]"
                        }`}
                      >
                        {n.source === "session" ? "Sesión" : "Manual"}
                      </span>
                    </div>
                  </footer>
                </article>
              </li>
            ))}
          </ul>
        )}
      </div>

      <NoteModal
        open={creating}
        mode="create"
        note={null}
        onClose={() => setCreating(false)}
        onSaved={refresh}
      />
      <NoteModal
        open={editing !== null}
        mode="edit"
        note={editing}
        onClose={() => setEditing(null)}
        onSaved={refresh}
      />
    </div>
  );
}
