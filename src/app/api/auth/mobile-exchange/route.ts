/**
 * GET /api/auth/mobile-exchange?tok=<encryptedToken>
 *
 * El WKWebView navega a este endpoint después de recibir iestudio://auth-callback.
 * Desencripta el token de intercambio (2 min de validez), extrae las cookies de
 * sesión y las establece vía Set-Cookie en el contexto del WKWebView.
 * Luego redirige a / para que la sesión quede activa.
 */
import { decode } from "@auth/core/jwt";
import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const tok = req.nextUrl.searchParams.get("tok");

  if (!tok) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "";

  try {
    const payload = await decode({
      token: tok,
      secret,
      salt: "mobile-exchange-v1",
    });

    if (!payload?.sessionCookies) {
      return NextResponse.redirect(new URL("/", req.url));
    }

    const sessionCookies = payload.sessionCookies as Record<string, string>;

    // Redirigir a / y establecer las cookies de sesión en el WKWebView
    const res = NextResponse.redirect(new URL("/", req.url));

    const isSecure =
      req.url.startsWith("https://") ||
      process.env.NODE_ENV === "production";

    for (const [name, value] of Object.entries(sessionCookies)) {
      // Solo transferimos session-token (no callback-url que no es necesaria)
      if (!name.includes("session-token")) continue;

      res.headers.append(
        "Set-Cookie",
        [
          `${name}=${value}`,
          "Path=/",
          "HttpOnly",
          "SameSite=Lax",
          isSecure ? "Secure" : "",
          "Max-Age=2592000",
        ]
          .filter(Boolean)
          .join("; "),
      );
    }

    return res;
  } catch {
    // Token inválido o expirado
    return NextResponse.redirect(new URL("/", req.url));
  }
}
