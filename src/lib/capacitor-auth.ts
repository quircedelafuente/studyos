/**
 * Helper para autenticación OAuth en Capacitor iOS.
 *
 * Flujo:
 * 1. signInWithGoogle() abre /api/auth/mobile-start en SFSafariViewController.
 * 2. OAuth completa en Safari; Auth.js establece la cookie de sesión en su store.
 * 3. /api/auth/mobile-callback lee la cookie, crea un token de intercambio
 *    encriptado y redirige a iestudio://auth-callback?tok=<token>.
 * 4. setupMobileAuthUrlHandler() captura ese evento, cierra el browser y navega
 *    el WKWebView a /api/auth/mobile-exchange?tok=<token>.
 * 5. mobile-exchange desencripta el token, establece Set-Cookie en WKWebView y
 *    redirige a /, donde la sesión ya está activa.
 *
 * En web (no Capacitor) usa el signIn normal de next-auth/react.
 */
import { getOAuthCallbackUrl } from "@/lib/auth-callback-url";
import { Capacitor } from "@capacitor/core";

/** URL base de producción (build-time, igual que AUTH_URL en Vercel). */
const APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL ?? "https://studyos-delta.vercel.app"
).replace(/\/$/, "");

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
  // NO registramos browserFinished aquí: todo el ciclo lo gestiona
  // setupMobileAuthUrlHandler() vía el esquema iestudio://.
  // Si el usuario cierra el browser manualmente (sin completar OAuth),
  // simplemente no pasa nada (sesión no cambia).
  await Browser.open({
    url: `${APP_URL}/api/auth/mobile-start`,
    presentationStyle: "popover",
  });
}

/**
 * Registra el listener para el esquema iestudio:// en la app nativa.
 *
 * Cuando /api/auth/mobile-callback redirige a iestudio://auth-callback?tok=<token>:
 * 1. Cierra el SFSafariViewController.
 * 2. Navega el WKWebView a /api/auth/mobile-exchange?tok=<token>.
 *    Ese endpoint establece la cookie de sesión en WKWebView y redirige a /.
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

  let handled = false;

  const listener = await App.addListener("appUrlOpen", async (event) => {
    if (!event.url.startsWith("iestudio://auth-callback")) return;

    // Guard para evitar que el evento replay (tras recargas) dispare el flujo varias veces
    if (handled) return;
    handled = true;

    // Cierra el SFSafariViewController si aún está abierto
    await Browser.close().catch(() => {});

    // Extraer el token de intercambio del URL
    // iestudio://auth-callback?tok=<encryptedToken>
    const tokMatch = event.url.match(/[?&]tok=([^&]+)/);
    const tok = tokMatch ? tokMatch[1] : null;

    if (tok) {
      // Navegar el WKWebView al endpoint de intercambio para obtener la cookie de sesión
      window.location.href = `${APP_URL}/api/auth/mobile-exchange?tok=${tok}`;
    } else {
      // Fallback sin token (flujo antiguo o de emergencia)
      window.location.reload();
    }
  });

  return () => {
    listener.remove().catch(() => {});
  };
}
