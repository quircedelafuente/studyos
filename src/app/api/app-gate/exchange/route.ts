import { NextResponse } from "next/server";
import {
  appGateSecret,
  normalizePathWithQuery,
  verifyAppGateHeaders,
} from "@/lib/app-gate";
import { APP_GATE_COOKIE_NAME } from "@/lib/app-gate-shared";

export const runtime = "nodejs";

/**
 * App Gate exchange:
 * La app nativa hace un POST con headers HMAC.
 * Si son válidos, devolvemos 204 y dejamos una cookie httpOnly para que el WebView
 * pueda cargar la app sin añadir headers en cada navegación.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const secret = appGateSecret();

  const appId = request.headers.get("x-app-id");
  const ts = request.headers.get("x-app-ts");
  const sig = request.headers.get("x-app-sig");

  const check = verifyAppGateHeaders({
    secret,
    appId,
    ts,
    sig,
    pathWithQuery: normalizePathWithQuery(url),
  });

  if (!check.ok) {
    return NextResponse.json(
      { error: "unauthorized", reason: check.reason },
      { status: 401 },
    );
  }

  const res = new NextResponse(null, { status: 204 });
  // __Host- => Secure + Path=/ y sin Domain
  res.cookies.set({
    name: APP_GATE_COOKIE_NAME,
    value: "1",
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 días
  });
  return res;
}

