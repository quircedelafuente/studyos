"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import type { GoogleCalendarEventItem } from "@/lib/google-calendar-types";
import type { BbCourseItem } from "@/types/blackboard";
import { parseGoogleDateTimeToJsDate } from "@/lib/google-event-datetime";
import { readBbDisplayedCoursesSnapshot } from "@/lib/bb-displayed-courses";
import { BB_COURSES_STORAGE_CHANGED } from "@/lib/blackboard-storage";
import { BB_COURSE_CURATION_CHANGED } from "@/lib/bb-course-curation";
import { BB_COURSE_FILTER_CHANGED } from "@/lib/bb-course-filter-prefs";
import {
  CLASS_NOTES_CHANGED_EVENT,
  CLASS_NOTES_MAX_SESSIONS,
  UNASSIGNED_COURSE_KEY,
  addEmptySession,
  googleEventKey,
  isTimedClassNotesEvent,
  loadClassNotes,
  parseSessionNumberFromSummary,
  removeSessions,
  saveClassNotes,
  syncClassNotesBucketsFromGoogleEvents,
  updateSessionLabel,
  type ClassNotesState,
} from "@/lib/class-notes-storage";
import { CourseGlyph } from "./CourseGlyph";
import { IconPlus } from "./icons";

type ViewMode = "dias" | "cursos";

