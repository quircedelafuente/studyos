"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  applyTheme,
  loadThemePreference,
  saveThemePreference,
  THEME_CHANGED_EVENT,
  type ThemePreference,
} from "@/lib/theme";

const OPTIONS: ReadonlyArray<{
  value: ThemePreference;
  label: string;
  title: string;
}> = [
  { value: "light", label: "Claro", title: "Siempre claro" },
  { value: "dark", label: "Oscuro", title: "Siempre oscuro" },
  { value: "system", label: "Auto", title: "Seguir al sistema" },
];

/**
 * La preferencia vive en localStorage, que es estado externo a React: se lee
 * con `useSyncExternalStore` en vez de con un `useState` + `useEffect`, para
 * no desincronizarse ni escribir estado durante el efecto.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener(THEME_CHANGED_EVENT, onChange);
  // Otra pestaña, u otro dispositivo vía sincronización, puede cambiarlo.
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(THEME_CHANGED_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function ThemeToggle() {
  const pref = useSyncExternalStore<ThemePreference>(
    subscribe,
    loadThemePreference,
    () => "system",
  );

  /** Con `system`, hay que repintar si el sistema cambia con la app abierta. */
  useEffect(() => {
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystem = () => applyTheme("system");
    mq.addEventListener("change", onSystem);
    return () => mq.removeEventListener("change", onSystem);
  }, [pref]);

  const choose = useCallback((next: ThemePreference) => {
    saveThemePreference(next);
  }, []);

  return (
    <div
      role="radiogroup"
      aria-label="Tema de la interfaz"
      className="flex items-center gap-0.5 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-0.5"
    >
      {OPTIONS.map((o) => {
        const active = pref === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => choose(o.value)}
            className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${
              active
                ? "bg-[var(--surface)] text-[var(--ink)] shadow-sm"
                : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
