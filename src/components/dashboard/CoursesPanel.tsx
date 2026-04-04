"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BbCourseItem } from "@/types/blackboard";
import { courseAccentFromId } from "@/lib/course-avatar";
import { addDroppedFilesToCourse, purgeCourseBlobs } from "@/lib/course-mutations";
import {
  loadManualCourses,
  ensureManualCourseForBbLearnId,
} from "@/lib/manual-courses-storage";
import { BB_COURSES_STORAGE_CHANGED } from "@/lib/blackboard-storage";
import {
  courseCategoryTotals,
  filterCoursesByMode,
  type CourseFilterMode,
} from "@/lib/blackboard-api";
import {
  applyBbCourseCuration,
  BB_COURSE_CURATION_CHANGED,
  confirmAddBbCourseFromList,
  hideLearnCourseId,
  loadBbCourseCuration,
  resolveAddCourseByName,
  saveBbCourseCuration,
  unhideLearnCourseId,
} from "@/lib/bb-course-curation";
import { readBbDisplayedCoursesSnapshot } from "@/lib/bb-displayed-courses";
import {
  BB_COURSE_FILTER_CHANGED,
  loadCourseFilterMode,
  saveCourseFilterMode,
} from "@/lib/bb-course-filter-prefs";
import { CourseFilterSelect } from "./CourseFilterSelect";
import { CourseGlyph } from "./CourseGlyph";

const rowClass =
  "flex w-full min-h-[3.25rem] min-w-0 items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3";

