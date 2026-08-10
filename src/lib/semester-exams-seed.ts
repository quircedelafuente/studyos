import type { ImportantDeadline } from "@/types/dashboard";
import {
  DEADLINES_STORAGE_KEY,
  loadImportantDeadlines,
  saveImportantDeadlines,
} from "@/lib/deadlines-storage";

/**
 * Fechas evaluables del semestre otoño 2026 (IE University, 2º curso del dual
 * BBA + Computer Science and AI), extraídas de los syllabus oficiales y
 * cruzadas con el calendario de clases.
 *
 * Se siembran una única vez por usuario: si borras o editas alguna, no vuelve.
 * El flag vive en localStorage con prefijo `iestudio-`, así que viaja por la
 * sincronización y los demás dispositivos no vuelven a sembrar — reciben los
 * deadlines por la nube como cualquier otro cambio.
 */
export const SEMESTER_EXAMS_SEED_FLAG_KEY = "iestudio-seeded-exams-2026-fall";

/** Prefijo de los ids sembrados, para poder identificarlos después. */
const SEED_ID_PREFIX = "exam-2026f-";

/**
 * Color por asignatura. Son los ids propios de la app ("12"…"17"), definidos en
 * `google-calendar-event-colors`; no existen en la paleta de Google.
 */
const COLOR = {
  calculus: "12", // #F700D1 fucsia
  finance: "13", // #027FF7 azul
  macro: "14", // #92F705 verde lima
  marketing: "15", // #B130F7 violeta
  history: "16", // #00F6BD aguamarina
  programming: "17", // #F7AD02 ámbar
} as const;

/** Las clases duran 80 min y los exámenes ocupan el hueco completo. */
const SLOT_MINUTES = 80;

type SeedEntry = {
  id: string;
  title: string;
  date: string;
  time: string | null;
  color: string;
};

const SEED: SeedEntry[] = [
  // ── Septiembre ──────────────────────────────────────────────────────────
  {
    id: "mkt-pitch",
    title: "Marketing · Pitch de la idea (aprobación del profesor)",
    date: "2026-09-07",
    time: "14:30",
    color: COLOR.marketing,
  },
  {
    id: "mkt-a1",
    title: "Marketing · Assessment 1: STDP + producto + TAM-SAM-SOM",
    date: "2026-09-14",
    time: "15:00",
    color: COLOR.marketing,
  },
  {
    id: "hist-paper1",
    title: "Big History · Paper + presentación bloque 1 (5%)",
    date: "2026-09-18",
    time: "15:00",
    color: COLOR.history,
  },
  {
    id: "calc-quiz1",
    title: "Calculus · Quiz 1 (10%)",
    date: "2026-09-24",
    time: "14:00",
    color: COLOR.calculus,
  },

  // ── Octubre ─────────────────────────────────────────────────────────────
  {
    id: "prog-midterm",
    title: "Programming 1 · Midterm — ⚠️ FECHA SIN CONFIRMAR (6-8 oct)",
    date: "2026-10-06",
    time: null,
    color: COLOR.programming,
  },
  {
    id: "hist-midterm",
    title: "Big History · EXAMEN PARCIAL (20%)",
    date: "2026-10-14",
    time: "15:00",
    color: COLOR.history,
  },
  {
    id: "macro-midterm1",
    title: "Macroeconomics · MIDTERM I (30%) — caps. 2, 3, 18, 4 y 5",
    date: "2026-10-16",
    time: "16:30",
    color: COLOR.macro,
  },
  {
    id: "mkt-a2",
    title: "Marketing · Assessment 2: pricing y distribución",
    date: "2026-10-19",
    time: "14:30",
    color: COLOR.marketing,
  },
  {
    id: "calc-midterm",
    title: "Calculus · MIDTERM (20%) — sesiones 1-14",
    date: "2026-10-21",
    time: "16:30",
    color: COLOR.calculus,
  },
  {
    id: "fin-midterm",
    title: "Corporate Finance · MIDTERM (25%) — caps. 1, 2, 3 y 5",
    date: "2026-10-29",
    time: "15:30",
    color: COLOR.finance,
  },

  // ── Noviembre ───────────────────────────────────────────────────────────
  {
    id: "hist-paper3",
    title: "Big History · Paper + presentación bloque 3 (5%)",
    date: "2026-11-03",
    time: "14:30",
    color: COLOR.history,
  },
  {
    id: "mkt-a3",
    title: "Marketing · Assessment 3: estrategia de comunicación",
    date: "2026-11-16",
    time: "14:30",
    color: COLOR.marketing,
  },
  {
    id: "calc-quiz2",
    title: "Calculus · Quiz 2 (10%)",
    date: "2026-11-25",
    time: "16:30",
    color: COLOR.calculus,
  },
  {
    id: "macro-proj1",
    title: "Macroeconomics · Course Project (1 de 3)",
    date: "2026-11-27",
    time: "16:30",
    color: COLOR.macro,
  },
  {
    id: "mkt-presentacion",
    title: "Marketing · PRESENTACIÓN Marketing Plan (25%) — examen oral",
    date: "2026-11-30",
    time: "14:30",
    color: COLOR.marketing,
  },

  // ── Diciembre ───────────────────────────────────────────────────────────
  {
    id: "macro-proj2",
    title: "Macroeconomics · Course Project (2 de 3)",
    date: "2026-12-02",
    time: "18:00",
    color: COLOR.macro,
  },
  {
    id: "macro-proj3",
    title: "Macroeconomics · Course Project (3 de 3)",
    date: "2026-12-04",
    time: "16:30",
    color: COLOR.macro,
  },
  {
    id: "macro-midterm2",
    title: "Macroeconomics · MIDTERM II (30%)",
    date: "2026-12-09",
    time: "09:30",
    color: COLOR.macro,
  },
  {
    id: "fin-final",
    title: "Corporate Finance · EXAMEN FINAL (45%) — mínimo 4/10",
    date: "2026-12-10",
    time: "09:30",
    color: COLOR.finance,
  },
  {
    id: "prog-final",
    title: "Programming 1 · EXAMEN FINAL (45%) — mínimo 3,5 · por confirmar",
    date: "2026-12-15",
    time: "17:30",
    color: COLOR.programming,
  },
  {
    id: "calc-final",
    title: "Calculus · EXAMEN FINAL (35%) — mínimo 3,5/10",
    date: "2026-12-16",
    time: "16:30",
    color: COLOR.calculus,
  },
  {
    id: "mkt-final",
    title: "Marketing · EXAMEN FINAL (45%) — mínimo 5/10, común de BBA",
    date: "2026-12-17",
    time: "09:30",
    color: COLOR.marketing,
  },
  {
    id: "hist-final",
    title: "Big History · EXAMEN FINAL (30%) — mínimo 3,5/10",
    date: "2026-12-18",
    time: "15:00",
    color: COLOR.history,
  },
];

