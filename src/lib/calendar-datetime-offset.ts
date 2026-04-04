/**
 * Convierte un valor de `<input type="datetime-local">` (sin zona) a RFC3339 con
 * offset numérico del huso horario del navegador en ese instante (DST incluido).
 * Así Google Calendar recibe un instante inequívoco y no desplaza 1 h respecto al selector.
 */
export function datetimeLocalToRfc3339WithOffset(dtLocal: string): string {
  const t = dtLocal.trim();
  const [datePart, timePartRaw] = t.split("T");
  if (!datePart || !timePartRaw) {
    throw new Error("Fecha u hora inválida");
  }
  const [y, mo, da] = datePart.split("-").map(Number);
  let hh: number;
  let mm: number;
  let ss = 0;
  if (timePartRaw.length >= 8 && timePartRaw[5] === ":") {
    const [a, b, c] = timePartRaw.split(":");
    hh = Number(a);
    mm = Number(b);
    ss = Number((c ?? "0").slice(0, 2));
  } else {
    const [a, b] = timePartRaw.slice(0, 5).split(":");
    hh = Number(a);
    mm = Number(b);
  }
  if (
    ![y, mo, da, hh, mm].every((n) => Number.isFinite(n)) ||
    !Number.isFinite(ss)
  ) {
    throw new Error("Fecha u hora inválida");
  }
  const d = new Date(y!, mo! - 1, da!, hh!, mm!, ss, 0);
  if (Number.isNaN(d.getTime())) {
    throw new Error("Fecha u hora inválida");
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  const Y = d.getFullYear();
  const M = pad(d.getMonth() + 1);
  const D = pad(d.getDate());
  const H = pad(d.getHours());
  const Mi = pad(d.getMinutes());
  const S = pad(d.getSeconds());

  const offsetTotalMin = -d.getTimezoneOffset();
  const sign = offsetTotalMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetTotalMin);
  const oh = pad(Math.floor(abs / 60));
  const omi = pad(abs % 60);
  return `${Y}-${M}-${D}T${H}:${Mi}:${S}${sign}${oh}:${omi}`;
}
