import {
  deleteCalendarEvent,
  fetchMergedCalendarEvents,
  insertCalendarEvent,
  resolveCalendarIds,
} from "@/lib/google-calendar-api";
import { getGoogleCalendarAccessToken } from "@/lib/calendar-route-auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await getGoogleCalendarAccessToken(req);
  if ("error" in auth) return auth.error;
  const { accessToken } = auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Cuerpo JSON inválido" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return Response.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const RFC3339_WITH_OFFSET =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;

  const o = body as Record<string, unknown>;
  const summary = typeof o.summary === "string" ? o.summary.trim() : "";
  const startDateTime =
    typeof o.startDateTime === "string" ? o.startDateTime.trim() : "";
  const endDateTime =
    typeof o.endDateTime === "string" ? o.endDateTime.trim() : "";
  const calendarId =
    typeof o.calendarId === "string" && o.calendarId.trim()
      ? o.calendarId.trim()
      : "primary";
  const description =
    typeof o.description === "string" ? o.description.trim() : "";
  const location = typeof o.location === "string" ? o.location.trim() : "";
  const colorIdRaw = typeof o.colorId === "string" ? o.colorId.trim() : "";
  const colorId =
    colorIdRaw && /^([1-9]|1[01])$/.test(colorIdRaw) ? colorIdRaw : undefined;

  if (!summary) {
    return Response.json({ error: "El título es obligatorio" }, { status: 400 });
  }
  if (!startDateTime || !endDateTime) {
    return Response.json(
      { error: "Indica inicio y fin del evento" },
      { status: 400 },
    );
  }
  if (
    !RFC3339_WITH_OFFSET.test(startDateTime) ||
    !RFC3339_WITH_OFFSET.test(endDateTime)
  ) {
    return Response.json(
      { error: "Formato de fecha/hora inválido (se espera RFC3339 con offset ±HH:MM)" },
      { status: 400 },
    );
  }

  const startMs = Date.parse(startDateTime);
  const endMs = Date.parse(endDateTime);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return Response.json(
      { error: "Las fechas enviadas no son válidas" },
      { status: 400 },
    );
  }
  if (endMs <= startMs) {
    return Response.json(
      { error: "La hora de fin debe ser posterior al inicio" },
      { status: 400 },
    );
  }

  try {
    const event = await insertCalendarEvent(accessToken, calendarId, {
      summary,
      description: description || undefined,
      location: location || undefined,
      colorId,
      startDateTime,
      endDateTime,
    });
    return Response.json({ event });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error al crear el evento";
    return Response.json(
      { error: "Error de Google Calendar", detail: message },
      { status: 502 },
    );
  }
}

export async function DELETE(req: Request) {
  const auth = await getGoogleCalendarAccessToken(req);
  if ("error" in auth) return auth.error;
  const { accessToken } = auth;

  const { searchParams } = new URL(req.url);
  const calendarId = searchParams.get("calendarId")?.trim();
  const eventId = searchParams.get("eventId")?.trim();
  if (!calendarId || !eventId) {
    return Response.json(
      { error: "Indica calendarId y eventId" },
      { status: 400 },
    );
  }

  try {
    await deleteCalendarEvent(accessToken, calendarId, eventId);
    return Response.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error al eliminar el evento";
    return Response.json(
      { error: "Error de Google Calendar", detail: message },
      { status: 502 },
    );
  }
}

export async function GET(req: Request) {
  const auth = await getGoogleCalendarAccessToken(req);
  if ("error" in auth) return auth.error;
  const { accessToken } = auth;

  const { searchParams } = new URL(req.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  let timeMin: string;
  let timeMax: string;

  if (fromParam && toParam) {
    const fromD = new Date(fromParam);
    const toD = new Date(toParam);
    if (
      Number.isNaN(fromD.getTime()) ||
      Number.isNaN(toD.getTime()) ||
      fromD.getTime() > toD.getTime()
    ) {
      return Response.json(
        { error: "Parámetros from y to inválidos" },
        { status: 400 },
      );
    }
    timeMin = fromD.toISOString();
    timeMax = toD.toISOString();
  } else {
    const year = Number(searchParams.get("year"));
    const month = Number(searchParams.get("month"));
    if (
      !Number.isFinite(year) ||
      !Number.isFinite(month) ||
      month < 1 ||
      month > 12
    ) {
      return Response.json(
        { error: "Indica year y month, o from y to (ISO)" },
        { status: 400 },
      );
    }
    const monthIndex = month - 1;
    timeMin = new Date(year, monthIndex, 1, 0, 0, 0, 0).toISOString();
    timeMax = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999).toISOString();
  }

  const hasCalParam = searchParams.has("cal");
  const calParams = searchParams.getAll("cal");
  const requestedIds: string[] | null = hasCalParam
    ? calParams.map((id) => id.trim()).filter(Boolean)
    : null;

  try {
    const calendarIds = await resolveCalendarIds(accessToken, requestedIds);
    const events = await fetchMergedCalendarEvents(
      accessToken,
      timeMin,
      timeMax,
      calendarIds,
    );
    return Response.json({ events });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error al leer calendarios";
    return Response.json(
      { error: "Error de Google Calendar", detail: message },
      { status: 502 },
    );
  }
}
