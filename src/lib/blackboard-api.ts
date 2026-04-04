import type {
  BbCourse,
  BbCourseMembership,
  BbCourseItem,
  BbGradebookColumn,
  BbGradebookColumnEnriched,
  BbPagedResponse,
  BbTerm,
} from "@/types/blackboard";
import { bridgeBlackboardFetch } from "@/lib/blackboard-bridge-client";
import { getGradeForColumn } from "@/lib/blackboard-grade-lookup";
import {
  getGradeEntryForColumn,
  isSubmissionRelevantColumn,
  resolveSubmissionWithoutAttempt,
  submissionReasonToLabelEs,
  type SubmissionReason,
} from "@/lib/blackboard-submission-status";
import {
  buildCourseSearchText,
  classifyCourse,
  detectCurrentSemester,
  type CourseCategory,
} from "@/lib/blackboard-classifier";

const PAGE_LIMIT = 200;
const MAX_CONCURRENCY = 5;

/** Solo URL base; las peticiones van por la extensión (misma sesión que Blackboard). */
export type BbClientOptions = {
  baseUrl: string;
};

async function bbFetch<T>(path: string, opts: BbClientOptions): Promise<T> {
  return bridgeBlackboardFetch<T>(path, opts.baseUrl);
}

async function fetchAllPaged<T>(
  basePath: string,
  opts: BbClientOptions,
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    const sep = basePath.includes("?") ? "&" : "?";
    const path = `${basePath}${sep}limit=${PAGE_LIMIT}&offset=${offset}`;
    const page = await bbFetch<BbPagedResponse<T>>(path, opts);
    if (
      !page ||
      typeof page !== "object" ||
      !Array.isArray((page as BbPagedResponse<T>).results)
    ) {
      throw new Error(
        "Blackboard devolvió un formato inesperado (¿sesión caducada o HTML de login?). Recarga la pestaña de Blackboard e inicia sesión de nuevo.",
      );
    }
    all.push(...page.results);
    if (!page.paging?.nextPage || (page.results?.length ?? 0) < PAGE_LIMIT) {
      break;
    }
    offset += PAGE_LIMIT;
  }
  return all;
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]!);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Expanded memberships (internal API, like Jarvis)
   ═══════════════════════════════════════════════════════════════════════════ */

type ExpandedCourse = {
  id?: string;
  courseId?: string;
  name?: string;
  displayName?: string;
  description?: string;
  termId?: string;
  term?: { id?: string; name?: string; [k: string]: unknown };
  serviceLevelType?: string;
  isOrganization?: boolean;
  availability?: {
    available?: string;
    duration?: { type?: string; start?: string; end?: string };
  };
  effectiveAvailability?: { available?: string };
  [k: string]: unknown;
};

type ExpandedMembership = {
  courseId: string;
  userId?: string;
  courseRoleId?: string;
  course?: ExpandedCourse;
  lastAccessed?: string;
  [k: string]: unknown;
};

/**
 * Intenta el endpoint interno de memberships con expand (1 sola llamada,
 * devuelve course + term inline — mismo que usa Jarvis). Necesita userId
 * porque la API interna puede no aceptar `me`.
 */
async function tryExpandedMemberships(
  opts: BbClientOptions,
): Promise<ExpandedMembership[] | null> {
  try {
    const me = await bbFetch<{ id?: string }>(
      "/learn/api/public/v1/users/me",
      opts,
    );
    if (!me?.id) return null;
    const resp = await bbFetch<{ results?: ExpandedMembership[] }>(
      `/learn/api/v1/users/${encodeURIComponent(me.id)}/memberships` +
        "?expand=course.effectiveAvailability,course.permissions,courseRole" +
        "&includeCount=true&limit=10000",
      opts,
    );
    if (Array.isArray(resp?.results) && resp.results.length > 0) {
      return resp.results;
    }
  } catch {
    /* internal API not available — fall back */
  }
  return null;
}

