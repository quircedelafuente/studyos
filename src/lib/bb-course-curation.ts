import type { BbCourseItem } from "@/types/blackboard";
import {
  categoryForNewManualCourse,
  type CourseFilterMode,
} from "@/lib/blackboard-api";
import type { CourseCategory } from "@/lib/blackboard-classifier";

const STORAGE_KEY = "iestudio-bb-course-curation";

export const BB_COURSE_CURATION_CHANGED = "iestudio-bb-course-curation-changed";

export type BbCourseCuration = {
  /** Cursos ocultos en la app (siguen en la caché de Blackboard). */
  hiddenLearnCourseIds: string[];
  /** Añadidos a mano por ID (p. ej. no salieron en la última sync). */
  extraCourses: BbCourseItem[];
};

const empty: BbCourseCuration = {
  hiddenLearnCourseIds: [],
  extraCourses: [],
};

function normalizeCuration(raw: unknown): BbCourseCuration {
  if (raw === null || typeof raw !== "object") return { ...empty };
  const o = raw as Record<string, unknown>;
  const hidden = Array.isArray(o.hiddenLearnCourseIds)
    ? o.hiddenLearnCourseIds.filter(
        (x): x is string => typeof x === "string" && x.trim() !== "",
      )
    : [];
  const extrasRaw = Array.isArray(o.extraCourses) ? o.extraCourses : [];
  const extraCourses: BbCourseItem[] = [];
  for (const x of extrasRaw) {
    if (x === null || typeof x !== "object") continue;
    const e = x as Record<string, unknown>;
    const id = typeof e.learnCourseId === "string" ? e.learnCourseId.trim() : "";
    if (!id) continue;
    const name =
      typeof e.name === "string" && e.name.trim()
        ? e.name.trim()
        : `Curso ${id.slice(0, 8)}…`;
    const cat = e.category;
    const category =
      cat === "Q1" ||
      cat === "Q2" ||
      cat === "ANNUAL" ||
      cat === "ORGANIZATION_COMMUNITY" ||
      cat === "OTHER"
        ? cat
        : ("OTHER" as const);
    extraCourses.push({ learnCourseId: id, name, category });
  }
  return {
    hiddenLearnCourseIds: [...new Set(hidden)],
    extraCourses,
  };
}

export function loadBbCourseCuration(): BbCourseCuration {
  if (typeof window === "undefined") return { ...empty };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...empty };
    return normalizeCuration(JSON.parse(raw) as unknown);
  } catch {
    return { ...empty };
  }
}

export function saveBbCourseCuration(next: BbCourseCuration): void {
  if (typeof window === "undefined") return;
  try {
    const payload: BbCourseCuration = {
      hiddenLearnCourseIds: [...new Set(next.hiddenLearnCourseIds)],
      extraCourses: next.extraCourses,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    window.dispatchEvent(new Event(BB_COURSE_CURATION_CHANGED));
  } catch {
    /* quota */
  }
}

/**
 * Lista visible: API + extras, sin ocultos. Los datos de API tienen prioridad si coincide el ID.
 */
export function applyBbCourseCuration(
  apiCourses: BbCourseItem[],
  curation: BbCourseCuration,
): BbCourseItem[] {
  const hidden = new Set(curation.hiddenLearnCourseIds);
  const byId = new Map<string, BbCourseItem>();

  for (const c of curation.extraCourses) {
    if (hidden.has(c.learnCourseId)) continue;
    byId.set(c.learnCourseId, { ...c });
  }
  for (const c of apiCourses) {
    if (hidden.has(c.learnCourseId)) {
      byId.delete(c.learnCourseId);
      continue;
    }
    byId.set(c.learnCourseId, c);
  }

  return Array.from(byId.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "es"),
  );
}

export function hideLearnCourseId(
  apiCourses: BbCourseItem[],
  curation: BbCourseCuration,
  learnCourseId: string,
): BbCourseCuration {
  const id = learnCourseId.trim();
  if (!id) return curation;
  const inApi = apiCourses.some((c) => c.learnCourseId === id);
  return {
    hiddenLearnCourseIds: [...new Set([...curation.hiddenLearnCourseIds, id])],
    extraCourses: inApi
      ? curation.extraCourses
      : curation.extraCourses.filter((c) => c.learnCourseId !== id),
  };
}

