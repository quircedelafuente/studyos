"use client";

import { useEffect } from "react";
import { useStudyArena } from "@/components/study-arena/StudyArenaProvider";

function Modal({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="relative max-h-[min(90dvh,100%)] w-full max-w-lg overflow-y-auto overflow-x-hidden rounded-t-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xl sm:rounded-2xl">
        {children}
      </div>
    </div>
  );
}

export function StudyArenaFalseSessionModal() {
  const { falseSessionPrompt, confirmFalseSession, restartFalseSession } = useStudyArena();

  useEffect(() => {
    if (!falseSessionPrompt) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // En vez de cerrar sin decisión: confirmamos la opción principal.
        confirmFalseSession();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [falseSessionPrompt, confirmFalseSession]);

  if (!falseSessionPrompt) return null;

  const message =
    falseSessionPrompt.reason === "too_long"
      ? "¿Realmente has estudiado? Esta sesión parece demasiado larga."
      : "¿Realmente has estudiado? Esta sesión parece demasiado corta.";

  const confirmLabel =
    falseSessionPrompt.mode === "active" ? "Sí, sigo estudiando" : "Sí, la doy por válida";

  return (
    <Modal>
      <div className="border-b border-[var(--border)] px-5 py-4">
        <h2 className="text-base font-extrabold text-[var(--ink)]">Revisión de sesión</h2>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">{message}</p>
      </div>
      <div className="space-y-3 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={confirmFalseSession}
            className="min-h-[48px] flex-1 rounded-xl bg-[var(--ink)] px-4 py-3 text-sm font-extrabold text-white transition hover:opacity-90"
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            onClick={restartFalseSession}
            className="min-h-[48px] flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
          >
            Reiniciar sesión
          </button>
        </div>
      </div>
    </Modal>
  );
}

