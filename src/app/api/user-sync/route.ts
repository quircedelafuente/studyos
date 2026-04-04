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

    const isUnicode =
      detail.includes("unicode") ||
      detail.includes("Unicode") ||
      detail.includes("invalid byte sequence");

    if (isUnicode) {
      console.warn(
        "[user-sync GET] Dato corrupto en Neon; intentando leer como texto y limpiar…",
      );
      try {
        const textRows = await sql`
          SELECT payload::text AS raw FROM user_app_kv WHERE user_id = ${session.user.id}
        `;
        const rawText = (textRows[0] as { raw?: string } | undefined)?.raw;
        if (rawText) {
          // eslint-disable-next-line no-control-regex
          const cleaned = rawText.replace(
            /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
            "",
          );
          const parsed = JSON.parse(cleaned) as Record<string, unknown>;
          const entries = normalizeCloudPayload(parsed);

          await sql`
            UPDATE user_app_kv SET payload = ${cleaned}::jsonb, updated_at = NOW()
            WHERE user_id = ${session.user.id}
          `;
          console.log("[user-sync GET] Dato reparado en Neon.");
          return NextResponse.json({ entries });
        }
      } catch (repairErr) {
        console.error("[user-sync GET] Reparación fallida:", repairErr);
      }
    }

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
   * Serializar a texto JSON nosotros y pasar como string con cast ::jsonb.
   * Esto evita que el driver intente serialización propia que puede romper
   * con secuencias unicode problemáticas.
   */
  let payloadText: string;
  try {
    payloadText = JSON.stringify(sanitized);
    // Quitar NUL y surrogates sueltos que hayan quedado en la cadena JSON
    // eslint-disable-next-line no-control-regex
    payloadText = payloadText.replace(
      /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
      "",
    );
  } catch {
    return NextResponse.json(
      { error: "No se pudo serializar el payload" },
      { status: 400 },
    );
  }

  try {
    await sql`
      INSERT INTO user_app_kv (user_id, payload, updated_at)
      VALUES (${session.user.id}, ${payloadText}::jsonb, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        payload = ${payloadText}::jsonb,
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
