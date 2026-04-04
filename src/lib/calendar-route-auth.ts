import { headers } from "next/headers";
import { getToken, type JWT } from "@auth/core/jwt";

/**
 * Auth.js usa `authjs.session-token` en http y `__Secure-authjs.session-token` en https.
 * `getToken` con `secureCookie` por defecto en false no encuentra la cookie en producción.
 */
function inferSecureCookieFromEnv(): boolean {
  const raw = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "";
  if (!raw.trim()) return false;
  try {
    return new URL(raw).protocol === "https:";
  } catch {
    return false;
  }
}

async function readJwtWithSessionCookie(
  req: Request,
  secret: string,
): Promise<JWT | null> {
  let cookieHeader = "";
  try {
    const h = await headers();
    cookieHeader = h.get("cookie")?.trim() ?? "";
  } catch {
    /* fuera del contexto de petición de Next */
  }
  if (!cookieHeader) {
    cookieHeader = req.headers.get("cookie")?.trim() ?? "";
  }
  if (!cookieHeader) {
    return null;
  }

  const innerReq = new Request(req.url, {
    headers: { cookie: cookieHeader },
  });

  const preferred = inferSecureCookieFromEnv();
  const trySecure = preferred ? [true, false] : [false, true];

  for (const secureCookie of trySecure) {
    const token = await getToken({ req: innerReq, secret, secureCookie });
    if (token?.access_token) {
      return token;
    }
  }

  for (const secureCookie of trySecure) {
    const token = await getToken({ req, secret, secureCookie });
    if (token?.access_token) {
      return token;
    }
  }

  return null;
}

/**
 * Obtiene el access token de Google para Calendar en rutas API.
 */
export async function getGoogleCalendarAccessToken(
  req: Request,
): Promise<
  { accessToken: string } | { error: Response }
> {
  const secret =
    process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret?.trim()) {
    return {
      error: Response.json(
        {
          error: "Configuración del servidor",
          detail:
            "Define AUTH_SECRET (o NEXTAUTH_SECRET) en .env.local para descifrar la sesión.",
        },
        { status: 500 },
      ),
    };
  }

  const token = await readJwtWithSessionCookie(req, secret);

  const accessToken = token?.access_token as string | undefined;
  if (!accessToken) {
    return {
      error: Response.json(
        {
          error: "No autenticado",
          detail:
            "No hay token de Google en la sesión. Cierra sesión y vuelve a entrar con Google.",
        },
        { status: 401 },
      ),
    };
  }
  if (token?.error === "RefreshAccessTokenError") {
    return {
      error: Response.json(
        {
          error: "Sesión expirada",
          detail: "Vuelve a iniciar sesión con Google.",
        },
        { status: 401 },
      ),
    };
  }
  return { accessToken };
}