function eventLocalDayKey(ev: GoogleCalendarEventItem): string | null {
  const d = parseGoogleDateTimeToJsDate(
    ev.start?.dateTime,
    ev.start?.timeZone,
  );
  if (d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  const dateOnly = ev.start?.date?.trim();
  if (dateOnly && /^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return dateOnly;
  return null;
}

function formatDayHeading(dayKey: string): string {
  const d = new Date(`${dayKey}T12:00:00`);
  return d.toLocaleDateString("es", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatEventTime(ev: GoogleCalendarEventItem): string {
  const d = parseGoogleDateTimeToJsDate(
    ev.start?.dateTime,
    ev.start?.timeZone,
  );
  if (!d) return "";
  return d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

function SessionLabelInput({
  label,
  onCommit,
  idx,
}: {
  label: string;
  onCommit: (next: string) => void;
  idx: number;
}) {
  const [v, setV] = useState(label);
  useEffect(() => {
    setV(label);
  }, [label]);
  return (
    <input
      type="text"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const t = v.trim();
        if (t !== label.trim()) onCommit(t || "Sesión");
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="min-w-0 flex-1 rounded-lg border border-transparent bg-[var(--canvas)] px-2 py-2 text-sm font-medium text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none"
      aria-label={`Nombre sesión ${idx + 1}`}
    />
  );
}

export function ClassNotesPanel() {
  const { status, data: session } = useSession();
  const [viewMode, setViewMode] = useState<ViewMode>("dias");
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonthIndex, setViewMonthIndex] = useState(() =>
    new Date().getMonth(),
  );
  const [googleEvents, setGoogleEvents] = useState<GoogleCalendarEventItem[]>(
    [],
  );
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [notesRevision, setNotesRevision] = useState(0);
  const [coursesSnap, setCoursesSnap] = useState(readBbDisplayedCoursesSnapshot);
  const [expandedCourse, setExpandedCourse] = useState<Record<string, boolean>>(
    {},
  );
  const [selectedByCourse, setSelectedByCourse] = useState<
    Record<string, Set<string>>
  >({});

  const refreshCourses = useCallback(() => {
    setCoursesSnap(readBbDisplayedCoursesSnapshot());
  }, []);

  useEffect(() => {
    refreshCourses();
  }, [refreshCourses]);

  useEffect(() => {
    const onStorage = () => refreshCourses();
    window.addEventListener(BB_COURSES_STORAGE_CHANGED, onStorage);
    window.addEventListener(BB_COURSE_CURATION_CHANGED, onStorage);
    window.addEventListener(BB_COURSE_FILTER_CHANGED, onStorage);
    return () => {
      window.removeEventListener(BB_COURSES_STORAGE_CHANGED, onStorage);
      window.removeEventListener(BB_COURSE_CURATION_CHANGED, onStorage);
      window.removeEventListener(BB_COURSE_FILTER_CHANGED, onStorage);
    };
  }, [refreshCourses]);

  useEffect(() => {
    const onNotes = () => setNotesRevision((n) => n + 1);
    window.addEventListener(CLASS_NOTES_CHANGED_EVENT, onNotes);
    return () => window.removeEventListener(CLASS_NOTES_CHANGED_EVENT, onNotes);
  }, []);

  /** Rango fijo para Class Notes: 1 ene → 30 jun (año en curso), todas las sesiones con hora. */
  const loadEvents = useCallback(async () => {
    if (status !== "authenticated" || session?.error === "RefreshAccessTokenError") {
      return;
    }
    setLoading(true);
    setFetchError(null);
    try {
      const params = new URLSearchParams();
      const y = new Date().getFullYear();
      const from = new Date(y, 0, 1, 0, 0, 0, 0);
      const to = new Date(y, 5, 30, 23, 59, 59, 999);
      params.set("from", from.toISOString());
      params.set("to", to.toISOString());
      const res = await fetch(`/api/calendar/events?${params}`, {
        credentials: "include",
      });
      const data = (await res.json()) as {
        events?: GoogleCalendarEventItem[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "No se pudieron cargar los eventos");
      setGoogleEvents(data.events ?? []);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Error de red");
      setGoogleEvents([]);
    } finally {
      setLoading(false);
    }
  }, [status, session?.error]);

  useEffect(() => {
    if (status === "authenticated") void loadEvents();
    else {
      setGoogleEvents([]);
      setFetchError(null);
    }
  }, [status, loadEvents]);

  const timedInMonth = useMemo(() => {
    return googleEvents.filter((ev) => {
      if (!isTimedClassNotesEvent(ev)) return false;
      const key = eventLocalDayKey(ev);
      if (!key) return false;
      const [y, m] = key.split("-").map(Number);
      if (y !== viewYear || m !== viewMonthIndex + 1) return false;
      return true;
    });
  }, [googleEvents, viewYear, viewMonthIndex]);

  const daysGrouped = useMemo(() => {
    const map = new Map<string, GoogleCalendarEventItem[]>();
    for (const ev of timedInMonth) {
      const key = eventLocalDayKey(ev);
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(ev);
      map.set(key, list);
    }
    for (const [, list] of map) {
      list.sort(
        (a, b) =>
          (parseGoogleDateTimeToJsDate(a.start?.dateTime, a.start?.timeZone)?.getTime() ?? 0) -
          (parseGoogleDateTimeToJsDate(b.start?.dateTime, b.start?.timeZone)?.getTime() ?? 0),
      );
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [timedInMonth]);

  const displayedCourses = coursesSnap.displayedCourses;

  const courseSeedSignature = useMemo(
    () =>
      displayedCourses
        .map((c) => `${c.learnCourseId}\t${c.name}`)
        .sort()
        .join("\n"),
    [displayedCourses],
  );

  useEffect(() => {
    if (status !== "authenticated" || !googleEvents.length) return;
    const prev = loadClassNotes();
    const { state: next, changed } = syncClassNotesBucketsFromGoogleEvents(
      prev,
      googleEvents,
      displayedCourses.map((c) => ({
        learnCourseId: c.learnCourseId,
        name: c.name,
      })),
    );
    if (changed) saveClassNotes(next);
  }, [googleEvents, status, courseSeedSignature, displayedCourses]);

  const notesState = useMemo(() => loadClassNotes(), [notesRevision]);

  const courseSections = useMemo(() => {
    const rows: {
      key: string;
      name: string;
      course?: BbCourseItem;
      isUnassigned: boolean;
    }[] = displayedCourses.map((c) => ({
      key: c.learnCourseId,
      name: c.name,
      course: c,
      isUnassigned: false,
    }));
    if (
      Object.prototype.hasOwnProperty.call(
        notesState.byCourse,
        UNASSIGNED_COURSE_KEY,
      )
    ) {
      rows.push({
        key: UNASSIGNED_COURSE_KEY,
        name: "Sin asignar (calendario)",
        isUnassigned: true,
      });
    }
    return rows;
  }, [displayedCourses, notesState.byCourse]);

  function patchNotes(updater: (s: ClassNotesState) => ClassNotesState) {
    const prev = loadClassNotes();
    const next = updater(prev);
    saveClassNotes(next);
    setNotesRevision((n) => n + 1);
  }

  function toggleExpanded(key: string) {
    setExpandedCourse((e) => ({ ...e, [key]: !e[key] }));
  }

  function toggleSelect(courseKey: string, sessionId: string) {
    setSelectedByCourse((prev) => {
      const cur = new Set(prev[courseKey] ?? []);
      if (cur.has(sessionId)) cur.delete(sessionId);
      else cur.add(sessionId);
      return { ...prev, [courseKey]: cur };
    });
  }

  function selectAllInCourse(courseKey: string, ids: string[]) {
    setSelectedByCourse((prev) => ({
      ...prev,
      [courseKey]: new Set(ids),
    }));
  }

  function clearSelection(courseKey: string) {
    setSelectedByCourse((prev) => ({ ...prev, [courseKey]: new Set() }));
  }

  function deleteSelected(courseKey: string) {
    const sel = selectedByCourse[courseKey];
    if (!sel?.size) return;
    patchNotes((s) => removeSessions(courseKey, sel, s));
    clearSelection(courseKey);
  }

  const monthLabel = new Date(viewYear, viewMonthIndex, 1).toLocaleDateString(
    "es",
    { month: "long", year: "numeric" },
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--canvas)]">
      <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-4 md:px-6">
        <h1 className="text-xl font-black tracking-tight text-[var(--ink)] md:text-2xl">
          Class Notes
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">
          Carga eventos con hora desde el 1 de enero hasta el 30 de junio del
          año actual. Por curso, las sesiones siguen el número en el título
          (p. ej. «Sesión 3», «S3») y luego la fecha. El nombre del curso debe
          aparecer en el título del evento para asignarlo.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="inline-flex rounded-xl border border-[var(--border)] bg-[var(--canvas)] p-1">
            <button
              type="button"
              onClick={() => setViewMode("dias")}
              className={`min-h-[40px] flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition sm:flex-none ${
                viewMode === "dias"
                  ? "bg-[var(--ink)] text-white"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
              }`}
            >
              Por días
            </button>
            <button
              type="button"
              onClick={() => setViewMode("cursos")}
              className={`min-h-[40px] flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition sm:flex-none ${
                viewMode === "cursos"
                  ? "bg-[var(--ink)] text-white"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
              }`}
            >
              Por curso
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="min-h-[40px] rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-muted)]"
              onClick={() => {
                const d = new Date(viewYear, viewMonthIndex - 1, 1);
                setViewYear(d.getFullYear());
                setViewMonthIndex(d.getMonth());
              }}
            >
              ← Mes
            </button>
            <span className="min-w-[10rem] text-center text-sm font-bold capitalize text-[var(--ink)]">
              {monthLabel}
            </span>
            <button
              type="button"
              className="min-h-[40px] rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-muted)]"
              onClick={() => {
                const d = new Date(viewYear, viewMonthIndex + 1, 1);
                setViewYear(d.getFullYear());
                setViewMonthIndex(d.getMonth());
              }}
            >
              Mes →
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-6">
        {status !== "authenticated" ? (
          <p className="text-sm text-[var(--ink-muted)]">
            Inicia sesión con Google para ver el calendario.
          </p>
        ) : loading && !googleEvents.length ? (
          <p className="text-sm text-[var(--ink-muted)]">Cargando eventos…</p>
        ) : fetchError ? (
          <p className="text-sm text-red-600">{fetchError}</p>
        ) : viewMode === "dias" ? (
          <div className="space-y-6">
            {daysGrouped.length === 0 ? (
              <p className="text-sm text-[var(--ink-muted)]">
                No hay sesiones con hora en este mes. Cambia de mes o añade
                eventos en Google Calendar.
              </p>
            ) : (
              daysGrouped.map(([dayKey, events]) => (
                <section
                  key={dayKey}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm"
                >
                  <h2 className="text-sm font-extrabold capitalize text-[var(--ink)]">
                    {formatDayHeading(dayKey)}
                  </h2>
                  <ul className="mt-3 space-y-2">
                    {events.map((ev) => (
                      <li
                        key={googleEventKey(ev)}
                        className="flex min-h-[44px] items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-3"
                      >
                        <span className="shrink-0 text-xs font-semibold tabular-nums text-[var(--ink-faint)]">
                          {formatEventTime(ev) || "—"}
                        </span>
                        <span className="min-w-0 flex-1 text-sm font-medium text-[var(--ink)]">
                          {ev.summary?.trim() || "(Sin título)"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {courseSections.length === 0 ? (
              <p className="text-sm text-[var(--ink-muted)]">
                No hay cursos en IEStudio. Configura cursos en la sección Courses
                para agrupar sesiones; mientras tanto usa la vista «Por días».
              </p>
            ) : (
              courseSections.map((section) => {
                const bucket = notesState.byCourse[section.key];
                const sessions = bucket?.sessions ?? [];
                const open = expandedCourse[section.key] ?? false;
                const selected = selectedByCourse[section.key] ?? new Set();
                return (
                  <div
                    key={section.key}
                    className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm"
                  >
                    <button
                      type="button"
                      onClick={() => toggleExpanded(section.key)}
                      className="flex min-h-[48px] w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[var(--surface-muted)]"
                    >
                      {section.course ? (
                        <CourseGlyph
                          courseId={section.course.learnCourseId}
                          className="h-9 w-9 shrink-0 text-[var(--ink)]"
                        />
                      ) : (
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-[var(--border)] text-xs font-bold text-[var(--ink-muted)]">
                          ?
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="block truncate font-bold text-[var(--ink)]">
                          {section.name}
                        </span>
                        <span className="text-xs text-[var(--ink-muted)]">
                          {sessions.length} sesión{sessions.length === 1 ? "" : "es"}
                          {sessions.length >= CLASS_NOTES_MAX_SESSIONS ? " (tope)" : ""}
                        </span>
                      </div>
                      <span className="text-[var(--ink-muted)]">
                        {open ? "▼" : "▶"}
                      </span>
                    </button>
                    {open ? (
                      <div className="border-t border-[var(--border)] bg-[var(--canvas)] px-3 py-3">
                        <div className="mb-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-[var(--ink)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
                            disabled={sessions.length >= CLASS_NOTES_MAX_SESSIONS}
                            onClick={() =>
                              patchNotes((s) =>
                                addEmptySession(section.key, s),
                              )
                            }
                          >
                            <IconPlus className="h-4 w-4" />
                            Añadir sesión
                          </button>
                          {sessions.length > 0 ? (
                            <>
                              <button
                                type="button"
                                className="min-h-[40px] rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-muted)]"
                                onClick={() =>
                                  selectAllInCourse(
                                    section.key,
                                    sessions.map((s) => s.id),
                                  )
                                }
                              >
                                Seleccionar todas
                              </button>
                              <button
                                type="button"
                                className="min-h-[40px] rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--ink-muted)] hover:bg-[var(--surface-muted)]"
                                onClick={() => clearSelection(section.key)}
                              >
                                Limpiar selección
                              </button>
                              <button
                                type="button"
                                className="min-h-[40px] rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-40 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
                                disabled={!selected.size}
                                onClick={() => deleteSelected(section.key)}
                              >
                                Eliminar seleccionadas ({selected.size})
                              </button>
                            </>
                          ) : null}
                        </div>
                        {sessions.length === 0 ? (
                          <p className="text-sm text-[var(--ink-muted)]">
                            Sin sesiones. Añade una o sincroniza con eventos del
                            calendario que incluyan «{section.name}» en el
                            título.
                          </p>
                        ) : (
                          <ul className="space-y-2">
                            {sessions.map((row, idx) => {
                              const displayNum =
                                parseSessionNumberFromSummary(row.label) ??
                                idx + 1;
                              const ev = row.googleEventKey
                                ? timedInMonth.find(
                                    (e) => googleEventKey(e) === row.googleEventKey,
                                  ) ??
                                  googleEvents.find(
                                    (e) => googleEventKey(e) === row.googleEventKey,
                                  )
                                : undefined;
                              const when = ev
                                ? formatEventTime(ev) ||
                                  eventLocalDayKey(ev) ||
                                  ""
                                : "";
                              const isSel = selected.has(row.id);
                              return (
                                <li
                                  key={row.id}
                                  className={`flex min-h-[52px] flex-wrap items-center gap-2 rounded-xl border px-2 py-2 sm:flex-nowrap ${
                                    isSel
                                      ? "border-[var(--ink)] bg-[var(--surface)]"
                                      : "border-[var(--border)] bg-[var(--surface)]"
                                  }`}
                                >
                                  <label className="flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center">
                                    <input
                                      type="checkbox"
                                      checked={isSel}
                                      onChange={() =>
                                        toggleSelect(section.key, row.id)
                                      }
                                      className="h-5 w-5 rounded border-[var(--border)]"
                                    />
                                    <span className="sr-only">Seleccionar</span>
                                  </label>
                                  <span className="w-8 shrink-0 text-center text-xs font-bold text-[var(--ink-faint)]">
                                    {displayNum}
                                  </span>
                                  <SessionLabelInput
                                    label={row.label}
                                    idx={displayNum - 1}
                                    onCommit={(next) =>
                                      patchNotes((s) =>
                                        updateSessionLabel(
                                          section.key,
                                          row.id,
                                          next,
                                          s,
                                        ),
                                      )
                                    }
                                  />
                                  {when ? (
                                    <span className="shrink-0 text-xs text-[var(--ink-muted)]">
                                      {when}
                                    </span>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
