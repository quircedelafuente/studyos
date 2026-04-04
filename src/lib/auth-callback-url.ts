/**
 * URL de retorno tras OAuth. Si el WebView expone un esquema no http(s)
 * (p. ej. algunas builds de Capacitor), Auth.js rechaza el callback con
 * "Configuration". En ese caso usa NEXT_PUBLIC_APP_URL (misma base pública
 * que en producción, p. ej. https://studyos-delta.vercel.app).
 */
export function getOAuthCallbackUrl(): string {
  if (typeof window === "undefined") return "/";
  const { protocol, origin } = window.location;
  if (protocol === "https:" || protocol === "http:") {
    return `${origin}/`;
  }
  const fallback = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (fallback) {
    try {
      return new URL(fallback).origin + "/";
    } catch {
      return "/";
    }
  }
  return "/";
}