function toDeadline(entry: SeedEntry, createdAt: string): ImportantDeadline {
  return {
    id: `${SEED_ID_PREFIX}${entry.id}`,
    title: entry.title,
    date: entry.date,
    time: entry.time,
    durationMinutes: entry.time ? SLOT_MINUTES : null,
    courseId: null,
    tagIds: [],
    calendarColorId: entry.color,
    createdAt,
  };
}

/** Deadlines del semestre listos para guardar. */
export function semesterExamDeadlines(): ImportantDeadline[] {
  const createdAt = new Date().toISOString();
  return SEED.map((e) => toDeadline(e, createdAt));
}

export function hasSeededSemesterExams(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(SEMESTER_EXAMS_SEED_FLAG_KEY) === "1";
  } catch {
    return true;
  }
}

/**
 * Añade las fechas del semestre una sola vez.
 *
 * Es idempotente por partida doble: sale si el flag ya está puesto, y además
 * nunca pisa un deadline existente con el mismo id. Devuelve cuántos añadió.
 */
export function seedSemesterExamsOnce(): number {
  if (typeof window === "undefined") return 0;
  if (hasSeededSemesterExams()) return 0;

  try {
    const existing = loadImportantDeadlines();
    const existingIds = new Set(existing.map((d) => d.id));
    const toAdd = semesterExamDeadlines().filter((d) => !existingIds.has(d.id));

    if (toAdd.length > 0) {
      // `saveImportantDeadlines` ya dispara el evento de cambio y el push a la nube.
      saveImportantDeadlines([...existing, ...toAdd]);
    }
    window.localStorage.setItem(SEMESTER_EXAMS_SEED_FLAG_KEY, "1");
    return toAdd.length;
  } catch {
    // quota / modo privado: se reintentará en la siguiente carga
    return 0;
  }
}

/**
 * Flag de la migración de colores.
 *
 * Hace falta porque el sembrado solo corre una vez: a quien ya tenga las fechas
 * creadas no le basta con cambiar `COLOR`, hay que reescribir los registros.
 * Subir el sufijo (`-v3`, `-v4`…) vuelve a aplicar la tabla de colores actual.
 */
export const SEED_COLORS_MIGRATION_FLAG_KEY =
  "iestudio-exams-2026-fall-colors-v4";

/** Trozo del id que identifica la asignatura → color que le toca ahora. */
const SUBJECT_COLOR_BY_ID_PREFIX: ReadonlyArray<readonly [string, string]> = [
  ["calc-", COLOR.calculus],
  ["fin-", COLOR.finance],
  ["macro-", COLOR.macro],
  ["mkt-", COLOR.marketing],
  ["hist-", COLOR.history],
  ["prog-", COLOR.programming],
];

/**
 * Re-aplica la tabla de colores a los deadlines ya sembrados.
 *
 * Solo toca los que empiezan por {@link SEED_ID_PREFIX}: los que hayas creado
 * tú a mano se quedan como estén, aunque sean de la misma asignatura.
 */
export function migrateSeedColorsOnce(): number {
  if (typeof window === "undefined") return 0;
  try {
    if (window.localStorage.getItem(SEED_COLORS_MIGRATION_FLAG_KEY) === "1") {
      return 0;
    }
    const all = loadImportantDeadlines();
    let changed = 0;
    const next = all.map((d) => {
      if (!d.id.startsWith(SEED_ID_PREFIX)) return d;
      const rest = d.id.slice(SEED_ID_PREFIX.length);
      const match = SUBJECT_COLOR_BY_ID_PREFIX.find(([p]) => rest.startsWith(p));
      if (!match || d.calendarColorId === match[1]) return d;
      changed += 1;
      return { ...d, calendarColorId: match[1] };
    });
    if (changed > 0) saveImportantDeadlines(next);
    window.localStorage.setItem(SEED_COLORS_MIGRATION_FLAG_KEY, "1");
    return changed;
  } catch {
    return 0;
  }
}

/** Solo para depurar: permite volver a sembrar desde la consola del navegador. */
export function resetSemesterExamsSeed(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SEMESTER_EXAMS_SEED_FLAG_KEY);
  } catch {
    // ignorado
  }
}

export { DEADLINES_STORAGE_KEY };
