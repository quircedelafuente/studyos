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

/**
 * Claves cuyo valor es un array de append-only (nunca se borran items individualmente).
 * Solo estas reciben merge por unión — el resto usa "client wins" para respetar borrados.
 */
const ARRAY_UNION_MERGE_KEYS = new Set([
  "iestudio-study-arena-completed",
  "iestudio-study-arena-completed-deleted",
]);

/**
 * Claves donde gana la versión con `_updatedAt` más reciente (last-write-wins).
 * Evita que un dispositivo sin sesión activa sobreescriba la sesión de otro.
 */
const NEWEST_WINS_KEYS = new Set([
  "iestudio-study-arena-state",
]);

/**
 * Extrae un ID estable de un elemento de array, buscando los campos más comunes.
 * Devuelve null si el item no es un objeto con id reconocible.
 */
function itemId(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  if (typeof o.completionId === "string") return o.completionId;
  if (typeof o.id === "string") return o.id;
  if (typeof o.completedAt === "string" && typeof o.key === "string")
    return `${o.key}:${o.completedAt}`;
  return null;
}

/**
 * Fusiona dos valores JSON (strings) de la misma clave:
 * - Si la clave es append-only y ambos son arrays: unión por ID (incoming primero).
 * - Para el resto: gana incoming (client wins), respetando borrados explícitos.
 */
function mergeEntryValue(key: string, existingStr: string, incomingStr: string): string {
  if (NEWEST_WINS_KEYS.has(key)) {
    try {
      const existing = JSON.parse(existingStr) as Record<string, unknown>;
      const incoming = JSON.parse(incomingStr) as Record<string, unknown>;
      const existingTs = typeof existing._updatedAt === "number" ? existing._updatedAt : 0;
      const incomingTs = typeof incoming._updatedAt === "number" ? incoming._updatedAt : 0;
      return incomingTs >= existingTs ? incomingStr : existingStr;
    } catch {
      // no parseable → incoming gana
    }
    return incomingStr;
  }
  if (!ARRAY_UNION_MERGE_KEYS.has(key)) return incomingStr;
  try {
    const existing = JSON.parse(existingStr) as unknown;
    const incoming = JSON.parse(incomingStr) as unknown;
    if (Array.isArray(existing) && Array.isArray(incoming)) {
      // Arrays de strings (p.ej. tombstones): unión directa por valor
      if (typeof (incoming as unknown[])[0] === "string" || typeof (existing as unknown[])[0] === "string") {
        const merged = new Set<string>([
          ...(existing as unknown[]).filter((x): x is string => typeof x === "string"),
          ...(incoming as unknown[]).filter((x): x is string => typeof x === "string"),
        ]);
        return JSON.stringify([...merged]);
      }
      // Arrays de objetos: unión por ID
      const incomingIds = new Set<string>();
      for (const item of incoming) {
        const id = itemId(item);
        if (id) incomingIds.add(id);
      }
      const onlyInExisting = (existing as unknown[]).filter((item) => {
        const id = itemId(item);
        return id ? !incomingIds.has(id) : false;
      });
      return JSON.stringify([...(incoming as unknown[]), ...onlyInExisting]);
    }
  } catch {
    // no es JSON parseable → incoming gana
  }
  return incomingStr;
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
     * Fusión con lo ya guardado.
     * Para claves que contienen arrays JSON (p.ej. sesiones completadas, hábitos-log),
     * hacemos union por id en lugar de sobreescribir — así dos dispositivos distintos
     * nunca se borran datos mutuamente.  Para el resto de claves gana el cliente.
     */
    const existingEntries = (await tryReadPayload(sql, emailKey)) ?? {};
    const base: Record<string, string> = { ...existingEntries };
    for (const [k, v] of Object.entries(sanitized)) {
      if (k in base) {
        base[k] = mergeEntryValue(k, base[k], v);
      } else {
        base[k] = v;
      }
    }
    const merged = sanitizeEntriesForUpload(base);
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
