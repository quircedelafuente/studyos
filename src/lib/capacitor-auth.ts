/**
 * Helper para autenticación OAuth en Capacitor iOS.
 *
 * Problema: el flujo estándar de NextAuth desde WKWebView genera cookies PKCE
 * en el WebView, pero Google redirige en Safari (SFSafariViewController), que
 * tiene un cookie store distinto → el callback no encuentra las cookies PKCE →
 * Auth.js falla con "Configuration error".
 *
 * Solución: abrimos TODA la cadena OAuth en SFSafariViewController mediante
 * @capacitor/browser. El endpoint /api/auth/mobile-start genera las cookies PKCE
 * y las devuelve al browser; el callback se completa en el mismo contexto Safari.
 * En iOS 14+ WKWebsiteDataStore.default() comparte cookies con Safari, por lo que
 * al recargar el WKWebView la sesión queda disponible.
 *
 * En web (no Capacitor) usa el signIn normal de next-auth/react.
 */
import { getOAuthCallbackUrl } from "@/lib/auth-callback-url";
import { Capacitor } from "@capacitor/core";

/** URL base de producción (build-time, igual que AUTH_URL en Vercel). */
const APP_URL =
  (process.env.NEXT_PUBLIC_APP_URL ?? "https://studyos-delta.vercel.app").replace(/\/$/, "");

export function isCapacitorIOS(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

/**
 * Inicia sesión con Google.
 * - iOS nativo: abre el flujo OAuth completo en SFSafariViewController.
 * - Web: usa signIn de next-auth/react (comportamiento normal).
 */
export async function signInWithGoogle(): Promise<void> {
  if (!isCapacitorIOS()) {
    const { signIn } = await import("next-auth/react");
    await signIn("google", { callbackUrl: getOAuthCallbackUrl() });
    return;
  }

  const { Browser } = await import("@capacitor/browser");

  // Abre el flujo completo en SFSafariViewController.
  // El endpoint mobile-start genera el redirect a Google + cookies PKCE.
  await Browser.open({
    url: `${APP_URL}/api/auth/mobile-start`,
    presentationStyle: "popover",
  });

  // Cuando el browser se cierra (por iestudio:// que lo trae a la app, o manual),
  // recarga el WKWebView para que recoja la cookie de sesión del store compartido.
  const listener = await Browser.addListener("browserFinished", async () => {
    await listener.remove();
    window.location.reload();
  });
}

/**
 * Registra el listener para el esquema iestudio:// en la app nativa.
 * Cuando /api/auth/mobile-callback redirige a iestudio://auth-callback,
 * iOS abre la app; aquí cerramos el browser y recargamos la sesión.
 *
 * Llamar desde AppProviders (useEffect) una sola vez al montar.
 * Devuelve una función de limpieza para el useEffect.
 */
export async function setupMobileAuthUrlHandler(): Promise<() => void> {
  if (!isCapacitorIOS()) return () => {};

  const [{ App }, { Browser }] = await Promise.all([
    import("@capacitor/app"),
    import("@capacitor/browser"),
  ]);

  const listener = await App.addListener("appUrlOpen", async (event) => {
    if (event.url.startsWith("iestudio://auth-callback")) {
      // Cierra el SFSafariViewController si aún está abierto
      await Browser.close().catch(() => {});
      // Recarga para que el WKWebView recoja la cookie de sesión
      window.location.reload();
    }
  });

  return () => {
    listener.remove().catch(() => {});
  };
}
