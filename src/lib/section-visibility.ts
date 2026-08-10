import type { MainTabId } from "@/types/dashboard";

/**
 * Secciones ocultas del menú lateral.
 *
 * Se guardan las **ocultas**, no las visibles: así una sección nueva aparece
 * sola en vez de quedarse escondida hasta que alguien la active. Prefijo
 * `iestudio-` para que viaje por la sincronización entre dispositivos.
 */
export const HIDDEN_SECTIONS_STORAGE_KEY = "iestudio-hidden-sections";

export const SECTIONS_CHANGED_EVENT = "iestudio-sections-changed";

/** Nunca se puede ocultar: es la vuelta a casa si te quedas sin nada visible. */
export const ALWAYS_VISIBLE: MainTabId[] = ["dashboard"];

export function loadHiddenSections(): Set<MainTabId> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(HIDDEN_SECTIONS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    const ids = parsed.filter((x): x is MainTabId => typeof x === "string");
    return new Set(ids.filter((id) => !ALWAYS_VISIBLE.includes(id)));
  } catch {
    return new Set();
  }
}

export function saveHiddenSections(hidden: Set<MainTabId>): void {
  if (typeof window === "undefined") return;
  try {
    const clean = [...hidden].filter((id) => !ALWAYS_VISIBLE.includes(id));
    window.localStorage.setItem(HIDDEN_SECTIONS_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    // quota / modo privado: el cambio vale para esta sesión
  }
  window.dispatchEvent(new CustomEvent(SECTIONS_CHANGED_EVENT));
}

/** Serializa el conjunto para `useSyncExternalStore`, que compara por valor. */
export function hiddenSectionsSnapshot(): string {
  if (typeof window === "undefined") return "[]";
  try {
    return window.localStorage.getItem(HIDDEN_SECTIONS_STORAGE_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

export function subscribeToSections(onChange: () => void): () => void {
  window.addEventListener(SECTIONS_CHANGED_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(SECTIONS_CHANGED_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
