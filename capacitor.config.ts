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
   * Lista de clases de plugins iOS que Capacitor carga desde el bundle principal.
   * Capacitor 7 descubre plugins inline sólo a través de este array (lee
   * capacitor.config.json › packageClassList con NSClassFromString en el bridge).
   */
  // @ts-ignore — ios.packageClassList no está tipado en CapacitorConfig pero es leído por el bridge
  packageClassList: [
    "AppPlugin",
    "CAPBrowserPlugin",
    "LiveActivityPlugin",
    "ScreenTimePlugin",
    "WidgetDataPlugin",
  ],
};

export default config;
