"use client";

import { useCallback, useEffect } from "react";
import type { MainTabId } from "@/types/dashboard";
import {
  ALWAYS_VISIBLE,
  loadHiddenSections,
  saveHiddenSections,
} from "@/lib/section-visibility";
import { IconX } from "./icons";

export type SectionOption = {
  id: MainTabId;
  label: string;
  Icon: (p: { className?: string }) => React.ReactElement;
};

export function SectionsSettingsModal({
  open,
  onClose,
  sections,
  hidden,
}: {
  open: boolean;
  onClose: () => void;
  /** Todas las secciones disponibles en este dispositivo. */
  sections: SectionOption[];
  hidden: Set<MainTabId>;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const toggle = useCallback((id: MainTabId) => {
    if (ALWAYS_VISIBLE.includes(id)) return;
    const next = loadHiddenSections();
    if (next.has(id)) next.delete(id);
    else next.add(id);
    saveHiddenSections(next);
  }, []);

  const showAll = useCallback(() => saveHiddenSections(new Set()), []);

  if (!open) return null;

  const visibleCount = sections.filter((s) => !hidden.has(s.id)).length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ajustes de secciones"
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="Cerrar ajustes"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div className="relative flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[var(--ink)]">Secciones</h2>
            <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
              Elige cuáles aparecen en el menú · {visibleCount} de {sections.length}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="shrink-0 rounded-lg p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
          >
            <IconX className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {sections.map(({ id, label, Icon }) => {
            const isVisible = !hidden.has(id);
            const locked = ALWAYS_VISIBLE.includes(id);
            return (
              <button
                key={id}
                type="button"
                role="switch"
                aria-checked={isVisible}
                disabled={locked}
                onClick={() => toggle(id)}
                title={locked ? "Esta sección no se puede ocultar" : undefined}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                  locked
                    ? "cursor-not-allowed opacity-60"
                    : "hover:bg-[var(--surface-muted)]"
                }`}
              >
                <Icon className="h-5 w-5 shrink-0 text-[var(--ink-muted)]" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--ink)]">
                  {label}
                </span>
                <span
                  aria-hidden
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                    isVisible ? "bg-[var(--ink)]" : "bg-[var(--border)]"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-[var(--surface)] transition-transform ${
                      isVisible ? "translate-x-[1.125rem]" : "translate-x-0.5"
                    }`}
                  />
                </span>
              </button>
            );
          })}
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-3">
          <button
            type="button"
            onClick={showAll}
            className="text-xs font-semibold text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
          >
            Mostrar todas
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-[var(--ink)] px-4 py-2 text-xs font-semibold text-white transition hover:opacity-90"
          >
            Hecho
          </button>
        </footer>
      </div>
    </div>
  );
}
