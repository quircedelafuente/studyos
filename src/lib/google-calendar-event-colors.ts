/**
 * Colores de evento de Google Calendar API (`colorId` "1"…"11").
 * @see https://developers.google.com/calendar/api/v3/reference/events
 */

export const GOOGLE_CALENDAR_EVENT_COLOR_IDS = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
] as const;

export type GoogleCalendarEventColorId =
  (typeof GOOGLE_CALENDAR_EVENT_COLOR_IDS)[number];

/**
 * Color propio de la app, fuera de la paleta de Google.
 *
 * La API de Google solo acepta `colorId` "1"…"11" y nuestro validador descarta
 * cualquier otro, así que este id **solo vale para eventos locales**
 * («Exámenes y fechas»). Si se ofreciera al crear un evento de Google, se
 * perdería en silencio al guardar.
 */
export const LOCAL_ONLY_COLOR_ID = "12";

/** Colores seleccionables para deadlines locales: los de Google + el propio. */
export const LOCAL_DEADLINE_COLOR_IDS = [
  ...GOOGLE_CALENDAR_EVENT_COLOR_IDS,
  LOCAL_ONLY_COLOR_ID,
] as const;

export type GoogleEventColorStyle = {
  /** Fondo suave del bloque */
  bg: string;
  /** Borde general */
  border: string;
  /** Borde izquierdo / acento */
  borderLeft: string;
  /** Texto principal */
  text: string;
  /** Hora secundaria */
  textMuted: string;
};

/** Valores cercanos a la UI de Google Calendar. */
const PALETTE: Record<string, GoogleEventColorStyle> = {
  "1": {
    bg: "#e8f0fe",
    border: "rgba(26, 115, 232, 0.35)",
    borderLeft: "#1a73e8",
    text: "#174ea6",
    textMuted: "#1967d2",
  },
  "2": {
    bg: "#e6f4ea",
    border: "rgba(52, 168, 83, 0.35)",
    borderLeft: "#0f9d58",
    text: "#137333",
    textMuted: "#188038",
  },
  "3": {
    bg: "#f3e8fd",
    border: "rgba(142, 68, 173, 0.35)",
    borderLeft: "#a142f4",
    text: "#6a1b9a",
    textMuted: "#8430ce",
  },
  "4": {
    bg: "#fce8e6",
    border: "rgba(234, 67, 53, 0.35)",
    borderLeft: "#ea4335",
    text: "#c5221f",
    textMuted: "#d93025",
  },
  "5": {
    bg: "#fef7e0",
    border: "rgba(251, 188, 4, 0.45)",
    borderLeft: "#f9ab00",
    text: "#b06000",
    textMuted: "#e37400",
  },
  "6": {
    bg: "#fff3e0",
    border: "rgba(245, 124, 0, 0.4)",
    borderLeft: "#f4511e",
    text: "#b53d00",
    textMuted: "#e65100",
  },
  "7": {
    bg: "#e0f7fa",
    border: "rgba(0, 151, 167, 0.35)",
    borderLeft: "#00838f",
    text: "#006064",
    textMuted: "#00838f",
  },
  "8": {
    bg: "#f1f3f4",
    border: "rgba(95, 99, 104, 0.35)",
    borderLeft: "#5f6368",
    text: "#3c4043",
    textMuted: "#5f6368",
  },
  "9": {
    bg: "#e8f0fe",
    border: "rgba(66, 133, 244, 0.4)",
    borderLeft: "#4285f4",
    text: "#185abc",
    textMuted: "#1a73e8",
  },
  "10": {
    bg: "#e6f4ea",
    border: "rgba(52, 168, 83, 0.4)",
    borderLeft: "#34a853",
    text: "#0d652d",
    textMuted: "#188038",
  },
  "11": {
    bg: "#fce8e6",
    border: "rgba(219, 68, 55, 0.4)",
    borderLeft: "#db4437",
    text: "#a50e0e",
    textMuted: "#c5221f",
  },
  /**
   * Marrón — color propio, no existe en la paleta de Google. Elegido porque es
   * el único tono que no se confunde con ninguno de los once anteriores: los
   * huecos que quedaban (coral, azul y verde) chocaban con el rojo, el azul
   * intenso y el verde bosque ya en uso.
   */
  "12": {
    bg: "#efebe9",
    border: "rgba(121, 85, 72, 0.4)",
    borderLeft: "#795548",
    text: "#4e342e",
    textMuted: "#6d4c41",
  },
};

const DEFAULT_ID = "6";

export function normalizeGoogleEventColorId(
  id: string | undefined | null,
): string {
  if (!id) return DEFAULT_ID;
  const t = String(id).trim();
  return PALETTE[t] ? t : DEFAULT_ID;
}

export function getGoogleEventColorStyle(
  colorId: string | undefined | null,
): GoogleEventColorStyle {
  return PALETTE[normalizeGoogleEventColorId(colorId)] ?? PALETTE[DEFAULT_ID]!;
}

export const GOOGLE_EVENT_COLOR_LABELS: Record<string, string> = {
  "1": "Azul",
  "2": "Verde",
  "3": "Morado",
  "4": "Coral",
  "5": "Amarillo",
  "6": "Naranja",
  "7": "Turquesa",
  "8": "Gris",
  "9": "Azul intenso",
  "10": "Verde bosque",
  "11": "Rojo",
  "12": "Marrón",
};
