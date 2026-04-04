import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Shell iOS: WKWebView carga la misma instancia que la web (Vercel).
 * No sustituye al build de Next; `webDir` es solo el mínimo que exige Capacitor.
 */
const config: CapacitorConfig = {
  appId: "com.agustmun.iestudio",
  appName: "IEStudio",
  webDir: "public/capacitor-shell",
  /** Sin esto, en modo oscuro iOS pinta el WKWebView con systemBackground (negro) hasta que carga la web → “pantalla negra”. */
  backgroundColor: "#ffffff",
  server: {
    url: "https://studyos-delta.vercel.app",
    cleartext: false,
  },
  /**
   * Google OAuth suele rechazar WebViews “genéricos”. Imitar Safari en iPhone mejora
   * el flujo en WKWebView (sigue pudiendo fallar por políticas de Google).
   */
  ios: {
    overrideUserAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1",
  },
};

export default config;
