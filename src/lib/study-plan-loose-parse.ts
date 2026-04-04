import type { StudyPlanDayEntry } from "@/types/dashboard";
import { extractYmdFromFragment } from "@/lib/study-plan-start-date";

export function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

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

function addDaysToYmd(ymd: string, n: number): string {
  const dt = parseYmd(ymd);
  if (!dt) return ymd;
  dt.setDate(dt.getDate() + n);
  return formatLocalYmd(dt);
}

function compareYmd(a: string, b: string): number {
  return a.localeCompare(b);
}

/* ── markdown stripping ────────────────────────────────────────────── */

function stripMarkdown(raw: string): string {
  let s = raw;
  s = s.replace(/^#{1,6}\s+/gm, "");
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, "$1");
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");
  s = s.replace(/\*([^*]+)\*/g, "$1");
  s = s.replace(/_([^_]+)_/g, "$1");
  s = s.replace(/```[\s\S]*?```/g, "");
  s = s.replace(/`([^`]+)`/g, "$1");
  return s;
}

/* ── calendar section extraction ───────────────────────────────────── */

function extractCalendarSection(text: string): string {
  const calStart = /(?:^|\n)\s*(?:Calendario(?:\s+d[ií]a\s+a\s+d[ií]a)?|El\s+calendario)\s*[:\n]/im;
  const botStart = /(?:^|\n)\s*(?:Cuello\s+de\s+botella|Alerta\s+de\s+cuello)/im;
  const mCal = calStart.exec(text);
  let section = mCal ? text.slice(mCal.index) : text;
  const mBot = botStart.exec(section);
  if (mBot && mBot.index > 0) {
    section = section.slice(0, mBot.index);
  }
  return section.trim();
}

/* ── Spanish weekday-based day headers ─────────────────────────────── */

const WEEKDAY_ES =
  "Domingo|Lunes|Martes|Mi[eé]rcoles|Jueves|Viernes|S[aá]bado";

const WEEKDAY_RE_STR = `(?:${WEEKDAY_ES})`;

function spanishDaySplitRegex(): RegExp {
  return new RegExp(
    `(?=(?:^|\\n)\\s*${WEEKDAY_RE_STR},?\\s*\\d{1,2}\\s+de\\s+)`,
    "gi",
  );
}

function isSpanishDayHeader(line: string): boolean {
  return new RegExp(`^${WEEKDAY_RE_STR},?\\s*\\d{1,2}\\s+de\\s+`, "i").test(
    line.trim(),
  );
}

export function hasSpanishWeekdayDayLines(text: string): boolean {
  return new RegExp(
    `(?:^|\\n)\\s*${WEEKDAY_RE_STR},?\\s*\\d{1,2}\\s+de\\s+`,
    "i",
  ).test(text.replace(/\r\n/g, "\n"));
}

export function extractSpanishCalendarDayBlocks(text: string): string[] {
  const parts = text.split(spanishDaySplitRegex());
  const blocks: string[] = [];
  for (const p of parts) {
    const s = p.trim();
    if (!s) continue;
    if (isSpanishDayHeader(s)) {
      blocks.push(s);
    }
  }
  return blocks;
}

function isExamOnlyDayBlock(block: string): boolean {
  const lower = block.toLowerCase();
  if (!/d[ií]a\s+del\s+examen/.test(lower)) return false;
  return !/bloque\s*\d/i.test(block);
}

export function countSpanishStudyDayBlocks(text: string): number {
  const clean = stripMarkdown(text.replace(/\r\n/g, "\n"));
  const section = extractCalendarSection(clean);
  return extractSpanishCalendarDayBlocks(section).filter(
    (b) => !isExamOnlyDayBlock(b),
  ).length;
}

/* ── hours extraction ──────────────────────────────────────────────── */

function extractHoursFromBlock(block: string): number {
  const firstLine = (block.split(/\n/)[0] ?? "").trim();
  let m = /\((\d+(?:[.,]\d+)?)\s*horas?\)/i.exec(firstLine);
  if (m) {
    const v = parseFloat(m[1].replace(",", "."));
    if (Number.isFinite(v)) return Math.min(12, Math.max(0.25, v));
  }
  m = /\((\d+(?:[.,]\d+)?)\s*horas?\)/i.exec(block);
  if (m) {
    const v = parseFloat(m[1].replace(",", "."));
    if (Number.isFinite(v)) return Math.min(12, Math.max(0.25, v));
  }
  const lines = block.split(/\n/).map((l) => l.trim());
  for (const l of lines.slice(0, 3)) {
    const hm = /(\d+(?:[.,]\d+)?)\s*h(?:oras?)?\b/i.exec(l);
    if (hm) {
      const v = parseFloat(hm[1].replace(",", "."));
      if (Number.isFinite(v) && v <= 12 && v >= 0.25) return v;
    }
  }
  const bloquesMin = [...block.matchAll(/\((\d+)\s*min\)/gi)];
  if (bloquesMin.length > 0) {
    const totalMin = bloquesMin.reduce((s, m2) => s + Number(m2[1]), 0);
    if (totalMin > 0 && totalMin <= 720) return Math.round((totalMin / 60) * 10) / 10;
  }
  return 2;
}

/* ── focus normalization ───────────────────────────────────────────── */

export function normalizeFocusForList(block: string): string {
  let s = block.trim();
  const lines0 = s.split(/\n/).map((l) => l.trim());
  const first = lines0[0] ?? "";
  if (isSpanishDayHeader(first) || /^(?:D[ií]a|Semana)\s+\d+/i.test(first)) {
    s = lines0.slice(1).join("\n").trim();
  }
  const lines = s
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const taskLines: string[] = [];
  for (const l of lines) {
    if (/^bloque\s+\d+/i.test(l)) {
      taskLines.push(l.replace(/\s+/g, " ").trim());
    } else if (/^(?:tarea|contenido|m[eé]todo)\s*:/i.test(l)) {
      taskLines.push(l.replace(/\s+/g, " ").trim());
    }
  }
  if (taskLines.length > 0) return taskLines.join("; ").slice(0, 3500);

  const bullets = lines.filter(
    (l) => /^[-*•]\s+/.test(l) || /^\d+[\.\)]\s+/.test(l),
  );
  if (bullets.length >= 2) {
    return bullets
      .map((l) =>
        l
          .replace(/^[-*•]\s+/, "")
          .replace(/^\d+[\.\)]\s+/, "")
          .trim(),
      )
      .join("; ")
      .slice(0, 3500);
  }
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.slice(0, 900);
}

/* ── legacy fallback parsers ───────────────────────────────────────── */

function extractDayBlocks(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const parts = t.split(
    /(?=\n\s*(?:D[ií]a|Semana)\s+\d+)/i,
  );
  const out: string[] = [];
  for (const p of parts) {
    const s = p.trim();
    if (!s) continue;
    if (/^(?:D[ií]a|Semana)\s+\d+/i.test(s)) out.push(s);
  }
  return out;
}

function extractBlocksFromBullets(text: string): string[] {
  const bullets = text.match(/^\s*[-*•]\s+[^\n]+/gm);
  if (!bullets || bullets.length < 2) return [];
  const n = Math.min(5, Math.max(1, Math.ceil(bullets.length / 3)));
  const chunk = Math.ceil(bullets.length / n);
  const blocks: string[] = [];
  for (let i = 0; i < n; i++) {
    const slice = bullets.slice(i * chunk, (i + 1) * chunk);
    const focus = slice
      .map((b) => b.replace(/^\s*[-*•]\s+/, "").trim())
      .filter(Boolean)
      .join("; ");
    if (focus) blocks.push(`Día ${i + 1}\n${focus}`);
  }
  return blocks;
}

/* ── public helpers ────────────────────────────────────────────────── */

export function splitFocusIntoItems(focus: string | undefined | null): string[] {
  const t = (focus ?? "").trim();
  if (!t) return [];
  const parts = t
    .split(/\s*;\s*|\s*·\s*|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [t];
}

/* ── main entry point ──────────────────────────────────────────────── */

export function parseLooseDaysFromAssistant(
  text: string,
  todayYmd: string,
  examYmd?: string,
  preferredStartYmd?: string | null,
): StudyPlanDayEntry[] {
  const raw = text.replace(/\r\n/g, "\n");
  const clean = stripMarkdown(raw);
  const section = extractCalendarSection(clean);

  let blocks = extractSpanishCalendarDayBlocks(section).filter(
    (b) => !isExamOnlyDayBlock(b),
  );
  if (blocks.length === 0) {
    blocks = extractDayBlocks(section);
  }
  if (blocks.length === 0) {
    blocks = extractSpanishCalendarDayBlocks(clean).filter(
      (b) => !isExamOnlyDayBlock(b),
    );
  }
  if (blocks.length === 0) {
    blocks = extractDayBlocks(clean);
  }
  if (blocks.length === 0) {
    blocks = extractBlocksFromBullets(clean);
  }
  if (blocks.length === 0) return [];

  const refYear = Number(todayYmd.slice(0, 4));
  const out: StudyPlanDayEntry[] = [];

  let nextCursor =
    preferredStartYmd &&
    /^\d{4}-\d{2}-\d{2}$/.test(preferredStartYmd) &&
    compareYmd(preferredStartYmd, todayYmd) >= 0
      ? preferredStartYmd
      : todayYmd;

  if (examYmd && compareYmd(nextCursor, examYmd) > 0) {
    nextCursor = examYmd;
  }

  for (const block of blocks) {
    const firstLine = (block.split(/\n/)[0] ?? "").trim();
    let explicit = extractYmdFromFragment(firstLine, refYear, todayYmd);
    if (!explicit) {
      explicit = extractYmdFromFragment(block.slice(0, 520), refYear, todayYmd);
    }
    if (explicit && examYmd && compareYmd(explicit, examYmd) > 0) {
      continue;
    }
    const rowDate = explicit ?? nextCursor;
    if (examYmd && compareYmd(rowDate, examYmd) > 0) break;

    const hours = extractHoursFromBlock(block);
    const focus = normalizeFocusForList(block);
    if (!focus) continue;
    out.push({ date: rowDate, studyHours: hours, focus });
    nextCursor = addDaysToYmd(rowDate, 1);
  }
  return out;
}
