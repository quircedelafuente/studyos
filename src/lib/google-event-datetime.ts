import { DateTime } from "luxon";

/** RFC3339 con Z o con offset numérico al final. */
const HAS_OFFSET_OR_Z = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Convierte `start`/`end.dateTime` de la API de Google a `Date` (instante UTC).
 *
 * Google suele devolver `dateTime` sin offset junto a `timeZone` IANA: en ese caso
 * la hora es **reloj de pared en esa zona**, no en la del navegador. Un `new Date(iso)`
 * sin Z se interpreta en hora **local del dispositivo** → desfase de 1 h respecto a
 * Google Calendar si no coincide.
 */
export function parseGoogleDateTimeToJsDate(
  dateTime: string | undefined,
  timeZone: string | undefined,
): Date | null {
  if (!dateTime?.trim()) return null;
  const s = dateTime.trim();

  if (HAS_OFFSET_OR_Z.test(s)) {
    const dt = DateTime.fromISO(s, { setZone: true });
    if (!dt.isValid) return null;
    return dt.toJSDate();
  }

  if (timeZone) {
    const dt = DateTime.fromISO(s, { zone: timeZone });
    if (!dt.isValid) return null;
    return dt.toJSDate();
  }

  const dt = DateTime.fromISO(s);
  if (!dt.isValid) return null;
  return dt.toJSDate();
}
