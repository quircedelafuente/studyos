"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  BbConfig,
  BbCourseItem,
  BbGradebookColumnEnriched,
  BbGradebookCache,
} from "@/types/blackboard";
import {
  loadBbConfig,
  saveBbConfig,
  clearBbConfig,
  BB_CONFIG_CHANGED,
} from "@/lib/blackboard-config";
import { getDefaultBlackboardBaseUrl } from "@/lib/blackboard-defaults";
import {
  BB_COURSES_STORAGE_CHANGED,
  loadBbCourses,
  saveBbCourses,
  loadBbGradebook,
  saveBbGradebook,
  clearAllBbData,
} from "@/lib/blackboard-storage";
import {
  applyBbCourseCuration,
  BB_COURSE_CURATION_CHANGED,
  loadBbCourseCuration,
} from "@/lib/bb-course-curation";
import {
  BB_COURSE_FILTER_CHANGED,
  loadCourseFilterMode,
  saveCourseFilterMode,
} from "@/lib/bb-course-filter-prefs";
import { CourseFilterSelect } from "./CourseFilterSelect";
import {
  fetchClassifiedCourses,
  fetchEnrichedGradebook,
  resolveGradebookColumnUltraUrl,
  filterCoursesByMode,
  courseCategoryTotals,
  type CourseFilterMode,
} from "@/lib/blackboard-api";
import {
  getBlackboardBridgeExtensionId,
  isBlackboardBridgeConfigured,
  pingBlackboardBridge,
} from "@/lib/blackboard-bridge-client";
import { getSubmissionLight } from "@/lib/blackboard-submission-status";
import { hasBbSyncedCache } from "@/lib/bb-displayed-courses";
import { useSession } from "next-auth/react";
import { useCloudSyncStatus } from "@/components/providers/CloudSyncProvider";

/* ─── Inline SVG icons ─── */

function IconRefresh({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M23 4v6h-6M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
    </svg>
  );
}

function IconExternal({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
    </svg>
  );
}

