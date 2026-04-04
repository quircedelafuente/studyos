import type { StudyPlanChatTurn, StudyPlanDayEntry } from "@/types/dashboard";

const MONTHS_ES: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

function parseYmd(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

function compareYmd(a: string, b: string): number {
  return a.localeCompare(b);
}

function clampYmd(ymd: string, minYmd: string, maxYmd?: string): string {
  let x = ymd;
  if (compareYmd(x, minYmd) < 0) x = minYmd;
  if (maxYmd && compareYmd(x, maxYmd) > 0) x = maxYmd;
  return x;
}

/**
 * Intenta obtener YYYY-MM-DD de un fragmento (ISO, dd/mm/aaaa, "15 de abril", etc.).
 * refYear: año por defecto si no viene en el texto.
 */
export function extractYmdFromFragment(line: string, refYear: number, todayYmd: string): string | null {
  const iso = line.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const ymd = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return parseYmd(ymd) ? ymd : null;
  }

  const dmy = line.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
  if (dmy) {
    let day = Number(dmy[1]);
    let month = Number(dmy[2]);
    let year = Number(dmy[3]);
    if (year < 100) year += 2000;
    if (month > 12) {
      const t = day;
      day = month;
      month = t;
    }
    if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const ymd = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return parseYmd(ymd) ? ymd : null;
  }

  const es = line.match(
    /(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+(20\d{2}))?/i,
  );
  if (es) {
    const day = Number(es[1]);
    const month = MONTHS_ES[es[2].toLowerCase()];
    if (!month) return null;
    let year = es[3] ? Number(es[3]) : refYear;
    let dt = new Date(year, month - 1, day);
    if (dt.getMonth() !== month - 1 || dt.getDate() !== day) return null;
    const today = parseYmd(todayYmd);
    if (today && dt.getTime() < today.getTime() - 2 * 24 * 60 * 60 * 1000) {
      dt = new Date(year + 1, month - 1, day);
    }
    return formatLocalYmd(dt);
  }

  return null;
}

const START_HINT =
  /(?:empiez|empez|inici|comienz|arranc|comenzar|comienzas|empezarás|desde\s+el|desde\s+la|a\s+partir\s+del|a\s+partir\s+de|voy\s+a\s+estudiar|vamos\s+a\s+estudiar|estudio\s+desde|a\s+estudiar\s+el|estudiar\s+el|para\s+estudiar|tu\s+inicio|fecha\s+de\s+inicio)/i;

/**
 * Infiere la fecha de inicio del estudio que el usuario (o el asistente confirmando) ha dicho en el chat.
 * Prioriza mensajes del usuario y frases con verbos de inicio.
 */
export function inferPreferredStartYmdFromConversation(
  turns: StudyPlanChatTurn[],
  todayYmd: string,
  examYmd?: string | null,
): string | null {
  const refYear = Number(todayYmd.slice(0, 4));
  const maxY = examYmd && /^\d{4}-\d{2}-\d{2}$/.test(examYmd) ? examYmd : undefined;

  const userFirst = [...turns].filter((t) => t.role === "user");
  const order = [...userFirst].reverse();
  for (const t of order) {
    const lines = t.content.split(/\r?\n/);
    for (const line of lines) {
      if (!START_HINT.test(line)) continue;
      const ymd = extractYmdFromFragment(line, refYear, todayYmd);
      if (ymd) return clampYmd(ymd, todayYmd, maxY);
    }
  }
  for (const t of order) {
    const lower = t.content.toLowerCase();
    if (!/(?:empiez|empez|inici|comienz|desde|a\s+partir|arranc)/i.test(lower)) continue;
    const idx = t.content.search(/(?:empiez|empez|inici|comienz|desde\s+el|a\s+partir)/i);
    const slice = idx >= 0 ? t.content.slice(idx, idx + 220) : t.content.slice(0, 400);
    const ymd = extractYmdFromFragment(slice, refYear, todayYmd);
    if (ymd) return clampYmd(ymd, todayYmd, maxY);
  }

  const all = [...turns].reverse();
  for (const t of all) {
    const lines = t.content.split(/\r?\n/);
    for (const line of lines) {
      if (!START_HINT.test(line)) continue;
      const ymd = extractYmdFromFragment(line, refYear, todayYmd);
      if (ymd) return clampYmd(ymd, todayYmd, maxY);
    }
  }

  return null;
}

function addDaysToYmdLocal(ymd: string, n: number): string {
  const dt = parseYmd(ymd);
  if (!dt) return ymd;
  dt.setDate(dt.getDate() + n);
  return formatLocalYmd(dt);
}

/** Alinea el calendario extraído cuando el primer día no coincide con la fecha de inicio acordada en el chat. */
export function alignScheduleDaysToStartHint(
  days: StudyPlanDayEntry[],
  startHint: string | null,
  examYmd?: string | null,
): StudyPlanDayEntry[] {
  if (!days.length || !startHint || !/^\d{4}-\d{2}-\d{2}$/.test(startHint)) return days;
  if (compareYmd(days[0].date, startHint) === 0) return days;
  const a = parseYmd(days[0].date);
  const b = parseYmd(startHint);
  if (!a || !b) return days;
  const shift = Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
  if (shift === 0) return days;
  const moved = days.map((d) => ({ ...d, date: addDaysToYmdLocal(d.date, shift) }));
  if (examYmd && /^\d{4}-\d{2}-\d{2}$/.test(examYmd)) {
    return moved.filter((d) => compareYmd(d.date, examYmd) <= 0);
  }
  return moved;
}