function classifyExpandedMembership(
  mem: ExpandedMembership,
): BbCourseItem {
  const c = mem.course ?? ({} as ExpandedCourse);
  const term = c.term;
  const haystack = buildCourseSearchText({
    termName: term?.name,
    termId: term?.id ?? c.termId,
    displayName: c.displayName,
    name: c.name,
    description: c.description,
  });
  const category = classifyCourse(haystack, {
    serviceLevelType: c.serviceLevelType,
    isOrganization: c.isOrganization,
  });
  return {
    learnCourseId: mem.courseId,
    courseId: c.courseId ?? undefined,
    name: c.name ?? c.displayName ?? c.courseId ?? mem.courseId,
    description: c.description,
    termId: c.termId ?? term?.id ?? undefined,
    category,
    available:
      c.availability?.available ??
      c.effectiveAvailability?.available,
    startDate: c.availability?.duration?.start,
    endDate: c.availability?.duration?.end,
    lastAccessed: mem.lastAccessed,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Fallback: public API (memberships + N course details + M term fetches)
   ═══════════════════════════════════════════════════════════════════════════ */

async function fetchBbMemberships(
  opts: BbClientOptions,
): Promise<BbCourseMembership[]> {
  return fetchAllPaged<BbCourseMembership>(
    "/learn/api/public/v1/users/me/courses",
    opts,
  );
}

async function fetchBbCourseDetail(
  courseId: string,
  opts: BbClientOptions,
): Promise<BbCourse> {
  const encoded = encodeURIComponent(courseId);
  return bbFetch<BbCourse>(
    `/learn/api/public/v1/courses/${encoded}`,
    opts,
  );
}

async function fetchBbTerm(
  termId: string,
  opts: BbClientOptions,
): Promise<BbTerm | null> {
  try {
    return await bbFetch<BbTerm>(
      `/learn/api/public/v1/terms/${encodeURIComponent(termId)}`,
      opts,
    );
  } catch {
    return null;
  }
}

async function fallbackFetchAndClassify(
  opts: BbClientOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<BbCourseItem[]> {
  const memberships = await fetchBbMemberships(opts);
  if (memberships.length === 0) return [];

  const courseIds = memberships.map((m) => m.courseId);
  let done = 0;

  const details = await runWithConcurrency(
    courseIds,
    MAX_CONCURRENCY,
    async (cid) => {
      try {
        return await fetchBbCourseDetail(cid, opts);
      } catch {
        return null;
      } finally {
        done++;
        onProgress?.(done, courseIds.length);
      }
    },
  );

  const termIds = new Set<string>();
  for (const d of details) {
    if (d?.termId) termIds.add(d.termId);
  }
  for (const m of memberships) {
    if (m.course?.termId) termIds.add(m.course.termId);
  }

  const termNameMap = new Map<string, string>();
  await runWithConcurrency([...termIds], 3, async (tid) => {
    const t = await fetchBbTerm(tid, opts);
    if (t?.name) termNameMap.set(tid, t.name);
  });

  const items: BbCourseItem[] = [];
  for (let i = 0; i < courseIds.length; i++) {
    const cid = courseIds[i]!;
    const detail = details[i];
    const mem = memberships.find((m) => m.courseId === cid);
    const courseNested = mem?.course;
    const termId = detail?.termId ?? courseNested?.termId;

    const haystack = buildCourseSearchText({
      termName: termId ? termNameMap.get(termId) : undefined,
      termId,
      displayName: detail?.displayName ?? courseNested?.displayName,
      name: detail?.name ?? courseNested?.name,
      description: detail?.description,
    });
    const category = classifyCourse(haystack);

    const memDur = mem?.availability?.duration;
    const nestedDur = courseNested?.availability?.duration;

    items.push({
      learnCourseId: cid,
      courseId: detail?.courseId ?? undefined,
      name:
        detail?.name ??
        detail?.displayName ??
        courseNested?.name ??
        courseNested?.displayName ??
        detail?.courseId ??
        cid,
      description: detail?.description,
      termId,
      category,
      available:
        detail?.availability?.available ??
        mem?.availability?.available ??
        courseNested?.availability?.available,
      startDate:
        detail?.availability?.duration?.start ??
        memDur?.start ??
        nestedDur?.start,
      endDate:
        detail?.availability?.duration?.end ??
        memDur?.end ??
        nestedDur?.end,
      lastAccessed: mem?.lastAccessed,
    });
  }
  return items;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Public entry point — fetch + classify
   ═══════════════════════════════════════════════════════════════════════════ */

export type FetchCoursesResult = {
  courses: BbCourseItem[];
  semester: "first" | "second";
};

/**
 * Carga y clasifica todos los cursos del usuario.
 * 1. Intenta el endpoint interno expandido (Jarvis-style, 1 sola llamada).
 * 2. Si falla, cae al pipeline público (memberships + course details + terms).
 */
export async function fetchClassifiedCourses(
  opts: BbClientOptions,
  onProgress?: (msg: string) => void,
): Promise<FetchCoursesResult> {
  onProgress?.("Obteniendo membresías…");

  const expanded = await tryExpandedMemberships(opts);
  let items: BbCourseItem[];

  if (expanded) {
    onProgress?.(`Clasificando ${expanded.length} cursos…`);
    items = expanded.map(classifyExpandedMembership);
  } else {
    onProgress?.("Cargando cursos (API pública)…");
    items = await fallbackFetchAndClassify(opts, (done, total) =>
      onProgress?.(`Cargando cursos… ${done}/${total}`),
    );
  }

  const totals: Record<CourseCategory, number> = {
    Q1: 0,
    Q2: 0,
    ANNUAL: 0,
    ORGANIZATION_COMMUNITY: 0,
    OTHER: 0,
  };
  for (const c of items) {
    if (c.category) totals[c.category]++;
  }

  return {
    courses: items,
    semester: detectCurrentSemester(totals),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Course filter (replaces old term-based filter)
   ═══════════════════════════════════════════════════════════════════════════ */

export type CourseFilterMode = "__auto__" | "__all__" | CourseCategory;

/**
 * Categoría para un curso nuevo creado a mano: coincide con el filtro que el usuario tiene activo.
 * En __auto__ usa la misma regla que el listado (Q2 si hay Q2 en la lista curada, si no Q1).
 * En __all__ se usa OTHER como comodín.
 */
export function categoryForNewManualCourse(
  filterMode: CourseFilterMode,
  curatedCourses: BbCourseItem[],
): CourseCategory {
  switch (filterMode) {
    case "Q1":
    case "Q2":
    case "ANNUAL":
    case "ORGANIZATION_COMMUNITY":
    case "OTHER":
      return filterMode;
    case "__all__":
      return "OTHER";
    case "__auto__": {
      const q2 = curatedCourses.filter((c) => c.category === "Q2");
      if (q2.length > 0) return "Q2";
      return "Q1";
    }
    default:
      return "OTHER";
  }
}

/**
 * - __auto__: semestre actual — si hay Q2 muestra solo Q2; si no, solo Q1.
 *   Además incluye cursos con categoría OTHER (p. ej. añadidos a mano por nombre).
 * - __all__: todos los cursos.
 * - Q1 / Q2 / ANNUAL / ORGANIZATION_COMMUNITY / OTHER: categoría concreta.
 */
export function filterCoursesByMode(
  courses: BbCourseItem[],
  mode: CourseFilterMode,
): BbCourseItem[] {
  if (mode === "__all__") return courses;
  if (mode === "__auto__") {
    const q2 = courses.filter((c) => c.category === "Q2");
    const primary =
      q2.length > 0
        ? q2
        : courses.filter((c) => c.category === "Q1");
    const other = courses.filter((c) => c.category === "OTHER");
    const byId = new Map<string, BbCourseItem>();
    for (const c of primary) {
      byId.set(c.learnCourseId, c);
    }
    for (const c of other) {
      byId.set(c.learnCourseId, c);
    }
    return Array.from(byId.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "es"),
    );
  }
  return courses.filter((c) => c.category === mode);
}

/** Conteo por categoría para mostrar en el selector. */
export function courseCategoryTotals(
  courses: BbCourseItem[],
): Record<CourseCategory, number> {
  const t: Record<CourseCategory, number> = {
    Q1: 0,
    Q2: 0,
    ANNUAL: 0,
    ORGANIZATION_COMMUNITY: 0,
    OTHER: 0,
  };
  for (const c of courses) {
    if (c.category) t[c.category]++;
  }
  return t;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Gradebook columns (sin cambios)
   ═══════════════════════════════════════════════════════════════════════════ */

export async function fetchBbGradebookColumns(
  courseId: string,
  opts: BbClientOptions,
): Promise<BbGradebookColumn[]> {
  const encoded = encodeURIComponent(courseId);
  return fetchAllPaged<BbGradebookColumn>(
    `/learn/api/public/v1/courses/${encoded}/gradebook/columns`,
    opts,
  );
}

/** Categorías del curso (para mapear gradebookCategoryId → título, p. ej. Discussion). */
export async function fetchBbGradebookCategories(
  courseId: string,
  opts: BbClientOptions,
): Promise<{ id: string; title?: string; localizableTitle?: { languageKey?: string } }[]> {
  const encoded = encodeURIComponent(courseId);
  return fetchAllPaged(
    `/learn/api/public/v1/courses/${encoded}/gradebook/categories`,
    opts,
  );
}

export async function fetchBbColumnDetail(
  courseId: string,
  columnId: string,
  opts: BbClientOptions,
): Promise<BbGradebookColumn> {
  const cEncoded = encodeURIComponent(courseId);
  const colEncoded = encodeURIComponent(columnId);
  return bbFetch<BbGradebookColumn>(
    `/learn/api/public/v1/courses/${cEncoded}/gradebook/columns/${colEncoded}`,
    opts,
  );
}

export async function fetchBbCurrentUserId(opts: BbClientOptions): Promise<string> {
  const me = await bbFetch<{ id?: string }>(
    "/learn/api/public/v1/users/me",
    opts,
  );
  if (!me?.id?.trim()) {
    throw new Error(
      "No se pudo obtener tu usuario de Blackboard (users/me). Inicia sesión en la pestaña del LMS.",
    );
  }
  return me.id;
}

/**
 * GET /learn/api/v1/courses/{courseId}/gradebook/grades?userId=… (paginado, como Jarvis).
 */
async function fetchGradebookGrades(
  learnCourseId: string,
  userId: string,
  opts: BbClientOptions,
): Promise<unknown[]> {
  const limit = 200;
  let offset = 0;
  const all: unknown[] = [];
  const encoded = encodeURIComponent(learnCourseId);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    const path =
      `/learn/api/v1/courses/${encoded}/gradebook/grades` +
      `?userId=${encodeURIComponent(userId)}&limit=${limit}&offset=${offset}`;
    const data = await bbFetch<{ results?: unknown[] }>(path, opts);
    const results = Array.isArray(data?.results) ? data.results : [];
    all.push(...results);
    if (results.length < limit) break;
    offset += limit;
  }
  return all;
}

async function fetchGradebookAttempt(
  courseId: string,
  attemptId: string,
  opts: BbClientOptions,
): Promise<{ status?: string } | null> {
  try {
    const c = encodeURIComponent(courseId);
    const a = encodeURIComponent(attemptId);
    return await bbFetch<{ status?: string }>(
      `/learn/api/v1/courses/${c}/gradebook/attempts/${a}`,
      opts,
    );
  } catch {
    return null;
  }
}

async function attachSubmissionStatusesToColumns(
  courseId: string,
  cols: BbGradebookColumnEnriched[],
  gradeRows: unknown[],
  gradesLoaded: boolean,
  opts: BbClientOptions,
): Promise<BbGradebookColumnEnriched[]> {
  if (!gradesLoaded) {
    return cols.map((c) => ({
      ...c,
      submissionSubmitted: undefined,
      submissionReason: "GRADES_UNAVAILABLE",
      submissionLabelEs: submissionReasonToLabelEs("GRADES_UNAVAILABLE"),
    }));
  }

  const pending: { colId: string; attemptId: string }[] = [];
  const resolved = new Map<
    string,
    { submitted: boolean | null; reason: SubmissionReason }
  >();

  for (const col of cols) {
    const gradeRec = getGradeEntryForColumn(gradeRows, col.id);
    const treat = isSubmissionRelevantColumn(col);
    const step = resolveSubmissionWithoutAttempt(treat, gradeRec);
    if (step.kind === "resolved") {
      resolved.set(col.id, {
        submitted: step.submitted,
        reason: step.reason,
      });
    } else {
      pending.push({ colId: col.id, attemptId: step.attemptId });
    }
  }

  const attemptReasonByCol = new Map<string, SubmissionReason>();
  if (pending.length > 0) {
    const outcomes = await runWithConcurrency(
      pending,
      MAX_CONCURRENCY,
      async ({ colId, attemptId }) => {
        const att = await fetchGradebookAttempt(courseId, attemptId, opts);
        if (!att) {
          return { colId, reason: "ATTEMPT_FETCH_FAILED" as const };
        }
        const reason: SubmissionReason =
          att.status === "IN_PROGRESS"
            ? "ATTEMPT_IN_PROGRESS"
            : "ATTEMPT_NOT_IN_PROGRESS";
        return { colId, reason };
      },
    );
    for (const o of outcomes) {
      attemptReasonByCol.set(o.colId, o.reason);
    }
  }

  return cols.map((col) => {
    const r = resolved.get(col.id);
    if (r) {
      return {
        ...col,
        submissionSubmitted: r.submitted,
        submissionReason: r.reason,
        submissionLabelEs: submissionReasonToLabelEs(r.reason),
      };
    }
    const attReason = attemptReasonByCol.get(col.id);
    if (attReason) {
      if (attReason === "ATTEMPT_FETCH_FAILED") {
        return {
          ...col,
          submissionSubmitted: undefined,
          submissionReason: attReason,
          submissionLabelEs: submissionReasonToLabelEs(attReason),
        };
      }
      const submitted = attReason === "ATTEMPT_NOT_IN_PROGRESS";
      return {
        ...col,
        submissionSubmitted: submitted,
        submissionReason: attReason,
        submissionLabelEs: submissionReasonToLabelEs(attReason),
      };
    }
    return {
      ...col,
      submissionLabelEs: submissionReasonToLabelEs(
        "NOT_APPLICABLE_NON_ATTEMPT_BASED",
      ),
      submissionReason: "NOT_APPLICABLE_NON_ATTEMPT_BASED",
      submissionSubmitted: null,
    };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Ultra navigation URL (Jarvis-compatible `urlOpcional`)
   ═══════════════════════════════════════════════════════════════════════════ */

const ULTRA_BASE = "https://blackboard.ie.edu/ultra";

function pickFirstString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function getNestedString(o: unknown, path: string[]): string | null {
  let cur: unknown = o;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === "string" && cur.trim() ? cur.trim() : null;
}

/** Columna de foro: categoría de gradebook Discussion.name (Jarvis). */
export function isDiscussionColumn(x: unknown): boolean {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  const cat = o.gradebookCategory;
  if (cat && typeof cat === "object") {
    const c = cat as Record<string, unknown>;
    const title = typeof c.title === "string" ? c.title : "";
    const lt = c.localizableTitle;
    const lk =
      lt && typeof lt === "object"
        ? (lt as Record<string, unknown>).languageKey
        : undefined;
    const languageKey = typeof lk === "string" ? lk : "";
    if (title === "Discussion.name" || languageKey === "Discussion.name") {
      return true;
    }
    if (titleStringIndicatesDiscussion(title)) return true;
  }
  return false;
}

function titleStringIndicatesDiscussion(title: string): boolean {
  const t = title.trim();
  if (t === "Discussion.name") return true;
  const lower = t.toLowerCase();
  if (lower === "discussion") return true;
  if (lower === "discusión" || lower === "discusion") return true;
  if (/\bforo(s)?\b/i.test(t) || /\bforum(s)?\b/i.test(t)) return true;
  if (/\bdebate(s)?\b/i.test(t)) return true;
  if (lower.includes("discussion") || lower.includes("discusion")) return true;
  return false;
}

/**
 * Mapa id → título desde GET /gradebook/categories (Anthology: columnas suelen
 * solo traer gradebookCategoryId, no el objeto gradebookCategory).
 */
export function buildGradebookCategoryTitleMap(
  categories: {
    id?: string;
    title?: string;
    localizableTitle?: { languageKey?: string };
  }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of categories) {
    const id = c.id;
    if (!id) continue;
    let label = typeof c.title === "string" ? c.title.trim() : "";
    const lk = c.localizableTitle?.languageKey;
    if (!label && lk === "Discussion.name") label = "Discussion.name";
    if (!label && typeof lk === "string" && /discussion|forum|foro/i.test(lk)) {
      label = lk;
    }
    if (label) out[id] = label;
  }
  return out;
}

/** Handlers Anthology que enlazan a discusión/foro (véase Content handler docs). */
export function contentHandlerIndicatesDiscussion(handler: string): boolean {
  const h = handler.toLowerCase();
  if (h === "resource/x-bb-forumlink") return true;
  if (h.includes("forum")) return true;
  if (h.includes("discussion")) return true;
  return false;
}

function courselinkContentDetailTargetsForum(contentDetail: unknown): boolean {
  if (!contentDetail || typeof contentDetail !== "object") return false;
  const d = contentDetail as Record<string, unknown>;
  const link = d["resource/x-bb-courselink"];
  if (!link || typeof link !== "object") return false;
  const tt = (link as Record<string, unknown>).targetType;
  return tt === "Forum";
}

/**
 * GET /contents/{contentId}: distingue foro (forumlink, courselink→Forum) de assignment (asmt-test-link).
 */
async function fetchContentIndicatesDiscussion(
  courseId: string,
  contentId: string,
  opts: BbClientOptions,
): Promise<boolean> {
  try {
    const c = encodeURIComponent(courseId);
    const x = encodeURIComponent(contentId);
    const path =
      `/learn/api/v1/courses/${c}/contents/${x}` +
      `?fields=id,contentHandler,contentDetail`;
    const data = await bbFetch<Record<string, unknown>>(path, opts);
    const h =
      typeof data.contentHandler === "string" ? data.contentHandler.trim() : "";
    if (contentHandlerIndicatesDiscussion(h)) return true;
    if (h === "resource/x-bb-courselink") {
      return courselinkContentDetailTargetsForum(data.contentDetail);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Columna de foro: objeto embebido, categoría resuelta por id, o grading.type.
 */
export function columnIndicatesDiscussion(
  col: unknown,
  categoryTitles?: Record<string, string>,
): boolean {
  if (isDiscussionColumn(col)) return true;
  if (col === null || typeof col !== "object") return false;
  const o = col as Record<string, unknown>;
  const grading = o.grading;
  if (grading && typeof grading === "object") {
    const gt = String(
      (grading as Record<string, unknown>).type ?? "",
    ).toLowerCase();
    if (gt === "discussion") return true;
  }
  const cid = o.gradebookCategoryId;
  if (
    typeof cid === "string" &&
    cid &&
    categoryTitles &&
    typeof categoryTitles[cid] === "string"
  ) {
    if (titleStringIndicatesDiscussion(categoryTitles[cid]!)) return true;
  }
  return false;
}

function extractAssessmentIdFromColumnDetail(detail: unknown): string | null {
  if (detail === null || typeof detail !== "object") return null;
  const d = detail as Record<string, unknown>;
  return pickFirstString(
    d.assessmentId,
    d.gradableItemId,
    d.attemptableId,
    d.contentId,
    d.linkId,
    getNestedString(d, ["content", "id"]),
    getNestedString(d, ["gradableItem", "id"]),
    getNestedString(d, ["gradableItem", "gradableItemId"]),
    getNestedString(d, ["gradableItem", "attemptableId"]),
    getNestedString(d, ["item", "id"]),
  );
}

export type BuildColumnNavigableUrlOptions = {
  ultraBase?: string;
  /** id de categoría → título (GET /gradebook/categories). */
  gradebookCategoryTitles?: Record<string, string>;
  /** true si GET /contents confirma foro (además de linkDiscussionFromContent en la columna). */
  forceDiscussionContent?: boolean;
};

export function buildColumnNavigableUrl(
  courseId: string,
  columnId: string,
  detail: unknown,
  listColumn?: unknown,
  options?: BuildColumnNavigableUrlOptions,
): string {
  void columnId; // kept for parity with Jarvis signature
  const root = (options?.ultraBase ?? ULTRA_BASE).replace(/\/+$/, "");
  const categoryTitles = options?.gradebookCategoryTitles;
  const d =
    detail && typeof detail === "object" && "column" in (detail as any)
      ? (detail as any).column
      : detail;

  const listContentId =
    listColumn && typeof listColumn === "object"
      ? (listColumn as any).contentId
      : undefined;
  const detailContentId =
    d && typeof d === "object" ? (d as any).contentId : undefined;
  const contentId = pickFirstString(listContentId, detailContentId);

  const forceDiscussion =
    options?.forceDiscussionContent === true ||
    (listColumn &&
      typeof listColumn === "object" &&
      (listColumn as BbGradebookColumnEnriched).linkDiscussionFromContent ===
        true);

  // 1) Discussion + contentId (listColumn.contentId o detail.column/d.contentId)
  if (
    contentId &&
    (forceDiscussion ||
      columnIndicatesDiscussion(listColumn, categoryTitles) ||
      columnIndicatesDiscussion(d, categoryTitles))
  ) {
    return (
      `${root}/courses/${encodeURIComponent(courseId)}` +
      `/grades/discussion/${encodeURIComponent(String(contentId))}` +
      `?view=discussions&courseId=${encodeURIComponent(courseId)}`
    );
  }

  // 2) Assessment id (prioridad exacta)
  const assessmentId = pickFirstString(
    extractAssessmentIdFromColumnDetail(d),
    // Si el detalle no trae ids, Jarvis cae a equivalentes
    contentId,
    d && typeof d === "object" ? (d as any).linkId : undefined,
  );
  if (assessmentId) {
    return (
      `${root}/courses/${encodeURIComponent(courseId)}` +
      `/grades/assessment/${encodeURIComponent(assessmentId)}` +
      `/overview?courseId=${encodeURIComponent(courseId)}`
    );
  }

  // 3) Fallback: gradebook del curso
  return `${root}/courses/${encodeURIComponent(courseId)}/grades`;
}

/**
 * URL Ultra para una columna: recalcula siempre (no usa urlOpcional en caché)
 * para no perpetuar enlaces incorrectos; pasa gradebookCategoryTitles si está en caché.
 */
export function resolveGradebookColumnUltraUrl(
  courseId: string,
  col: BbGradebookColumnEnriched,
  options?: BuildColumnNavigableUrlOptions,
): string {
  return buildColumnNavigableUrl(courseId, col.id, null, col, options);
}

export type FetchEnrichedGradebookResult = {
  columns: BbGradebookColumnEnriched[];
  /** Para enlaces Discussion cuando la columna solo tiene gradebookCategoryId. */
  gradebookCategoryTitles: Record<string, string>;
};

export async function fetchEnrichedGradebook(
  courseId: string,
  opts: BbClientOptions,
  onProgress?: (done: number, total: number) => void,
  onBeforeGrades?: () => void,
): Promise<FetchEnrichedGradebookResult> {
  const columns = await fetchBbGradebookColumns(courseId, opts);

  let gradebookCategoryTitles: Record<string, string> = {};
  try {
    const rawCats = await fetchBbGradebookCategories(courseId, opts);
    gradebookCategoryTitles = buildGradebookCategoryTitleMap(rawCats);
  } catch {
    /* sin categorías no podemos mapear id → Discussion; el resto de heurísticas sigue valiendo */
  }

  const urlOpts: BuildColumnNavigableUrlOptions = { gradebookCategoryTitles };

  if (columns.length === 0) {
    return { columns: [], gradebookCategoryTitles };
  }

  let done = 0;
  const enriched = await runWithConcurrency(
    columns,
    MAX_CONCURRENCY,
    async (col) => {
      let enrichedCol: BbGradebookColumnEnriched = {
        ...col,
        detailFetched: false,
        urlOpcional: null,
      };
      try {
        const detail = await fetchBbColumnDetail(courseId, col.id, opts);
        const merged = { ...col, ...detail };
        const contentId = merged.contentId ? String(merged.contentId).trim() : "";

        let linkDiscussionFromContent = false;
        if (contentId) {
          const alreadyDisc =
            columnIndicatesDiscussion(merged, gradebookCategoryTitles) ||
            columnIndicatesDiscussion(col, gradebookCategoryTitles);
          if (!alreadyDisc) {
            linkDiscussionFromContent = await fetchContentIndicatesDiscussion(
              courseId,
              contentId,
              opts,
            );
          }
        }

        enrichedCol = {
          ...col,
          ...detail,
          detailFetched: true,
          ...(linkDiscussionFromContent ? { linkDiscussionFromContent: true } : {}),
          urlOpcional: buildColumnNavigableUrl(courseId, col.id, detail, col, {
            ...urlOpts,
            forceDiscussionContent: linkDiscussionFromContent,
          }),
        };
      } catch {
        let linkDiscussionFromContent = false;
        const contentId = col.contentId ? String(col.contentId).trim() : "";
        if (contentId && !columnIndicatesDiscussion(col, gradebookCategoryTitles)) {
          linkDiscussionFromContent = await fetchContentIndicatesDiscussion(
            courseId,
            contentId,
            opts,
          );
        }
        enrichedCol = {
          ...col,
          detailFetched: false,
          detailError: true,
          ...(linkDiscussionFromContent ? { linkDiscussionFromContent: true } : {}),
          urlOpcional: buildColumnNavigableUrl(courseId, col.id, null, col, {
            ...urlOpts,
            forceDiscussionContent: linkDiscussionFromContent,
          }),
        };
      } finally {
        done++;
        onProgress?.(done, columns.length);
      }
      return enrichedCol;
    },
  );

  onBeforeGrades?.();

  let gradeRows: unknown[] = [];
  let gradesLoaded = false;
  try {
    const userId = await fetchBbCurrentUserId(opts);
    gradeRows = await fetchGradebookGrades(courseId, userId, opts);
    gradesLoaded = true;
  } catch {
    gradesLoaded = false;
  }

  const merged = enriched.map((col) => {
    const info = gradesLoaded ? getGradeForColumn(gradeRows, col.id) : null;
    return {
      ...col,
      studentGradeText: info?.gradeText ?? undefined,
      studentGradeStatus: info?.statusText ?? undefined,
      studentGradesLoaded: gradesLoaded,
    };
  });

  const withSubmission = await attachSubmissionStatusesToColumns(
    courseId,
    merged,
    gradeRows,
    gradesLoaded,
    opts,
  );

  return {
    columns: withSubmission,
    gradebookCategoryTitles,
  };
}

export function buildBbUltraLink(
  baseUrl: string,
  courseId: string,
  column: BbGradebookColumnEnriched,
  gradebookCategoryTitles?: Record<string, string>,
): string {
  const ultraRoot = `${baseUrl.replace(/\/+$/, "")}/ultra`;
  return buildColumnNavigableUrl(courseId, column.id, null, column, {
    ultraBase: ultraRoot,
    gradebookCategoryTitles,
  });
}
