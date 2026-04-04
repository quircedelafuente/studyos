/** Fragmento de la respuesta de Calendar API v3. */
export type GoogleCalendarEventItem = {
  id?: string;
  /** Rellenado al fusionar varios calendarios (necesario para borrar en el calendario correcto). */
  calendarId?: string;
  summary?: string;
  /** Color del evento en la paleta de Google ("1"…"11"). */
  colorId?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
};

export type GoogleCalendarEventsResponse = {
  items?: GoogleCalendarEventItem[];
  nextPageToken?: string;
};

/** Entrada de calendarList (lista de calendarios de la cuenta). */
export type GoogleCalendarListEntry = {
  id: string;
  summary?: string;
  primary?: boolean;
  backgroundColor?: string;
  accessRole?: string;
  hidden?: boolean;
};

export type GoogleCalendarListApiResponse = {
  items?: GoogleCalendarListEntry[];
  nextPageToken?: string;
};
