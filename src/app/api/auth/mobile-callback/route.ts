/**
 * GET /api/auth/mobile-callback
 *
 * Auth.js redirige aquí tras un OAuth exitoso (callbackUrl en flujo iOS).
 *
 * La cookie de sesión está en el cookie store de Safari/SFSafariViewController,
 * NO en el WKWebView. Para transferirla al WKWebView:
 *
 * 1. Leemos la cookie de sesión del request entrante (viene de Safari).
 * 2. La empaquetamos en un token de intercambio encriptado con AUTH_SECRET.
 * 3. Redirigimos a iestudio://auth-callback?tok=<token> (2 min de validez).
 * 4. La app (appUrlOpen handler) navega WKWebView a /api/auth/mobile-exchange?tok=<token>.
 * 5. Ese endpoint desencripta, valida, y devuelve Set-Cookie al WKWebView.
 */
import { encode } from "@auth/core/jwt";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();

  // Recogemos todas las cookies de sesión de Auth.js (soporta chunking .0/.1/...)
  const sessionCookies: Record<string, string> = {};
  for (const cookie of cookieStore.getAll()) {
    if (
      cookie.name.includes("authjs.session-token") ||
      cookie.name.includes("authjs.callback-url")
    ) {
      sessionCookies[cookie.name] = cookie.value;
    }
  }

  const hasSession = Object.keys(sessionCookies).some((k) =>
    k.includes("session-token"),
  );

  if (!hasSession) {
    // OAuth completó pero no hay sesión — error o flujo web (no móvil)
    return new Response(
      `<!DOCTYPE html><html><body>
      <p>No se encontró sesión. <a href="/">Volver</a></p>
      <script>setTimeout(()=>window.location.replace('/'),2000)</script>
      </body></html>`,
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "";

  // Token de intercambio corto (2 min). Encriptado con la misma clave que Auth.js.
  const tok = await encode({
    token: { sessionCookies },
    secret,
    salt: "mobile-exchange-v1",
    maxAge: 120,
  });

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>IEStudio</title>
  <style>
    body{margin:0;font-family:system-ui;display:flex;align-items:center;
         justify-content:center;min-height:100dvh;background:#f9fafb}
    .c{text-align:center;padding:2rem}
  </style>
</head>
<body>
  <div class="c">
    <p style="font-size:2rem">✅</p>
    <p style="font-weight:600">Sesión iniciada</p>
    <p style="color:#6b7280;font-size:.875rem">Volviendo a IEStudio…</p>
  </div>
  <script>
    // Abre el esquema personalizado con el token de intercambio
    window.location.replace(
      'iestudio://auth-callback?tok=${encodeURIComponent(tok)}'
    );
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
