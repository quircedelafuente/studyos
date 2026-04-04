"use client";

import { useEffect } from "react";
import type { ParkingLotNote } from "@/lib/parking-lot-storage";

export function ParkingLotSessionReviewModal({
  open,
  notes,
  onClose,
}: {
  open: boolean;
  notes: ParkingLotNote[];
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4">
      <button type="button" className="absolute inset-0" aria-label="Cerrar" onClick={onClose} />
      <div className="relative z-10 max-h-[90dvh] w-full max-w-md overflow-hidden rounded-t-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xl sm:rounded-2xl">
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-base font-extrabold text-[var(--ink)]">Parking Lot de esta sesión</h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            Ideas que apuntaste para no cargar la memoria durante el estudio.
          </p>
        </div>
        <div className="max-h-[min(50vh,20rem)] overflow-y-auto px-5 py-4">
          {notes.length === 0 ? (
            <p className="text-sm text-[var(--ink-muted)]">No hay apuntes en esta sesión.</p>
          ) : (
            <ul className="space-y-2">
              {notes.map((n) => (
                <li
                  key={n.id}
                  className="rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm leading-snug text-[var(--ink)]"
                >
                  {n.text}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t border-[var(--border)] px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[48px] w-full rounded-xl bg-[var(--ink)] px-4 py-2.5 text-sm font-extrabold text-white transition hover:opacity-90"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