function IconSettings({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}

function IconChevron({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/* ─── Helpers ─── */

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "justo ahora";
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  const days = Math.floor(hrs / 24);
  return `hace ${days} d`;
}

function formatDueDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type GradebookSortMode =
  | "none"
  | "deadline-asc"
  | "deadline-desc"
  | "submission-status";

function dueTs(iso?: string): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function submissionSortRank(col: BbGradebookColumnEnriched): number {
  const light = getSubmissionLight(col.submissionReason, col.submissionSubmitted);
  // Pendiente arriba: rojo -> amarillo -> verde -> neutral.
  if (light === "red") return 0;
  if (light === "yellow") return 1;
  if (light === "green") return 2;
  return 3;
}

/**
 * Nota del alumno + máximo cuando hay calificación con score/texto.
 * Sin nota (no graded): siempre "-" en esta columna (no el máximo del ítem).
 */
function formatGradePointsCell(col: BbGradebookColumnEnriched): ReactNode {
  const max = col.score?.possible;
  const g = col.studentGradeText?.trim();
  const st = col.studentGradeStatus?.trim();

  if (g) {
    return max != null ? `${g} / ${max}` : g;
  }

  const title =
    col.studentGradesLoaded === false
      ? "No se pudieron cargar tus notas desde Blackboard."
      : st || undefined;

  return (
    <span
      title={title}
      className="tabular-nums text-[var(--ink-muted)]"
    >
      -
    </span>
  );
}

/** Rojo = unopened, amarillo = unsubmitted (borrador), verde = submitted; gris = N/A. */
function SubmissionStatusIndicator({
  reason,
  submitted,
  labelEs,
}: {
  reason?: string;
  submitted?: boolean | null;
  labelEs?: string;
}) {
  const light = getSubmissionLight(reason, submitted);
  const title = labelEs?.trim() || reason || "";
  if (light === "neutral") {
    return (
      <span
        className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--ink-faint)]/20 ring-1 ring-[var(--border)]"
        title={title || undefined}
        aria-label={title || "No aplica"}
      />
    );
  }
  const bg =
    light === "green"
      ? "bg-emerald-500"
      : light === "yellow"
        ? "bg-amber-400"
        : "bg-red-500";
  return (
    <span
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${bg} shadow-sm ring-1 ring-black/10 dark:ring-white/10`}
      title={title}
      role="img"
      aria-label={title}
    />
  );
}

/* ─── Main panel ─── */

export function AssignmentsPanel() {
  const { status: sessionStatus } = useSession();
  const cloudSync = useCloudSyncStatus();

  /* Config */
  const [config, setConfig] = useState<BbConfig | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [cfgBaseUrl, setCfgBaseUrl] = useState(getDefaultBlackboardBaseUrl);
  const [cfgExtensionId, setCfgExtensionId] = useState("");
  const [bridgeOk, setBridgeOk] = useState(false);
  const [bridgeChecked, setBridgeChecked] = useState(false);

  /* Courses (caché inmediata: sync cloud puede rellenar sin pestaña Assignments) */
  const [allCourses, setAllCourses] = useState<BbCourseItem[]>(() => {
    if (typeof window === "undefined") return [];
    return loadBbCourses()?.courses ?? [];
  });
  const [coursesLoading, setCoursesLoading] = useState(false);
  const [coursesFetched, setCoursesFetched] = useState<string | null>(null);
  const [coursesError, setCoursesError] = useState<string | null>(null);
  const [coursesProgress, setCoursesProgress] = useState("");
  const [curation, setCuration] = useState(loadBbCourseCuration);
  const [filterMode, setFilterModeState] = useState<CourseFilterMode>(() =>
    loadCourseFilterMode(),
  );
  const setFilterMode = useCallback((m: CourseFilterMode) => {
    setFilterModeState(m);
    saveCourseFilterMode(m);
  }, []);
  const [currentSemester, setCurrentSemester] = useState<"first" | "second" | null>(null);

  /* Selected course + gradebook */
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [gradebook, setGradebook] = useState<BbGradebookColumnEnriched[]>([]);
  const [gbLoading, setGbLoading] = useState(false);
  const [gbFetched, setGbFetched] = useState<string | null>(null);
  const [gbError, setGbError] = useState<string | null>(null);
  const [gbProgress, setGbProgress] = useState("");
  const [gbSortMode, setGbSortMode] = useState<GradebookSortMode>("none");

  const [bulkGbLoading, setBulkGbLoading] = useState(false);
  const [bulkGbProgress, setBulkGbProgress] = useState("");
  const [bulkGbSummary, setBulkGbSummary] = useState<{
    variant: "success" | "warning";
    text: string;
  } | null>(null);

  const selectedCourseIdRef = useRef<string | null>(null);
  selectedCourseIdRef.current = selectedCourseId;

  const hasBbCache = hasBbSyncedCache();
  /** Datos de la nube aún no aplicados a localStorage: no mostrar “vacío” ni asistente. */
  const waitingCloudHydration =
    sessionStatus === "authenticated" &&
    cloudSync &&
    !cloudSync.initialSyncDone &&
    cloudSync.cloudEnabled !== false;
  /** Vista principal del gradebook; el asistente de conexión solo si el usuario abre Ajustes. */
  const showAssignmentsMain = !showConfig;
  const showFullConfigWizard = showConfig;

  /* Load config from localStorage on mount */
  useEffect(() => {
    const stored = loadBbConfig();
    if (stored) {
      setConfig(stored);
      setCfgBaseUrl(stored.baseUrl);
      setCfgExtensionId(stored.extensionId ?? "");
    }
    setConfigLoaded(true);
  }, []);

  useEffect(() => {
    const syncFromStorage = () => {
      const stored = loadBbConfig();
      if (stored) {
        setConfig(stored);
        setCfgBaseUrl(stored.baseUrl);
        setCfgExtensionId(stored.extensionId ?? "");
      } else {
        setConfig(null);
        setCfgBaseUrl(getDefaultBlackboardBaseUrl());
        setCfgExtensionId("");
      }
    };
    window.addEventListener(BB_CONFIG_CHANGED, syncFromStorage);
    return () => window.removeEventListener(BB_CONFIG_CHANGED, syncFromStorage);
  }, []);

  /* Comprobar extensión puente (Chrome/Edge) */
  useEffect(() => {
    if (!configLoaded) return;
    let cancelled = false;
    void (async () => {
      if (!isBlackboardBridgeConfigured()) {
        if (!cancelled) {
          setBridgeOk(false);
          setBridgeChecked(true);
        }
        return;
      }
      const ok = await pingBlackboardBridge();
      if (!cancelled) {
        setBridgeOk(ok);
        setBridgeChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [configLoaded, config?.extensionId, config?.baseUrl]);

  /* Load cached courses on mount */
  useEffect(() => {
    if (!configLoaded) return;
    const cached = loadBbCourses();
    if (cached) {
      setAllCourses(cached.courses);
      setCoursesFetched(cached.fetchedAt);
      const totals = courseCategoryTotals(cached.courses);
      const q2 = totals.Q2 ?? 0;
      setCurrentSemester(q2 > 0 ? "second" : "first");
    }
  }, [configLoaded]);

  useEffect(() => {
    const onCuration = () => setCuration(loadBbCourseCuration());
    window.addEventListener(BB_COURSE_CURATION_CHANGED, onCuration);
    return () =>
      window.removeEventListener(BB_COURSE_CURATION_CHANGED, onCuration);
  }, []);

  useEffect(() => {
    const onFilter = () => setFilterModeState(loadCourseFilterMode());
    window.addEventListener(BB_COURSE_FILTER_CHANGED, onFilter);
    return () => window.removeEventListener(BB_COURSE_FILTER_CHANGED, onFilter);
  }, []);

  useEffect(() => {
    const syncCourses = () => {
      const c = loadBbCourses();
      if (c?.courses) setAllCourses(c.courses);
    };
    window.addEventListener(BB_COURSES_STORAGE_CHANGED, syncCourses);
    return () =>
      window.removeEventListener(BB_COURSES_STORAGE_CHANGED, syncCourses);
  }, []);

  const curatedCourses = useMemo(
    () => applyBbCourseCuration(allCourses, curation),
    [allCourses, curation],
  );

  const displayedCourses = useMemo(
    () => filterCoursesByMode(curatedCourses, filterMode),
    [curatedCourses, filterMode],
  );

  const catTotals = useMemo(
    () => courseCategoryTotals(curatedCourses),
    [curatedCourses],
  );

  /* Default: semestre actual + primer curso seleccionado */
  useEffect(() => {
    if (!configLoaded) return;
    if (filterMode !== "__auto__") return;
    // Si ya hay selección válida, no tocar.
    if (
      selectedCourseId &&
      displayedCourses.some((c) => c.learnCourseId === selectedCourseId)
    ) {
      return;
    }
    if (displayedCourses.length === 0) return;
    handleSelectCourse(displayedCourses[0]!.learnCourseId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configLoaded, filterMode, displayedCourses, selectedCourseId]);

  useEffect(() => {
    if (!selectedCourseId) return;
    if (!curatedCourses.some((c) => c.learnCourseId === selectedCourseId)) {
      setSelectedCourseId(null);
      setGradebook([]);
      setGbFetched(null);
    }
  }, [curatedCourses, selectedCourseId]);

  /* ─── Config actions ─── */

  function handleSaveConfig() {
    const url = cfgBaseUrl.trim().replace(/\/+$/, "");
    if (!url) return;
    const ext = cfgExtensionId.trim();
    const newCfg: BbConfig = {
      baseUrl: url,
      ...(ext ? { extensionId: ext } : {}),
    };
    saveBbConfig(newCfg);
    setConfig(newCfg);
    setShowConfig(false);
    void pingBlackboardBridge().then(setBridgeOk);
  }

  function handleDisconnect() {
    clearBbConfig();
    clearAllBbData();
    setConfig(null);
    setAllCourses([]);
    setCoursesFetched(null);
    setSelectedCourseId(null);
    setGradebook([]);
    setGbFetched(null);
    setCfgBaseUrl(getDefaultBlackboardBaseUrl());
    setCfgExtensionId("");
    setFilterMode("__auto__");
    setCurrentSemester(null);
    setBulkGbSummary(null);
    setBulkGbProgress("");
  }

  /* ─── Fetch courses ─── */

  const fetchCourses = useCallback(async () => {
    if (!config) return;
    setCoursesLoading(true);
    setCoursesError(null);
    setCoursesProgress("Obteniendo membresías…");
    try {
      const { courses, semester } = await fetchClassifiedCourses(
        { baseUrl: config.baseUrl },
        (msg) => setCoursesProgress(msg),
      );
      setAllCourses(courses);
      saveBbCourses(courses);
      setCoursesFetched(new Date().toISOString());
      setCurrentSemester(semester);
    } catch (e) {
      setCoursesError(e instanceof Error ? e.message : "Error al cargar cursos");
    } finally {
      setCoursesLoading(false);
      setCoursesProgress("");
    }
  }, [config]);

  /* ─── Fetch gradebook for selected course ─── */

  const fetchGradebookForCourse = useCallback(
    async (courseId: string) => {
      if (!config) return;
      setGbLoading(true);
      setGbError(null);
      setGbProgress("Obteniendo columnas…");
      try {
        const { columns, gradebookCategoryTitles } = await fetchEnrichedGradebook(
          courseId,
          { baseUrl: config.baseUrl },
          (done, total) =>
            setGbProgress(`Enriqueciendo… ${done}/${total}`),
          () => setGbProgress("Descargando tus calificaciones…"),
        );
        setGradebook(columns);
        const cache: BbGradebookCache = {
          courseId,
          columns,
          fetchedAt: new Date().toISOString(),
          gradebookCategoryTitles,
        };
        saveBbGradebook(cache);
        setGbFetched(cache.fetchedAt);
      } catch (e) {
        setGbError(e instanceof Error ? e.message : "Error al cargar gradebook");
      } finally {
        setGbLoading(false);
        setGbProgress("");
      }
    },
    [config],
  );

  const refreshAllGradebooks = useCallback(async () => {
    if (!config || curatedCourses.length === 0) return;
    setBulkGbLoading(true);
    setBulkGbSummary(null);
    setGbError(null);
    const opts = { baseUrl: config.baseUrl };
    let ok = 0;
    let fail = 0;
    const errorSamples: string[] = [];

    for (let i = 0; i < curatedCourses.length; i++) {
      const c = curatedCourses[i]!;
      const id = c.learnCourseId;
      setBulkGbProgress(
        `Gradebooks ${i + 1}/${curatedCourses.length}: ${c.name}`,
      );
      try {
        const { columns, gradebookCategoryTitles } = await fetchEnrichedGradebook(
          id,
          opts,
        );
        const fetchedAt = new Date().toISOString();
        saveBbGradebook({
          courseId: id,
          columns,
          fetchedAt,
          gradebookCategoryTitles,
        });
        ok++;
        if (id === selectedCourseIdRef.current) {
          setGradebook(columns);
          setGbFetched(fetchedAt);
        }
      } catch (e) {
        fail++;
        const msg = e instanceof Error ? e.message : "Error";
        if (errorSamples.length < 5) {
          errorSamples.push(`${c.name}: ${msg}`);
        }
      }
    }

    setBulkGbProgress("");
    setBulkGbLoading(false);
    if (fail === 0) {
      setBulkGbSummary({
        variant: "success",
        text: `Gradebooks actualizados: ${ok} curso(s).`,
      });
    } else {
      setBulkGbSummary({
        variant: "warning",
        text: `${ok} correcto(s), ${fail} error(es). ${errorSamples.join(" · ")}`,
      });
    }
  }, [config, curatedCourses]);

  /* Load cached gradebook when selecting course */
  function handleSelectCourse(courseId: string) {
    setSelectedCourseId(courseId);
    setGbError(null);
    const cached = loadBbGradebook(courseId);
    if (cached) {
      setGradebook(cached.columns);
      setGbFetched(cached.fetchedAt);
    } else {
      setGradebook([]);
      setGbFetched(null);
      // Solo la API local+puente puede rellenar; sin config queda vacío hasta sync/caché.
      if (config) {
        void fetchGradebookForCourse(courseId);
      }
    }
  }

  const selectedCourseName = useMemo(() => {
    if (!selectedCourseId) return null;
    return (
      curatedCourses.find((c) => c.learnCourseId === selectedCourseId)?.name ??
      selectedCourseId
    );
  }, [selectedCourseId, curatedCourses]);

  /** Mapa categoría id → título (caché del gradebook); necesario para enlaces Discussion. */
  const gradebookCategoryTitlesForLinks = useMemo(():
    | Record<string, string>
    | undefined => {
    if (!selectedCourseId || typeof window === "undefined") return undefined;
    return loadBbGradebook(selectedCourseId)?.gradebookCategoryTitles;
  }, [selectedCourseId, gbFetched, gradebook]);

  const extId = getBlackboardBridgeExtensionId();

  const gradesLoadFailed = useMemo(
    () =>
      gradebook.length > 0 &&
      gradebook.every((c) => c.studentGradesLoaded === false),
    [gradebook],
  );

  const sortedGradebook = useMemo(() => {
    const withIdx = gradebook.map((col, idx) => ({ col, idx }));
    if (gbSortMode === "none") return gradebook;

    withIdx.sort((a, b) => {
      if (gbSortMode === "submission-status") {
        const ra = submissionSortRank(a.col);
        const rb = submissionSortRank(b.col);
        if (ra !== rb) return ra - rb;
        return a.idx - b.idx;
      }
      const ta = dueTs(a.col.grading?.due);
      const tb = dueTs(b.col.grading?.due);
      // Items sin deadline siempre al final.
      if (ta === null && tb === null) return a.idx - b.idx;
      if (ta === null) return 1;
      if (tb === null) return -1;
      return gbSortMode === "deadline-desc" ? tb - ta : ta - tb;
    });

    return withIdx.map((x) => x.col);
  }, [gradebook, gbSortMode]);

  /* ─── Render ─── */

  if (!configLoaded) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <p className="text-sm text-[var(--ink-muted)]">Cargando…</p>
      </div>
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-6 px-4 py-6 md:min-h-0 md:flex-1 md:px-10 md:py-8">
      {/* Header */}
      <header className="flex shrink-0 flex-row items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Assignments
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            Gradebook &amp; Tareas
          </h1>
        </div>
        <button
          type="button"
          onClick={() => setShowConfig((v) => !v)}
          className={`shrink-0 rounded-xl border border-[var(--border)] p-2.5 transition hover:bg-[var(--surface-muted)] hover:text-[var(--ink)] ${
            showConfig ? "text-[var(--ink)] ring-2 ring-[var(--ink-muted)]/25" : "text-[var(--ink-muted)]"
          }`}
          aria-label={showConfig ? "Cerrar ajustes Blackboard" : "Ajustes Blackboard"}
          aria-pressed={showConfig}
        >
          <IconSettings className="h-5 w-5" />
        </button>
      </header>

      {/* ─── Config panel ─── */}
      {showFullConfigWizard ? (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="text-sm font-bold text-[var(--ink)]">
            {config ? "Configuración de Blackboard" : "Conectar con Blackboard Learn"}
          </h2>
          <div className="mt-2 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)]/50 px-3 py-2.5 text-xs leading-relaxed text-[var(--ink-muted)]">
            <p>
              <strong className="text-[var(--ink)]">1. Instala la extensión</strong>{" "}
              (Chrome o Edge): en{" "}
              <code className="rounded bg-[var(--canvas)] px-1 font-mono-cli text-[10px]">
                chrome://extensions
              </code>{" "}
              activa «Modo de desarrollador» → «Cargar descomprimida» → carpeta{" "}
              <code className="font-mono-cli text-[10px]">
                extensions/blackboard-bridge
              </code>{" "}
              del proyecto IEStudio.
            </p>
            <p>
              <strong className="text-[var(--ink)]">2. ID de la extensión</strong>{" "}
              (en la tarjeta de la extensión en{" "}
              <code className="font-mono-cli text-[10px]">chrome://extensions</code>
              ): pégalo abajo en «ID extensión puente» y guarda, o defínelo en{" "}
              <code className="font-mono-cli text-[10px]">
                NEXT_PUBLIC_BB_BRIDGE_EXTENSION_ID
              </code>{" "}
              en <code className="font-mono-cli text-[10px]">.env.local</code> y
              reinicia <code className="font-mono-cli text-[10px]">npm run dev</code>
              .
            </p>
            <p>
              <strong className="text-[var(--ink)]">3. Origen permitido:</strong> el
              manifest solo permite localhost por defecto. Para producción, añade tu
              URL en{" "}
              <code className="font-mono-cli text-[10px]">
                extensions/blackboard-bridge/manifest.json
              </code>{" "}
              →{" "}
              <code className="font-mono-cli text-[10px]">
                externally_connectable.matches
              </code>
              .
            </p>
            <p>
              <strong className="text-[var(--ink)]">4. Usa Blackboard</strong> en
              una pestaña (sesión iniciada). IEStudio enviará las peticiones API a
              través de esa pestaña;{" "}
              <strong className="text-[var(--ink)]">
                no se copian ni guardan cookies
              </strong>
              .
            </p>
            {bridgeChecked ? (
              <p
                className={
                  bridgeOk
                    ? "font-medium text-emerald-800"
                    : "font-medium text-amber-800"
                }
              >
                {bridgeOk
                  ? "✓ Comunicación con la extensión correcta."
                  : extId
                    ? "No se pudo hablar con la extensión. Comprueba el ID, que la extensión esté activa y que el origen esté en externally_connectable."
                    : "Falta el ID de la extensión: pégalo abajo o en .env.local (NEXT_PUBLIC_BB_BRIDGE_EXTENSION_ID)."}
              </p>
            ) : null}
          </div>

          <div className="mt-4 space-y-3">
            <div>
              <label
                htmlFor="bb-base-url"
                className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]"
              >
                URL base
              </label>
              <input
                id="bb-base-url"
                type="url"
                value={cfgBaseUrl}
                onChange={(e) => setCfgBaseUrl(e.target.value)}
                placeholder="https://blackboard.ie.edu"
                className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--ink-muted)]"
              />
            </div>
            <div>
              <label
                htmlFor="bb-bridge-ext-id"
                className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]"
              >
                ID extensión puente (opcional si está en .env)
              </label>
              <input
                id="bb-bridge-ext-id"
                type="text"
                value={cfgExtensionId}
                onChange={(e) => setCfgExtensionId(e.target.value)}
                placeholder="abcdefghijklmnop…"
                autoComplete="off"
                spellCheck={false}
                className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 font-mono-cli text-sm text-[var(--ink)] outline-none focus:border-[var(--ink-muted)]"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleSaveConfig}
                disabled={!cfgBaseUrl.trim()}
                className="rounded-xl bg-[var(--ink)] px-5 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              >
                {config ? "Guardar cambios" : "Conectar"}
              </button>
              {config ? (
                <>
                  <button
                    type="button"
                    onClick={() => setShowConfig(false)}
                    className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleDisconnect}
                    className="rounded-xl border border-red-400/40 px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50"
                  >
                    Desconectar
                  </button>
                </>
              ) : null}
            </div>
          </div>

          {config ? (
            <div className="mt-6 border-t border-[var(--border)] pt-5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                Sincronización
              </h3>
              <p className="mt-2 text-xs text-[var(--ink-muted)]">
                <span className="font-mono-cli text-[11px] text-[var(--ink)]">
                  {config.baseUrl.replace(/^https?:\/\//, "")}
                </span>
                {bridgeChecked ? (
                  <span
                    className={
                      bridgeOk ? "font-medium text-emerald-700" : "font-medium text-amber-800"
                    }
                  >
                    {bridgeOk
                      ? " · puente OK"
                      : extId
                        ? " · revisa extensión"
                        : " · falta ID extensión"}
                  </span>
                ) : null}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--ink-muted)]">
                {coursesFetched ? (
                  <span>Última sync cursos: {relativeTime(coursesFetched)}</span>
                ) : null}
                {currentSemester ? (
                  <span className="rounded-md bg-[var(--surface-muted)] px-2 py-0.5 font-semibold text-[var(--ink)]">
                    Semestre actual:{" "}
                    {currentSemester === "first" ? "Primero" : "Segundo"}
                  </span>
                ) : null}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void fetchCourses()}
                  disabled={coursesLoading || bulkGbLoading}
                  className="flex items-center gap-2 rounded-xl bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  <IconRefresh
                    className={`h-4 w-4 ${coursesLoading ? "animate-spin" : ""}`}
                  />
                  {allCourses.length === 0
                    ? "Cargar cursos"
                    : "Actualizar cursos"}
                </button>
                {allCourses.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => void refreshAllGradebooks()}
                    disabled={bulkGbLoading || coursesLoading || gbLoading}
                    className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] disabled:opacity-50"
                  >
                    <IconRefresh
                      className={`h-4 w-4 ${bulkGbLoading ? "animate-spin" : ""}`}
                    />
                    Actualizar todos los gradebooks
                  </button>
                ) : null}
              </div>
              {coursesProgress || bulkGbProgress ? (
                <p className="mt-2 max-w-full truncate text-xs text-[var(--ink-muted)]">
                  {coursesProgress || bulkGbProgress}
                </p>
              ) : null}
              {coursesError ? (
                <div className="mt-2 whitespace-pre-line rounded-xl border border-red-400/30 bg-red-50/60 px-3 py-2 text-xs leading-relaxed text-red-700">
                  {coursesError}
                </div>
              ) : null}
              {bulkGbSummary ? (
                <div
                  className={`mt-2 rounded-xl border px-3 py-2 text-xs leading-relaxed ${
                    bulkGbSummary.variant === "warning"
                      ? "border-amber-400/40 bg-amber-50/80 text-amber-950"
                      : "border-emerald-400/40 bg-emerald-50/80 text-emerald-950"
                  }`}
                >
                  {bulkGbSummary.text}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ─── Gradebook (config local o solo caché sincronizada) ─── */}
      {showAssignmentsMain ? (
        <div className="flex flex-col gap-5 md:min-h-0 md:flex-1">
          {waitingCloudHydration ? (
            <div className="flex min-h-[18rem] flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-14">
              <p className="text-sm font-medium text-[var(--ink)]">
                Sincronizando datos desde la nube…
              </p>
              <p className="mt-2 max-w-md text-center text-xs text-[var(--ink-muted)]">
                Cursos y gradebooks de tu cuenta se cargan en este dispositivo.
              </p>
            </div>
          ) : (
            <>
          {!config && hasBbCache ? (
            <div className="rounded-xl border border-sky-500/35 bg-sky-500/10 px-4 py-3 text-sm leading-relaxed text-sky-950 dark:text-sky-100/95">
              <p className="font-semibold text-[var(--ink)]">
                Solo lectura (datos sincronizados)
              </p>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                Este dispositivo no tiene Blackboard conectado aquí; se muestran
                cursos y gradebooks de la última copia en la nube. Para
                actualizar desde Blackboard, abre{" "}
                <strong className="text-[var(--ink)]">Ajustes</strong> y configura
                la URL + extensión, o usa un PC con la extensión instalada.
              </p>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-3">
            {(coursesLoading || bulkGbLoading) &&
            (coursesProgress || bulkGbProgress) ? (
              <span className="mr-auto max-w-[min(100%,28rem)] truncate text-xs text-[var(--ink-muted)]">
                {coursesProgress || bulkGbProgress}
              </span>
            ) : null}
            {curatedCourses.length > 0 &&
            displayedCourses.length === 0 &&
            !coursesLoading ? (
              <CourseFilterSelect
                id="bb-course-filter-fallback"
                value={filterMode}
                onChange={setFilterMode}
                catTotals={catTotals}
                allCoursesLength={curatedCourses.length}
                className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--canvas)] px-2 py-1.5 text-xs text-[var(--ink)] outline-none sm:min-w-[14rem]"
              />
            ) : null}
          </div>

          {coursesError ? (
            <div className="whitespace-pre-line rounded-xl border border-red-400/30 bg-red-50/60 px-4 py-3 text-sm leading-relaxed text-red-700">
              {coursesError}
            </div>
          ) : null}

          {bulkGbSummary ? (
            <div
              className={`rounded-xl border px-4 py-2.5 text-xs leading-relaxed ${
                bulkGbSummary.variant === "warning"
                  ? "border-amber-400/40 bg-amber-50/80 text-amber-950"
                  : "border-emerald-400/40 bg-emerald-50/80 text-emerald-950"
              }`}
            >
              {bulkGbSummary.text}
            </div>
          ) : null}

          {/* Two-column: course list + gradebook */}
          {displayedCourses.length > 0 ? (
            <div className="flex w-full flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row">
              {/* Course sidebar — scroll interno en móvil; en lg comparte alto con gradebook */}
              <aside className="flex max-h-[min(50vh,20rem)] min-h-0 shrink-0 flex-col lg:max-h-none lg:w-72 lg:self-stretch">
                <div className="mb-2 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                      Cursos ({displayedCourses.length})
                    </p>
                    {gbFetched ? (
                      <span className="shrink-0 text-[11px] text-[var(--ink-faint)]">
                        Sync: {relativeTime(gbFetched)}
                      </span>
                    ) : null}
                  </div>
                  <select
                    value={gbSortMode}
                    onChange={(e) =>
                      setGbSortMode(e.target.value as GradebookSortMode)
                    }
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--canvas)] px-2 py-1.5 text-xs text-[var(--ink)] outline-none"
                    aria-label="Ordenar gradebook"
                    title="Ordenar gradebook"
                  >
                    <option value="none">Orden: por defecto</option>
                    <option value="deadline-asc">Orden: deadline (más próximo)</option>
                    <option value="deadline-desc">Orden: deadline (más lejano)</option>
                    <option value="submission-status">
                      Orden: estado entrega (rojo → amarillo → verde)
                    </option>
                  </select>
                  <button
                    type="button"
                    onClick={() => void refreshAllGradebooks()}
                    disabled={
                      !config || bulkGbLoading || coursesLoading || gbLoading
                    }
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] disabled:opacity-50"
                    title={
                      config
                        ? "Actualizar todos los gradebooks"
                        : "Conecta Blackboard en Ajustes para actualizar"
                    }
                    aria-label="Actualizar todos los gradebooks"
                  >
                    <IconRefresh
                      className={`h-4 w-4 ${bulkGbLoading ? "animate-spin" : ""}`}
                    />
                    Sync gradebooks
                  </button>
                  <CourseFilterSelect
                    id="bb-course-filter"
                    value={filterMode}
                    onChange={setFilterMode}
                    catTotals={catTotals}
                    allCoursesLength={curatedCourses.length}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--canvas)] px-2 py-1.5 text-xs text-[var(--ink)] outline-none"
                  />
                </div>
                <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-sm">
                  {displayedCourses.map((c) => {
                    const active = selectedCourseId === c.learnCourseId;
                    return (
                      <button
                        key={c.learnCourseId}
                        type="button"
                        onClick={() =>
                          handleSelectCourse(c.learnCourseId)
                        }
                        className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                          active
                            ? "bg-[var(--ink)] text-white"
                            : "text-[var(--ink)] hover:bg-[var(--surface-muted)]"
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {c.name}
                        </span>
                        {c.category ? (
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                              active
                                ? "bg-white/20 text-white/80"
                                : "bg-[var(--surface-muted)] text-[var(--ink-faint)]"
                            }`}
                          >
                            {c.category}
                          </span>
                        ) : null}
                        <IconChevron
                          className={`h-4 w-4 shrink-0 transition ${
                            active
                              ? "-rotate-90 text-white/70"
                              : "text-[var(--ink-faint)]"
                          }`}
                        />
                      </button>
                    );
                  })}
                </nav>
              </aside>

              {/* Gradebook: alto natural en móvil (scroll página); flex en lg */}
              <div className="flex min-w-0 flex-col lg:min-h-0 lg:min-w-0 lg:flex-1">
                {selectedCourseId ? (
                  <>
                    <div className="mb-3 flex flex-wrap items-center gap-3">
                      <div className="ml-auto flex items-center gap-2">
                        {gbProgress ? (
                          <span className="text-[11px] text-[var(--ink-muted)]">
                            {gbProgress}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {gradesLoadFailed ? (
                      <div className="mb-3 rounded-xl border border-amber-400/40 bg-amber-50/70 px-4 py-2.5 text-xs leading-relaxed text-amber-900">
                        No se pudieron cargar tus calificaciones desde la API interna
                        (<code className="font-mono-cli text-[10px]">/gradebook/grades</code>
                        ). Solo ves el máximo por ítem. Recarga Blackboard e inténtalo de nuevo.
                      </div>
                    ) : null}

                    {gbError ? (
                      <div className="mb-3 whitespace-pre-line rounded-xl border border-red-400/30 bg-red-50/60 px-4 py-3 text-sm leading-relaxed text-red-700">
                        {gbError}
                        <button
                          type="button"
                          onClick={() =>
                            fetchGradebookForCourse(selectedCourseId)
                          }
                          className="ml-3 underline"
                        >
                          Reintentar
                        </button>
                      </div>
                    ) : null}

                    {gradebook.length === 0 && !gbLoading && gbFetched ? (
                      <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-10 text-center text-sm text-[var(--ink-muted)]">
                        Este curso no tiene columnas en el gradebook.
                      </div>
                    ) : null}

                    {gradebook.length === 0 && !gbLoading && !gbFetched ? (
                      <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-10 text-center text-sm text-[var(--ink-muted)]">
                        {config ? (
                          <>
                            Pulsa &quot;Cargar gradebook&quot; para obtener las
                            columnas de este curso.
                          </>
                        ) : (
                          <>
                            No hay gradebook en caché para este curso. Espera la
                            sincronización en la nube o configura Blackboard en
                            Ajustes para descargarlo aquí.
                          </>
                        )}
                      </div>
                    ) : null}

                    {gradebook.length > 0 ? (
                      <div className="overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_16px_40px_-18px_rgba(2,6,23,0.35)] ring-1 ring-black/[0.02] lg:min-h-0 lg:flex-1">
                        <div className="w-full overflow-x-auto lg:min-h-0 lg:h-full lg:overflow-y-auto">
                          <table className="table-fixed w-full min-w-0 text-[13px]">
                            <thead className="sticky top-0 z-10 border-b border-[var(--border)] bg-[color:color-mix(in_srgb,var(--surface-muted)_84%,white)]/95 backdrop-blur">
                              <tr>
                                <th className="w-[46%] px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-muted)]">
                                  Nombre
                                </th>
                                <th className="w-[18%] px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-muted)]">
                                  Fecha límite
                                </th>
                                <th className="w-[17%] px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-muted)]">
                                  Nota / máx.
                                </th>
                                <th
                                  className="w-[11%] px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-muted)]"
                                  title="Rojo: no abierto · Amarillo: no entregado (borrador) · Verde: entregado"
                                >
                                  Entrega
                                </th>
                                <th className="w-[8%] px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-muted)]">
                                  Abrir
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border)]/80">
                              {sortedGradebook.map((col) => {
                                const due = col.grading?.due;
                                const colName =
                                  col.displayName ??
                                  col.name ??
                                  col.id;
                                const link = resolveGradebookColumnUltraUrl(
                                  selectedCourseId,
                                  col,
                                  {
                                    gradebookCategoryTitles:
                                      gradebookCategoryTitlesForLinks,
                                  },
                                );
                                return (
                                  <tr
                                    key={col.id}
                                    className="transition-colors hover:bg-[color:color-mix(in_srgb,var(--surface-muted)_62%,white)]"
                                  >
                                    <td className="px-3 py-3 align-middle overflow-hidden">
                                      <div className="w-full truncate text-[13px] font-semibold text-[var(--ink)]" title={colName}>
                                        {colName}
                                      </div>
                                    </td>
                                    <td className="w-full whitespace-nowrap px-3 py-3 align-middle text-[var(--ink-muted)] overflow-hidden">
                                      <div className="w-full overflow-hidden">
                                        <span
                                          className="inline-flex max-w-full items-center truncate rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-0.5 text-[11px] font-medium"
                                          title={formatDueDate(due)}
                                        >
                                          {formatDueDate(due)}
                                        </span>
                                      </div>
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-3 text-right align-middle tabular-nums text-[var(--ink)] overflow-hidden">
                                      <div className="truncate">{formatGradePointsCell(col)}</div>
                                    </td>
                                    <td className="px-3 py-3 text-center align-middle">
                                      <div className="flex justify-center">
                                        <SubmissionStatusIndicator
                                          reason={col.submissionReason}
                                          submitted={col.submissionSubmitted}
                                          labelEs={col.submissionLabelEs ?? undefined}
                                        />
                                      </div>
                                    </td>
                                    <td className="px-3 py-3 text-center align-middle">
                                      <a
                                        href={link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--ink)] transition hover:bg-white"
                                        title="Abrir en Blackboard"
                                      >
                                        <IconExternal className="h-3.5 w-3.5" />
                                        <span className="sr-only">Abrir en Blackboard</span>
                                      </a>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="flex min-h-[12rem] items-center justify-center rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)]">
                    <p className="text-sm text-[var(--ink-muted)]">
                      Selecciona un curso de la lista para ver su gradebook.
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : allCourses.length === 0 && !coursesLoading ? (
            <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-14 text-center text-sm text-[var(--ink-muted)]">
              {coursesFetched
                ? "Ningún curso coincide con el filtro. Prueba «Todos los cursos» en el desplegable."
                : config
                  ? "Pulsa «Cargar cursos» (con Blackboard abierto en otra pestaña)."
                  : "No hay cursos en la caché. Inicia sesión y espera la sincronización en la nube, o configura Blackboard en Ajustes."}
            </div>
          ) : displayedCourses.length === 0 &&
            curatedCourses.length > 0 &&
            !coursesLoading ? (
            <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-10 text-center text-sm text-[var(--ink-muted)]">
              Ningún curso clasificado como Q1 o Q2 (puede que los términos no contengan «FIRST Q1» / «FIRST Q2»).
              Cambia a «Todos los cursos» en el desplegable para ver el listado completo.
            </div>
          ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
