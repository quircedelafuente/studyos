import type {
  GoogleCalendarEventItem,
  GoogleCalendarEventsResponse,
  GoogleCalendarListApiResponse,
} from "@/lib/google-calendar-types";
import { parseGoogleDateTimeToJsDate } from "@/lib/google-event-datetime";

export type CalendarSource = {
  id: string;
  summary: string;
  primary?: boolean;
  backgroundColor?: string;
  /** Quién puede escribir: solo owner/writer permiten crear eventos. */
  accessRole?: string;
};

function authHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

/** Todos los calendarios visibles en “Mi calendario” (lista de Google). */
export async function listCalendarSources(
  accessToken: string,
): Promise<CalendarSource[]> {
  const out: CalendarSource[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList",
    );
    url.searchParams.set("maxResults", "250");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString(), {
      headers: authHeaders(accessToken),
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    const data = (await res.json()) as GoogleCalendarListApiResponse;
    for (const item of data.items ?? []) {
      out.push({
        id: item.id,
        summary: item.summary?.trim() || item.id,
        primary: item.primary === true,
        backgroundColor: item.backgroundColor,
        accessRole: item.accessRole,
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return out;
}

async function fetchEventsPage(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
  pageToken?: string,
): Promise<GoogleCalendarEventsResponse> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  if (pageToken) params.set("pageToken", pageToken);

  const pathId = encodeURIComponent(calendarId);
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${pathId}/events?${params}`,
    { headers: authHeaders(accessToken), next: { revalidate: 0 } },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${calendarId}: ${text}`);
  }
  return res.json() as Promise<GoogleCalendarEventsResponse>;
}

/** Eventos de un calendario en el rango, con paginación. */
export async function fetchAllEventsForCalendar(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
): Promise<GoogleCalendarEventItem[]> {
  const items: GoogleCalendarEventItem[] = [];
  let pageToken: string | undefined;
  do {
    const page = await fetchEventsPage(
      accessToken,
      calendarId,
      timeMin,
      timeMax,
      pageToken,
    );
    items.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return items;
}

function eventSortKey(ev: GoogleCalendarEventItem): number {
  if (ev.start?.dateTime) {
    const d = parseGoogleDateTimeToJsDate(
      ev.start.dateTime,
      ev.start.timeZone,
    );
    return d?.getTime() ?? 0;
  }
  const s = ev.start?.date;
  if (!s) return 0;
  return new Date(`${s}T12:00:00`).getTime();
}

/** Une eventos de varios calendarios y ordena por inicio. */
export async function fetchMergedCalendarEvents(
  accessToken: string,
  timeMin: string,
  timeMax: string,
  calendarIds: string[],
): Promise<GoogleCalendarEventItem[]> {
  if (calendarIds.length === 0) return [];

  const results = await Promise.allSettled(
    calendarIds.map((calId) =>
      fetchAllEventsForCalendar(accessToken, calId, timeMin, timeMax).then(
        (items) =>
          items.map((ev) => ({
            ...ev,
            calendarId: calId,
          })),
      ),
    ),
  );

  const merged: GoogleCalendarEventItem[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") merged.push(...r.value);
  }

  const seen = new Set<string>();
  const deduped: GoogleCalendarEventItem[] = [];
  for (const ev of merged) {
    const key = `${ev.calendarId ?? ""}-${ev.id ?? ""}-${ev.start?.dateTime ?? ev.start?.date ?? ""}-${ev.summary ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(ev);
  }

  deduped.sort((a, b) => eventSortKey(a) - eventSortKey(b));
  return deduped;
}

/**
 * `requested === null`: sin filtro en la URL → todos los calendarios de la lista.
 * `requested` array (vacío o no): solo esos IDs.
 */
export async function resolveCalendarIds(
  accessToken: string,
  requested: string[] | null,
): Promise<string[]> {
  if (requested !== null) return requested;
  const sources = await listCalendarSources(accessToken);
  return sources.map((s) => s.id);
}

export type InsertCalendarEventInput = {
  summary: string;
  description?: string;
  location?: string;
  /** Paleta Google Calendar: "1"…"11". */
  colorId?: string;
  /**
   * RFC3339 con offset explícito (p. ej. `2025-03-28T18:00:00+02:00`).
   * Evita desfases de 1 h frente a `datetime-local` frente a la pareja dateTime+timeZone de Google.
   */
  startDateTime: string;
  endDateTime: string;
};

function parseGoogleCalendarErrorBody(text: string): string {
  const trimmed = text.trim();
  try {
    const j = JSON.parse(trimmed) as {
      error?: {
        message?: string;
        errors?: Array<{ reason?: string; message?: string }>;
      };
    };
    const first = j.error?.errors?.[0];
    return (
      first?.message ??
      first?.reason ??
      j.error?.message ??
      trimmed.slice(0, 280)
    );
  } catch {
    return trimmed.slice(0, 280) || `HTTP error`;
  }
}

/** Crea un evento; inicio/fin en RFC3339 con offset (instante inequívoco para Google). */
export async function insertCalendarEvent(
  accessToken: string,
  calendarId: string,
  input: InsertCalendarEventInput,
): Promise<GoogleCalendarEventItem> {
  const pathId = encodeURIComponent(calendarId);
  const startDt = input.startDateTime.trim();
  const endDt = input.endDateTime.trim();
  const startMs = Date.parse(startDt);
  const endMs = Date.parse(endDt);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    throw new Error("Fecha u hora de evento no válida");
  }
  if (endMs <= startMs) {
    throw new Error("La hora de fin debe ser posterior al inicio");
  }

  const body = {
    summary: input.summary.trim(),
    ...(input.description?.trim()
      ? { description: input.description.trim() }
      : {}),
    ...(input.location?.trim() ? { location: input.location.trim() } : {}),
    ...(input.colorId && /^([1-9]|1[01])$/.test(input.colorId)
      ? { colorId: input.colorId }
      : {}),
    start: { dateTime: startDt },
    end: { dateTime: endDt },
  };

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${pathId}/events`,
    {
      method: "POST",
      headers: {
        ...authHeaders(accessToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(parseGoogleCalendarErrorBody(text) || `HTTP ${res.status}`);
  }
  return res.json() as Promise<GoogleCalendarEventItem>;
}

export async function deleteCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const cal = encodeURIComponent(calendarId);
  const ev = encodeURIComponent(eventId);
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${cal}/events/${ev}`,
    {
      method: "DELETE",
      headers: authHeaders(accessToken),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(parseGoogleCalendarErrorBody(text) || `HTTP ${res.status}`);
  }
}
