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
   * No usar overrideUserAgent tipo Safari: en iOS puede hacer que Google abra el login
   * en Safari mientras state/PKCE viven en cookies del WKWebView → callback con error de servidor.
   */
};

export default config;
