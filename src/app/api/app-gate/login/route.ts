import crypto from "crypto";
import { NextResponse } from "next/server";
import { APP_GATE_COOKIE_NAME } from "@/lib/app-gate-shared";

export const runtime = "nodejs";

function envOrEmpty(name: string): string {
  return (process.env[name] ?? "").trim();
}

function timingSafeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export async function POST(request: Request) {
  const gatePassword = envOrEmpty("APP_GATE_PASSWORD");
  if (!gatePassword) {
    return NextResponse.json(
      {
        error: "misconfigured",
        detail: "Falta APP_GATE_PASSWORD en el entorno (Vercel).",
      },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const pw = (body as { password?: unknown })?.password;
  if (typeof pw !== "string" || !pw.trim()) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // Comparación constante para evitar leaks por timing
  if (!timingSafeEq(pw.trim(), gatePassword)) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Código incorrecto." },
      { status: 401 },
    );
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: APP_GATE_COOKIE_NAME,
    value: "1",
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 90, // 90 días
  });
  return res;
}