export function unhideLearnCourseId(
  curation: BbCourseCuration,
  learnCourseId: string,
): BbCourseCuration {
  const id = learnCourseId.trim();
  if (!id) return curation;
  return {
    ...curation,
    hiddenLearnCourseIds: curation.hiddenLearnCourseIds.filter((h) => h !== id),
  };
}

export function addExtraBbCourse(
  curation: BbCourseCuration,
  learnCourseId: string,
  name: string,
  category: CourseCategory,
): BbCourseCuration {
  const id = learnCourseId.trim();
  if (!id) return curation;
  const hidden = curation.hiddenLearnCourseIds.filter((h) => h !== id);
  const extraFiltered = curation.extraCourses.filter((c) => c.learnCourseId !== id);
  const item: BbCourseItem = {
    learnCourseId: id,
    name: name.trim() || `Curso ${id.slice(0, 8)}…`,
    category,
  };
  return {
    hiddenLearnCourseIds: hidden,
    extraCourses: [...extraFiltered, item],
  };
}

function normName(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function matchesCourseName(courseName: string, query: string): boolean {
  const n = normName(courseName);
  const q = normName(query);
  if (!q) return false;
  if (n.includes(q)) return true;
  const words = q.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return false;
  return words.every((w) => n.includes(w));
}

export function findBbCoursesMatchingName(
  apiCourses: BbCourseItem[],
  query: string,
): BbCourseItem[] {
  const q = query.trim();
  if (!q) return [];
  return apiCourses.filter((c) => matchesCourseName(c.name, q));
}

/** Tras elegir un curso en la lista de ambiguos. */
export function confirmAddBbCourseFromList(
  curation: BbCourseCuration,
  picked: BbCourseItem,
): BbCourseCuration {
  let next = unhideLearnCourseId(curation, picked.learnCourseId);
  next = {
    ...next,
    extraCourses: next.extraCourses.filter(
      (c) => c.learnCourseId !== picked.learnCourseId,
    ),
  };
  return next;
}

export type AddCourseByNameResult =
  | { status: "added"; curation: BbCourseCuration }
  | { status: "choose"; candidates: BbCourseItem[] }
  | { status: "noop"; message: string };

/**
 * Añade curso solo con nombre: empareja contra la caché de Blackboard, o crea uno local con ID generado.
 * @param displayedCourses Lista ya filtrada por semestre (lo que ve el usuario en la UI).
 * @param filterMode Filtro activo: define la categoría del curso nuevo si es solo local.
 */
export function resolveAddCourseByName(
  apiCourses: BbCourseItem[],
  curation: BbCourseCuration,
  displayedCourses: BbCourseItem[],
  rawName: string,
  filterMode: CourseFilterMode,
): AddCourseByNameResult {
  const q = rawName.trim();
  if (!q) return { status: "noop", message: "Escribe un nombre." };

  const curated = applyBbCourseCuration(apiCourses, curation);
  const curatedIds = new Set(curated.map((c) => c.learnCourseId));
  const visibleIds = new Set(displayedCourses.map((c) => c.learnCourseId));

  const allMatches = findBbCoursesMatchingName(apiCourses, q);

  if (allMatches.some((m) => visibleIds.has(m.learnCourseId))) {
    return { status: "noop", message: "Ese curso ya está en la lista." };
  }

  const onlyHiddenBySemesterFilter = allMatches.filter(
    (m) => curatedIds.has(m.learnCourseId) && !visibleIds.has(m.learnCourseId),
  );
  if (onlyHiddenBySemesterFilter.length > 0) {
    return {
      status: "noop",
      message:
        "Ese curso ya está cargado pero el filtro de semestre lo oculta. Cambia a «Todos los cursos» o al trimestre adecuado.",
    };
  }

  const toRestore = allMatches.filter((m) => !curatedIds.has(m.learnCourseId));

  if (toRestore.length === 1) {
    return {
      status: "added",
      curation: confirmAddBbCourseFromList(curation, toRestore[0]!),
    };
  }

  if (toRestore.length > 1) {
    return { status: "choose", candidates: toRestore };
  }

  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const newCategory = categoryForNewManualCourse(filterMode, curated);

  return {
    status: "added",
    curation: addExtraBbCourse(curation, id, q, newCategory),
  };
}
