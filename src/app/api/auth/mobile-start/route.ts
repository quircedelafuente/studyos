/**
 * GET /api/auth/mobile-start
 *
 * Endpoint para el flujo OAuth en iOS (Capacitor + SFSafariViewController).
 *
 * Problema: GET /api/auth/signin/google no existe en Auth.js v5 (lanza UnknownAction).
 * El flujo normal hace POST desde WKWebView → genera cookies PKCE en WKWebView →
 * Google redirige en Safari → callback en Safari sin cookies PKCE → "Configuration error".
 *
 * Solución: este endpoint recibe un GET desde SFSafariViewController, construye
 * internamente el POST a Auth.js (saltando CSRF con skipCSRFCheck), obtiene la URL
 * de Google OAuth + las cookies PKCE, y devuelve un redirect 302 al navegador con
 * esas cookies en el Set-Cookie. De este modo, TODO el flujo (PKCE, callback) ocurre
 * en el mismo contexto Safari y las cookies son consistentes.
 */
import { Auth, skipCSRFCheck } from "@auth/core";
import { buildAuthConfig } from "@/auth";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const APP_URL =
    process.env.AUTH_URL?.replace(/\/$/, "") ??
    "https://studyos-delta.vercel.app";
  const callbackUrl = `${APP_URL}/api/auth/mobile-callback`;

  const config = buildAuthConfig(req);

  // Aplica los mismos defaults que hace next-auth/lib/env.js setEnvDefaults
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfg = config as any;
  if (!cfg.secret) {
    cfg.secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  }
  cfg.basePath ??= "/api/auth";

  // Crea un POST sintético a /api/auth/signin/google
  const signinUrl = `${APP_URL}/api/auth/signin/google`;
  const body = new URLSearchParams({ callbackUrl });

  const signinReq = new Request(signinUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      cookie: req.headers.get("cookie") ?? "",
      "x-forwarded-proto": "https",
      "x-forwarded-host": new URL(APP_URL).host,
    },
    body: body.toString(),
  });

  // skipCSRFCheck: bypass de la validación CSRF (uso legítimo server-to-server)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await Auth(signinReq, { ...cfg, skipCSRFCheck } as any);

  if (!(response instanceof Response)) {
    return new Response("Internal auth error", { status: 500 });
  }

  const location = response.headers.get("location") ?? "";
  if (!location.includes("accounts.google.com")) {
    const text = await response.text().catch(() => "");
    console.error(
      "[mobile-start] OAuth no devolvió URL de Google:",
      response.status,
      location,
      text.slice(0, 400),
    );
    return new Response(
      `No se pudo iniciar OAuth (status ${response.status}). Comprueba AUTH_SECRET, AUTH_GOOGLE_ID y AUTH_GOOGLE_SECRET en Vercel.`,
      { status: 500 },
    );
  }

  // Devuelve el redirect a Google con las cookies PKCE/state para SFSafariViewController
  const headers = new Headers({ Location: location });

  // Copia todos los Set-Cookie del response (PKCE code_verifier, state, callback-url)
  try {
    for (const c of (response.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()) {
      headers.append("Set-Cookie", c);
    }
  } catch {
    const c = response.headers.get("set-cookie");
    if (c) headers.set("Set-Cookie", c);
  }

  return new Response(null, { status: 302, headers });
}
