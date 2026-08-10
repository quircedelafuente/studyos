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
 * Colores propios de la app, fuera de la paleta de Google ("12"…"17").
 *
 * La API de Google solo acepta `colorId` "1"…"11" y nuestro validador descarta
 * cualquier otro, así que estos ids **solo valen para eventos locales**
 * («Exámenes y fechas»). Si se ofrecieran al crear un evento de Google, se
 * perderían en silencio al guardar.
 */
export const LOCAL_ONLY_COLOR_IDS = ["12", "13", "14", "15", "16", "17"] as const;

/** Colores seleccionables para deadlines locales: los de Google + los propios. */
export const LOCAL_DEADLINE_COLOR_IDS = [
  ...GOOGLE_CALENDAR_EVENT_COLOR_IDS,
  ...LOCAL_ONLY_COLOR_IDS,
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
   * Colores propios de la asignatura ("12"…"17"), fuera de la paleta de Google.
   *
   * `borderLeft` es el hex elegido tal cual; el fondo y los dos tonos de texto
   * se derivaron de él manteniendo el matiz, con el texto oscurecido hasta
   * cumplir contraste AA (≥ 4.5:1) sobre su propio fondo.
   */
  /** Fucsia — Calculus */
  "12": {
    bg: "#fee7fa",
    border: "rgba(247, 0, 209, 0.45)",
    borderLeft: "#f700d1",
    text: "#c700a8",
    textMuted: "#f000cb",
  },
  /** Azul — Corporate Finance */
  "13": {
    bg: "#e7f2fe",
    border: "rgba(2, 127, 247, 0.45)",
    borderLeft: "#027ff7",
    text: "#0268ca",
    textMuted: "#027df3",
  },
  /** Verde lima — Macroeconomics */
  "14": {
    bg: "#f4fee7",
    border: "rgba(146, 247, 5, 0.45)",
    borderLeft: "#92f705",
    text: "#4a7d03",
    textMuted: "#62a503",
  },
  /** Violeta — Marketing */
  "15": {
    bg: "#f6e7fe",
    border: "rgba(177, 48, 247, 0.45)",
    borderLeft: "#b130f7",
    text: "#8208c4",
    textMuted: "#9c09ec",
  },
  /** Aguamarina — Big History */
  "16": {
    bg: "#e7fef8",
    border: "rgba(0, 246, 189, 0.45)",
    borderLeft: "#00f6bd",
    text: "#008062",
    textMuted: "#00a881",
  },
  /** Ámbar — Computer Programming 1 */
  "17": {
    bg: "#fef7e7",
    border: "rgba(247, 173, 2, 0.45)",
    borderLeft: "#f7ad02",
    text: "#936701",
    textMuted: "#bb8302",
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
  "12": "Fucsia",
  "13": "Azul eléctrico",
  "14": "Verde lima",
  "15": "Violeta",
  "16": "Aguamarina",
  "17": "Ámbar",
};
