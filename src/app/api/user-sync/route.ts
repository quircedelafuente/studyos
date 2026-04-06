import { auth } from "@/auth";
import { getSql } from "@/lib/db";
import { MANUAL_COURSES_STORAGE_KEY } from "@/lib/manual-courses-storage";
import {
  normalizeCloudPayload,
  sanitizeEntriesForUpload,
  sanitizeJsonTextForPostgresJsonb,
} from "@/lib/user-cloud-storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Devuelve la clave estable del usuario: email normalizado.
 * NextAuth JWT sin DB adapter genera un sub diferente por sesión/navegador,
 * así que el email es la única identidad estable entre dispositivos.
 */
function stableUserKey(session: { user?: { email?: string | null; id?: string } }): string | null {
  const email = session.user?.email?.trim().toLowerCase();
  return email || null;
}

async function tryReadPayload(
  sql: ReturnType<typeof getSql> & object,
  userId: string,
): Promise<Record<string, string> | null> {
  try {
    const rows = await sql`SELECT payload FROM user_app_kv WHERE user_id = ${userId}`;
    const row = rows[0] as { payload: unknown } | undefined;
    if (!row) return null;
    return normalizeCloudPayload(row.payload ?? {});
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const isUnicode =
      detail.includes("unicode") || detail.includes("Unicode") || detail.includes("invalid byte sequence");
    if (!isUnicode) throw err;
    console.warn("[user-sync] Payload corrupto para", userId, "— reparando…");
    const textRows = await sql`SELECT payload::text AS raw FROM user_app_kv WHERE user_id = ${userId}`;
    const rawText = (textRows[0] as { raw?: string } | undefined)?.raw;
    if (!rawText) return null;
    // eslint-disable-next-line no-control-regex
    const cleaned = rawText.replace(
      /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
      "",
    );
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const entries = normalizeCloudPayload(parsed);
    const fixedText = sanitizeJsonTextForPostgresJsonb(JSON.stringify(entries));
    await sql`UPDATE user_app_kv SET payload = ${fixedText}::jsonb, updated_at = NOW() WHERE user_id = ${userId}`;
    return entries;
  }
}

export async function GET() {
  const sql = getSql();
  if (!sql) {
    return NextResponse.json({ disabled: true, entries: {} }, { status: 503 });
  }
  const session = await auth();
  const emailKey = stableUserKey(session as { user?: { email?: string | null; id?: string } });
  if (!emailKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const legacyId = session?.user?.id;

  try {
    const emailEntries = await tryReadPayload(sql, emailKey);
    let entries = emailEntries;

    if (legacyId && legacyId !== emailKey) {
      const legacy = await tryReadPayload(sql, legacyId);
      if (legacy && Object.keys(legacy).length > 0) {
        const emailCount = entries ? Object.keys(entries).length : 0;
        const legacyCount = Object.keys(legacy).length;
        if (legacyCount > emailCount) {
          console.log("[user-sync GET] Migrando datos de", legacyId, "→", emailKey, `(${legacyCount} > ${emailCount} keys)`);
          const payloadText = sanitizeJsonTextForPostgresJsonb(JSON.stringify(legacy));
          await sql`
            INSERT INTO user_app_kv (user_id, payload, updated_at)
            VALUES (${emailKey}, ${payloadText}::jsonb, NOW())
            ON CONFLICT (user_id) DO UPDATE SET payload = ${payloadText}::jsonb, updated_at = NOW()
          `;
          entries = legacy;
        }
        await sql`DELETE FROM user_app_kv WHERE user_id = ${legacyId}`.catch(() => {});
      }
    }

    return NextResponse.json({ entries: entries ?? {} });
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
  const emailKey = stableUserKey(session as { user?: { email?: string | null; id?: string } });
  if (!emailKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const legacyId = session?.user?.id;

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

  try {
    /**
     * Fusión con lo ya guardado: el móvil suele tener menos claves `iestudio-*` en
     * localStorage que el escritorio. El PUT anterior rechazaba la subida
     * (`skipped`) y el checklist del teléfono nunca llegaba a la nube.
     * Las claves del cliente sobrescriben las del servidor; el resto se conserva.
     */
    const existingEntries = (await tryReadPayload(sql, emailKey)) ?? {};
    const merged = sanitizeEntriesForUpload({
      ...existingEntries,
      ...sanitized,
    });
    delete merged[MANUAL_COURSES_STORAGE_KEY];

    let payloadText = JSON.stringify(merged);
    // eslint-disable-next-line no-control-regex
    payloadText = payloadText.replace(
      /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
      "",
    );
    payloadText = sanitizeJsonTextForPostgresJsonb(payloadText);

    await sql`
      INSERT INTO user_app_kv (user_id, payload, updated_at)
      VALUES (${emailKey}, ${payloadText}::jsonb, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        payload = ${payloadText}::jsonb,
        updated_at = NOW()
    `;
    if (legacyId && legacyId !== emailKey) {
      await sql`DELETE FROM user_app_kv WHERE user_id = ${legacyId}`.catch(() => {});
    }
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