export function CoursesPanel() {
  const [hydrated, setHydrated] = useState(false);
  const [hasConfig, setHasConfig] = useState(false);
  const [apiCourses, setApiCourses] = useState<BbCourseItem[]>([]);
  const [curation, setCuration] = useState(loadBbCourseCuration);
  const [filterMode, setFilterModeState] = useState<CourseFilterMode>(() =>
    loadCourseFilterMode(),
  );
  const [dragOverCourseId, setDragOverCourseId] = useState<string | null>(null);
  const [addByName, setAddByName] = useState("");
  const [addPickCandidates, setAddPickCandidates] = useState<BbCourseItem[] | null>(
    null,
  );
  const [addFeedback, setAddFeedback] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const setFilterMode = useCallback((m: CourseFilterMode) => {
    setFilterModeState(m);
    saveCourseFilterMode(m);
  }, []);

  const refreshFromStorage = useCallback(() => {
    const snap = readBbDisplayedCoursesSnapshot();
    setHasConfig(snap.hasConfig);
    setApiCourses(snap.apiCourses);
    setCuration(snap.curation);
    setFilterModeState(snap.filterMode);
  }, []);

  useEffect(() => {
    refreshFromStorage();
    setHydrated(true);
  }, [refreshFromStorage]);

  useEffect(() => {
    const onStorage = () => refreshFromStorage();
    window.addEventListener(BB_COURSES_STORAGE_CHANGED, onStorage);
    window.addEventListener(BB_COURSE_CURATION_CHANGED, onStorage);
    window.addEventListener(BB_COURSE_FILTER_CHANGED, onStorage);
    return () => {
      window.removeEventListener(BB_COURSES_STORAGE_CHANGED, onStorage);
      window.removeEventListener(BB_COURSE_CURATION_CHANGED, onStorage);
      window.removeEventListener(BB_COURSE_FILTER_CHANGED, onStorage);
    };
  }, [refreshFromStorage]);

  const curatedCourses = useMemo(
    () => applyBbCourseCuration(apiCourses, curation),
    [apiCourses, curation],
  );

  const displayedCourses = useMemo(
    () => filterCoursesByMode(curatedCourses, filterMode),
    [curatedCourses, filterMode],
  );

  const catTotals = useMemo(
    () => courseCategoryTotals(curatedCourses),
    [curatedCourses],
  );

  const hiddenIds = curation.hiddenLearnCourseIds;

  const persistCuration = useCallback((next: ReturnType<typeof loadBbCourseCuration>) => {
    setCuration(next);
    saveBbCourseCuration(next);
  }, []);

  function handleRemove(learnCourseId: string) {
    void (async () => {
      const manual = loadManualCourses().find((c) => c.id === learnCourseId);
      if (manual) await purgeCourseBlobs(manual);
      persistCuration(hideLearnCourseId(apiCourses, curation, learnCourseId));
    })();
  }

  function handleRestoreHidden(id: string) {
    persistCuration(unhideLearnCourseId(curation, id));
  }

  function handleAddByNameSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAddFeedback(null);
    setAddPickCandidates(null);
    const result = resolveAddCourseByName(
      apiCourses,
      curation,
      displayedCourses,
      addByName,
      filterMode,
    );
    if (result.status === "noop") {
      setAddFeedback(result.message);
      return;
    }
    if (result.status === "choose") {
      setAddPickCandidates(result.candidates);
      return;
    }
    persistCuration(result.curation);
    setAddByName("");
  }

  function handlePickCandidate(picked: BbCourseItem) {
    setAddPickCandidates(null);
    setAddFeedback(null);
    persistCuration(confirmAddBbCourseFromList(curation, picked));
    setAddByName("");
  }

  async function handleDropFiles(learnCourseId: string, name: string, files: File[]) {
    ensureManualCourseForBbLearnId(learnCourseId, name);
    await addDroppedFilesToCourse(learnCourseId, files, null);
  }

  function courseDropProps(learnCourseId: string, displayName: string) {
    return {
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      },
      onDragEnter: (e: React.DragEvent) => {
        e.preventDefault();
        setDragOverCourseId(learnCourseId);
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setDragOverCourseId(null);
        }
      },
      onDrop: async (e: React.DragEvent) => {
        e.preventDefault();
        setDragOverCourseId(null);
        const { files } = e.dataTransfer;
        if (files?.length) {
          await handleDropFiles(learnCourseId, displayName, Array.from(files));
        }
      },
    };
  }

  const inputClass =
    "min-w-0 rounded-lg border border-transparent bg-[var(--canvas)] px-2.5 py-1.5 text-sm text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-faint)] focus:border-[var(--border)]";

  if (!hydrated) {
    return (
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col px-4 py-6 md:px-10 md:py-8">
        <p className="text-sm text-[var(--ink-muted)]">Cargando…</p>
      </div>
    );
  }

  if (!hasConfig) {
    return (
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col px-4 py-6 md:px-10 md:py-8">
        <header className="shrink-0">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Courses
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">
            Tus asignaturas
          </h1>
          <p className="mt-2 max-w-xl text-sm text-[var(--ink-muted)]">
            Conecta Blackboard en la pestaña <strong className="text-[var(--ink)]">Assignments</strong>{" "}
            y pulsa «Cargar cursos». Aquí verás los mismos cursos detectados y podrás ocultarlos o añadir
            uno por su ID si no aparece en la lista.
          </p>
        </header>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col px-4 py-6 md:px-10 md:py-8">
      <header className="shrink-0">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
          Courses
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">
          Tus asignaturas
        </h1>
        <p className="mt-2 max-w-xl text-sm text-[var(--ink-muted)]">
          Misma lista que en Assignments y Documentos (caché de Blackboard).{" "}
          <strong className="text-[var(--ink)]">Quitar</strong> oculta el curso en todas las pestañas; puedes
          restaurarlo abajo. <strong className="text-[var(--ink)]">Añadir</strong>: escribe el nombre del curso
          (se busca en la caché) o se crea uno solo local si no hay coincidencia. Puedes soltar archivos sobre
          una fila (almacenamiento local).
        </p>
      </header>

      <section
        className="mt-8 min-h-0 w-full min-w-0 flex-1"
        aria-labelledby="courses-list-heading"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2
            id="courses-list-heading"
            className="text-sm font-semibold text-[var(--ink)]"
          >
            Lista de cursos ({displayedCourses.length})
          </h2>
          <CourseFilterSelect
            id="courses-bb-filter"
            value={filterMode}
            onChange={setFilterMode}
            catTotals={catTotals}
            allCoursesLength={curatedCourses.length}
          />
        </div>

        {apiCourses.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--ink-muted)]">
            Aún no hay cursos en caché. Abre <strong className="text-[var(--ink)]">Assignments</strong> y pulsa
            «Cargar cursos» con la sesión de Blackboard activa.
          </p>
        ) : (
          <ul className="mt-4 w-full min-w-0 space-y-2">
            {displayedCourses.map((c) => (
              <li
                key={c.learnCourseId}
                className={`${rowClass} transition ${
                  dragOverCourseId === c.learnCourseId
                    ? "ring-2 ring-[var(--ink)] ring-offset-2 ring-offset-[var(--canvas)]"
                    : ""
                }`}
                {...courseDropProps(c.learnCourseId, c.name)}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] text-[var(--ink)]"
                    style={{ backgroundColor: courseAccentFromId(c.learnCourseId) }}
                    aria-hidden
                  >
                    <CourseGlyph courseId={c.learnCourseId} className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-[var(--ink)]">{c.name}</p>
                    <p className="mt-0.5 font-mono-cli text-[10px] text-[var(--ink-muted)]">
                      {c.learnCourseId}
                      {c.category ? (
                        <span className="ml-2 rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[var(--ink-faint)]">
                          {c.category}
                        </span>
                      ) : null}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(c.learnCourseId)}
                  className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-muted)] transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
                  aria-label={`Quitar ${c.name} de la lista`}
                >
                  Quitar
                </button>
              </li>
            ))}

            <li className={`${rowClass} flex-col items-stretch gap-3`}>
              <form
                className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-center"
                onSubmit={handleAddByNameSubmit}
              >
                <input
                  type="text"
                  value={addByName}
                  onChange={(e) => {
                    setAddByName(e.target.value);
                    setAddFeedback(null);
                    setAddPickCandidates(null);
                  }}
                  placeholder="Nombre del curso (búsqueda en la caché)"
                  maxLength={120}
                  spellCheck={true}
                  autoComplete="off"
                  className={`${inputClass} min-w-0 flex-1`}
                  aria-label="Nombre del curso a añadir"
                />
                <button
                  type="submit"
                  disabled={!addByName.trim()}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--ink)] text-xl font-light leading-none text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
                  aria-label="Añadir curso"
                  title="Añadir curso"
                >
                  +
                </button>
              </form>
              {addFeedback ? (
                <p className="text-xs text-amber-800 dark:text-amber-200/90">{addFeedback}</p>
              ) : null}
              {addPickCandidates && addPickCandidates.length > 0 ? (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)]/40 p-3">
                  <p className="text-xs font-semibold text-[var(--ink-muted)]">
                    Varios cursos coinciden — elige uno:
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {addPickCandidates.map((c) => (
                      <li key={c.learnCourseId}>
                        <button
                          type="button"
                          onClick={() => handlePickCandidate(c)}
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left text-sm text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                        >
                          <span className="font-medium">{c.name}</span>
                          <span className="mt-0.5 block font-mono-cli text-[10px] text-[var(--ink-muted)]">
                            {c.learnCourseId}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </li>
          </ul>
        )}

        {hiddenIds.length > 0 ? (
          <div className="mt-6 border-t border-[var(--border)] pt-4">
            <button
              type="button"
              onClick={() => setShowHidden((v) => !v)}
              className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
            >
              {showHidden ? "Ocultar" : "Mostrar"} cursos quitados ({hiddenIds.length})
            </button>
            {showHidden ? (
              <ul className="mt-3 space-y-1.5 text-sm">
                {hiddenIds.map((id) => (
                  <li
                    key={id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)]/40 px-3 py-2"
                  >
                    <span className="min-w-0 truncate font-mono-cli text-xs text-[var(--ink-muted)]">
                      {id}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRestoreHidden(id)}
                      className="shrink-0 rounded-md border border-[var(--border)] px-2 py-1 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--surface)]"
                    >
                      Restaurar
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
