import { NextResponse } from "next/server";

/**
 * Muestra la URI de redirección OAuth que debe coincidir en Google Cloud.
 * Abre en el navegador la misma URL donde falla el login + esta ruta:
 *   https://tu-dominio.vercel.app/api/debug/oauth-callback
 *   http://localhost:3000/api/debug/oauth-callback
 */
export async function GET(request: Request) {
  const authUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;

  let redirectUri: string;
  let source: string;

  if (authUrl) {
    try {
      const u = new URL(authUrl);
      redirectUri = `${u.origin}/api/auth/callback/google`;
      source = "Variable de entorno AUTH_URL o NEXTAUTH_URL";
    } catch {
      return NextResponse.json(
        {
          error:
            "AUTH_URL / NEXTAUTH_URL no es una URL válida. Ejemplo: https://mi-app.vercel.app",
        },
        { status: 500 },
      );
    }
  } else {
    const host =
      request.headers.get("x-forwarded-host") ??
      request.headers.get("host") ??
      "localhost:3000";
    const xfProto = request.headers.get("x-forwarded-proto");
    const proto =
      xfProto?.split(",")[0]?.trim() ??
      (host.startsWith("localhost") ||
      host.startsWith("127.0.0.1") ||
      host.startsWith("[::1]")
        ? "http"
        : "https");
    redirectUri = `${proto}://${host}/api/auth/callback/google`;
    source =
      "Inferida desde esta petición (no hay AUTH_URL). En producción define AUTH_URL.";
  }

  return NextResponse.json({
    redirectUri,
    source,
    steps: [
      "Google Cloud → APIs y servicios → Credenciales → cliente OAuth (Aplicación web).",
      "«URIs de redirección autorizadas»: añade EXACTAMENTE el valor de redirectUri (mismo protocolo, host y puerto).",
      "«Orígenes JavaScript»: solo el origen, p. ej. https://tu-app.vercel.app (sin /api/...).",
      "En Vercel: Environment Variables → AUTH_URL = https://tu-proyecto.vercel.app (sin barra final).",
      "Si `npm run dev` usa el puerto 3001, registra http://localhost:3001/api/auth/callback/google.",
      "127.0.0.1 y localhost son distintos para Google: registra el que uses en la barra del navegador.",
    ],
  });
}
