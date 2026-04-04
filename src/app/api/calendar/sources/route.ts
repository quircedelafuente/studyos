import { listCalendarSources } from "@/lib/google-calendar-api";
import { getGoogleCalendarAccessToken } from "@/lib/calendar-route-auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await getGoogleCalendarAccessToken(req);
  if ("error" in auth) return auth.error;
  const { accessToken } = auth;

  try {
    const calendars = await listCalendarSources(accessToken);
    return Response.json({ calendars });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error al listar calendarios";
    return Response.json(
      { error: "Error de Google Calendar", detail: message },
      { status: 502 },
    );
  }
}
