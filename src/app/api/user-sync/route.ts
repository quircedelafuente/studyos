import { auth } from "@/auth";
import { getSql } from "@/lib/db";
import { MANUAL_COURSES_STORAGE_KEY } from "@/lib/manual-courses-storage";
import {
  normalizeCloudPayload,
  sanitizeEntriesForUpload,
} from "@/lib/user-cloud-storage";
import { NextResponse } from "next/server";

function formatPgTimestamptz(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string" && v.length > 0) return v;
  if (typeof v === "number" && Number.isFinite(v)) {
    return new Date(v).toISOString();
  }
  return null;
}

export async function GET() {
  const sql = getSql();
  if (!sql) {
    return NextResponse.json({ disabled: true, entries: {} }, { status: 503 });
  }
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await sql`
    SELECT payload, updated_at FROM user_app_kv WHERE user_id = ${session.user.id}
  `;
  const row = rows[0] as
    | { payload: unknown; updated_at: unknown }
    | undefined;
  const entries = normalizeCloudPayload(row?.payload ?? {});
  const updatedAt = formatPgTimestamptz(row?.updated_at);
  return NextResponse.json({ entries, updatedAt });
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
  const raw = body as { entries?: unknown; merge?: unknown };
  if (!raw.entries || typeof raw.entries !== "object" || raw.entries === null) {
    return NextResponse.json({ error: "Missing entries" }, { status: 400 });
  }
  const merge = raw.merge === true;
  const sanitized = sanitizeEntriesForUpload(
    raw.entries as Record<string, unknown>,
  );
  delete sanitized[MANUAL_COURSES_STORAGE_KEY];

  let merged: Record<string, string> = sanitized;
  if (merge) {
    const prevRows = await sql`
      SELECT payload FROM user_app_kv WHERE user_id = ${session.user.id}
    `;
    const prevRow = prevRows[0] as { payload?: unknown } | undefined;
    const prev = normalizeCloudPayload(prevRow?.payload ?? {});
    merged = { ...prev, ...sanitized };
  }

  const json = JSON.stringify(merged);
  const out = await sql`
    INSERT INTO user_app_kv (user_id, payload, updated_at)
    VALUES (${session.user.id}, ${json}::jsonb, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      payload = EXCLUDED.payload,
      updated_at = NOW()
    RETURNING updated_at
  `;
  const row = out[0] as { updated_at: unknown } | undefined;
  const updatedAt =
    formatPgTimestamptz(row?.updated_at) ?? new Date().toISOString();
  return NextResponse.json({ ok: true, updatedAt });
}
