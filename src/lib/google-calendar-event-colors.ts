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
    bg: "var(--evc-1-bg, #e8f0fe)",
    border: "var(--evc-1-border, rgba(26, 115, 232, 0.35))",
    borderLeft: "var(--evc-1-border-left, #1a73e8)",
    text: "var(--evc-1-text, #174ea6)",
    textMuted: "var(--evc-1-text-muted, #1967d2)",
  },
  "2": {
    bg: "var(--evc-2-bg, #e6f4ea)",
    border: "var(--evc-2-border, rgba(52, 168, 83, 0.35))",
    borderLeft: "var(--evc-2-border-left, #0f9d58)",
    text: "var(--evc-2-text, #137333)",
    textMuted: "var(--evc-2-text-muted, #188038)",
  },
  "3": {
    bg: "var(--evc-3-bg, #f3e8fd)",
    border: "var(--evc-3-border, rgba(142, 68, 173, 0.35))",
    borderLeft: "var(--evc-3-border-left, #a142f4)",
    text: "var(--evc-3-text, #6a1b9a)",
    textMuted: "var(--evc-3-text-muted, #8430ce)",
  },
  "4": {
    bg: "var(--evc-4-bg, #fce8e6)",
    border: "var(--evc-4-border, rgba(234, 67, 53, 0.35))",
    borderLeft: "var(--evc-4-border-left, #ea4335)",
    text: "var(--evc-4-text, #c5221f)",
    textMuted: "var(--evc-4-text-muted, #d93025)",
  },
  "5": {
    bg: "var(--evc-5-bg, #fef7e0)",
    border: "var(--evc-5-border, rgba(251, 188, 4, 0.45))",
    borderLeft: "var(--evc-5-border-left, #f9ab00)",
    text: "var(--evc-5-text, #b06000)",
    textMuted: "var(--evc-5-text-muted, #e37400)",
  },
  "6": {
    bg: "var(--evc-6-bg, #fff3e0)",
    border: "var(--evc-6-border, rgba(245, 124, 0, 0.4))",
    borderLeft: "var(--evc-6-border-left, #f4511e)",
    text: "var(--evc-6-text, #b53d00)",
    textMuted: "var(--evc-6-text-muted, #e65100)",
  },
  "7": {
    bg: "var(--evc-7-bg, #e0f7fa)",
    border: "var(--evc-7-border, rgba(0, 151, 167, 0.35))",
    borderLeft: "var(--evc-7-border-left, #00838f)",
    text: "var(--evc-7-text, #006064)",
    textMuted: "var(--evc-7-text-muted, #00838f)",
  },
  "8": {
    bg: "var(--evc-8-bg, #f1f3f4)",
    border: "var(--evc-8-border, rgba(95, 99, 104, 0.35))",
    borderLeft: "var(--evc-8-border-left, #5f6368)",
    text: "var(--evc-8-text, #3c4043)",
    textMuted: "var(--evc-8-text-muted, #5f6368)",
  },
  "9": {
    bg: "var(--evc-9-bg, #e8f0fe)",
    border: "var(--evc-9-border, rgba(66, 133, 244, 0.4))",
    borderLeft: "var(--evc-9-border-left, #4285f4)",
    text: "var(--evc-9-text, #185abc)",
    textMuted: "var(--evc-9-text-muted, #1a73e8)",
  },
  "10": {
    bg: "var(--evc-10-bg, #e6f4ea)",
    border: "var(--evc-10-border, rgba(52, 168, 83, 0.4))",
    borderLeft: "var(--evc-10-border-left, #34a853)",
    text: "var(--evc-10-text, #0d652d)",
    textMuted: "var(--evc-10-text-muted, #188038)",
  },
  "11": {
    bg: "var(--evc-11-bg, #fce8e6)",
    border: "var(--evc-11-border, rgba(219, 68, 55, 0.4))",
    borderLeft: "var(--evc-11-border-left, #db4437)",
    text: "var(--evc-11-text, #a50e0e)",
    textMuted: "var(--evc-11-text-muted, #c5221f)",
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
    bg: "var(--evc-12-bg, #fee7fa)",
    border: "var(--evc-12-border, rgba(247, 0, 209, 0.45))",
    borderLeft: "var(--evc-12-border-left, #f700d1)",
    text: "var(--evc-12-text, #c700a8)",
    textMuted: "var(--evc-12-text-muted, #f000cb)",
  },
  /** Azul — Corporate Finance */
  "13": {
    bg: "var(--evc-13-bg, #e7f2fe)",
    border: "var(--evc-13-border, rgba(2, 127, 247, 0.45))",
    borderLeft: "var(--evc-13-border-left, #027ff7)",
    text: "var(--evc-13-text, #0268ca)",
    textMuted: "var(--evc-13-text-muted, #027df3)",
  },
  /** Verde lima — Macroeconomics */
  "14": {
    bg: "var(--evc-14-bg, #f4fee7)",
    border: "var(--evc-14-border, rgba(146, 247, 5, 0.45))",
    borderLeft: "var(--evc-14-border-left, #92f705)",
    text: "var(--evc-14-text, #4a7d03)",
    textMuted: "var(--evc-14-text-muted, #62a503)",
  },
  /** Violeta — Marketing */
  "15": {
    bg: "var(--evc-15-bg, #f6e7fe)",
    border: "var(--evc-15-border, rgba(177, 48, 247, 0.45))",
    borderLeft: "var(--evc-15-border-left, #b130f7)",
    text: "var(--evc-15-text, #8208c4)",
    textMuted: "var(--evc-15-text-muted, #9c09ec)",
  },
  /** Aguamarina — Big History */
  "16": {
    bg: "var(--evc-16-bg, #e7fef8)",
    border: "var(--evc-16-border, rgba(0, 246, 189, 0.45))",
    borderLeft: "var(--evc-16-border-left, #00f6bd)",
    text: "var(--evc-16-text, #008062)",
    textMuted: "var(--evc-16-text-muted, #00a881)",
  },
  /** Ámbar — Computer Programming 1 */
  "17": {
    bg: "var(--evc-17-bg, #fef7e7)",
    border: "var(--evc-17-border, rgba(247, 173, 2, 0.45))",
    borderLeft: "var(--evc-17-border-left, #f7ad02)",
    text: "var(--evc-17-text, #936701)",
    textMuted: "var(--evc-17-text-muted, #bb8302)",
  },
  /**
   * Neutro — el que se aplica a los eventos que llegan de Google **sin**
   * `colorId` propio, que son la mayoría de los sincronizados.
   *
   * No lleva hex: se apoya en los tokens del tema, así que en claro es pastilla
   * blanca con texto negro y en oscuro pastilla negra con trazo y texto
   * blancos. Dentro del calendario, donde --surface es negro puro, queda
   * exactamente eso: evento en blanco sobre negro.
   */
  "18": {
    bg: "var(--surface)",
    border: "var(--border)",
    borderLeft: "var(--ink)",
    text: "var(--ink)",
    textMuted: "var(--ink-muted)",
  },
};

/**
 * Color de los eventos sin `colorId`. Antes era el "6" (naranja), que teñía de
 * naranja todo lo sincronizado de Google.
 */
const DEFAULT_ID = "18";

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
  "18": "Neutro",
};
