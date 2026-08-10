/** Tema de la interfaz. `system` sigue la preferencia del sistema operativo. */
export type ThemePreference = "light" | "dark" | "system";

/**
 * Prefijo `iestudio-` a propósito: así viaja por la sincronización y el tema
 * elegido en el portátil aparece también en el iPad.
 */
export const THEME_STORAGE_KEY = "iestudio-theme";

export const THEME_CHANGED_EVENT = "iestudio-theme-changed";

export function isThemePreference(v: unknown): v is ThemePreference {
  return v === "light" || v === "dark" || v === "system";
}

export function loadThemePreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

/** Resuelve `system` consultando al navegador. */
export function resolveTheme(pref: ThemePreference): "light" | "dark" {
  if (pref !== "system") return pref;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** Escribe `data-theme` en <html>. Es lo único que lee el CSS. */
export function applyTheme(pref: ThemePreference): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolveTheme(pref);
}

export function saveThemePreference(pref: ThemePreference): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // quota / modo privado: el tema sigue aplicándose en esta sesión
  }
  applyTheme(pref);
  window.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT));
}

/**
 * Script que se inyecta en <head> y corre antes del primer pintado.
 *
 * Sin esto la página se dibuja en claro y salta a oscuro al hidratar React,
 * que es el clásico fogonazo blanco. Va como string porque tiene que ser
 * síncrono y anterior a cualquier bundle.
 */
export const THEME_INIT_SCRIPT = `(function(){try{
var p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
if(p!=="light"&&p!=="dark"&&p!=="system")p="system";
var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);
document.documentElement.dataset.theme=d?"dark":"light";
}catch(e){}})();`;
