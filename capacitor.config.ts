import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Shell iOS: WKWebView carga la misma instancia que la web (Vercel).
 * No sustituye al build de Next; `webDir` es solo el mínimo que exige Capacitor.
 */
const config: CapacitorConfig = {
  appId: "com.agustmun.iestudio",
  appName: "IEStudio",
  webDir: "public/capacitor-shell",
  server: {
    url: "https://studyos-delta.vercel.app",
    cleartext: false,
  },
};

export default config;
