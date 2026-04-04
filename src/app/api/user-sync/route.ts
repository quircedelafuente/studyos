import { auth } from "@/auth";
import { getSql } from "@/lib/db";
import { MANUAL_COURSES_STORAGE_KEY } from "@/lib/manual-courses-storage";
import {
  normalizeCloudPayload,
  sanitizeEntriesForUpload,
} from "@/lib/user-cloud-storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const sql = getSql();
  if (!sql) {
    return NextResponse.json({ disabled: true, entries: {} }, { status: 503 });
  }
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const rows = await sql`
      SELECT payload FROM user_app_kv WHERE user_id = ${session.user.id}
    `;
    const row = rows[0] as { payload: unknown } | undefined;
    const entries = normalizeCloudPayload(row?.payload ?? {});
    return NextResponse.json({ entries });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[user-sync GET]", detail);
    return NextResponse.json(
      { error: "Error al leer la nube", detail: detail.slice(0, 500) },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  const sql = getSql();
  if (!sql) {
    return NextResponse.json({ disabled: true }, { status: 503 });
  }
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const raw = body as { entries?: unknown };
  if (!raw.entries || typeof raw.entries !== "object" || raw.entries === null) {
    return NextResponse.json({ error: "Missing entries" }, { status: 400 });
  }
  const sanitized = sanitizeEntriesForUpload(
    raw.entries as Record<string, string>,
  );
  delete sanitized[MANUAL_COURSES_STORAGE_KEY];

  /**
   * El driver @neondatabase/serverless serializa objetos a JSON/JSONB.
   * Usar `${string}::jsonb` en el template a veces provoca errores en runtime.
   */
  const payloadJson = sanitized as unknown as Record<string, string>;

  try {
    await sql`
      INSERT INTO user_app_kv (user_id, payload, updated_at)
      VALUES (${session.user.id}, ${payloadJson}, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        payload = EXCLUDED.payload,
        updated_at = NOW()
    `;
    return NextResponse.json({ ok: true });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[user-sync PUT]", detail);
    return NextResponse.json(
      { error: "Error al guardar en la nube", detail: detail.slice(0, 500) },
      { status: 500 },
    );
  }
}
