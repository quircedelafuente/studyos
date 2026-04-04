"use client";

import { signIn, useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { GoogleCalendarEventItem } from "@/lib/google-calendar-types";
import { getGoogleEventColorStyle } from "@/lib/google-calendar-event-colors";
import { mapGoogleEventsToMonthDays } from "@/lib/map-google-events-to-month";
import { monthGrid } from "@/lib/calendar-grid";
import {
  endOfWeekSunday,
  startOfWeekMonday,
  weekDayDates,
} from "@/lib/week-range";
import { WeekGoogleStyleGrid } from "@/components/dashboard/WeekGoogleStyleGrid";
import { CreateCalendarEventModal } from "@/components/dashboard/CreateCalendarEventModal";
import { IconPlus } from "@/components/dashboard/icons";
import {
  DEADLINE_CALENDAR_EVENT_ID_PREFIX,
  importantDeadlinesToCalendarEvents,
  LOCAL_DEADLINES_CALENDAR_ID,
} from "@/lib/deadlines-to-calendar-events";
import {
  DEADLINES_CHANGED_EVENT,
  DEADLINES_STORAGE_KEY,
  loadImportantDeadlines,
  saveImportantDeadlines,
} from "@/lib/deadlines-storage";
import { loadStudyPlans, STUDY_PLANS_CHANGED_EVENT } from "@/lib/study-plans-storage";
import {
  STUDY_PLAN_PREVIEW_CALENDAR_ID,
  studyPlanAiScheduleToCalendarEvents,
} from "@/lib/study-plans-calendar-events";

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

type CalendarViewMode = "month" | "week";

function ChevronLeft({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6" />
    </svg>
  );
}

function SyncIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

export function CalendarPanel() {
  const { data: session, status } = useSession();
  const now = new Date();
  const [viewMode, setViewMode] = useState<CalendarViewMode>("week");
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonthIndex, setViewMonthIndex] = useState(now.getMonth());
  const [weekStart, setWeekStart] = useState(() => startOfWeekMonday(now));
  const [googleEvents, setGoogleEvents] = useState<GoogleCalendarEventItem[]>([]);
  const [deadlinesRevision, setDeadlinesRevision] = useState(0);
  const [studyPlansRevision, setStudyPlansRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [createEventOpen, setCreateEventOpen] = useState(false);

  const grid = useMemo(
    () => monthGrid(viewYear, viewMonthIndex),
    [viewYear, viewMonthIndex],
  );

  const weekDates = useMemo(() => weekDayDates(weekStart), [weekStart]);

  const loadEvents = useCallback(async () => {
    if (status !== "authenticated" || session?.error === "RefreshAccessTokenError") {
      return;
    }
    setLoading(true);
    setFetchError(null);
    try {
      const params = new URLSearchParams();
      if (viewMode === "month") {
        params.set("year", String(viewYear));
        params.set("month", String(viewMonthIndex + 1));
      } else {
        const from = new Date(
          weekStart.getFullYear(),
          weekStart.getMonth(),
          weekStart.getDate(),
          0,
          0,
          0,
          0,
        );
        const to = endOfWeekSunday(weekStart);
        params.set("from", from.toISOString());
        params.set("to", to.toISOString());
      }
      const url = `/api/calendar/events?${params.toString()}`;
      const res = await fetch(url, { credentials: "include" });
      const data = (await res.json()) as {
        events?: GoogleCalendarEventItem[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? "No se pudieron cargar los eventos");
      }
      setGoogleEvents(data.events ?? []);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Error de red");
      setGoogleEvents([]);
    } finally {
      setLoading(false);
    }
  }, [
    status,
    session?.error,
    viewMode,
    viewYear,
    viewMonthIndex,
    weekStart,
  ]);

  useEffect(() => {
    if (status === "authenticated") {
      void loadEvents();
    } else {
      setGoogleEvents([]);
      setFetchError(null);
    }
  }, [status, loadEvents]);

  useEffect(() => {
    function bumpDeadlines() {
      setDeadlinesRevision((n) => n + 1);
    }
    window.addEventListener(DEADLINES_CHANGED_EVENT, bumpDeadlines);
    function onStorage(e: StorageEvent) {
      if (e.key === DEADLINES_STORAGE_KEY) bumpDeadlines();
    }
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(DEADLINES_CHANGED_EVENT, bumpDeadlines);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    function bumpPlans() {
      setStudyPlansRevision((n) => n + 1);
    }
    window.addEventListener(STUDY_PLANS_CHANGED_EVENT, bumpPlans);
    function onStorage(e: StorageEvent) {
      if (e.key === "iestudio-study-plans") bumpPlans();
    }
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(STUDY_PLANS_CHANGED_EVENT, bumpPlans);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const events = useMemo(() => {
    const fromStudyPlans = studyPlanAiScheduleToCalendarEvents(loadStudyPlans());
    const local = importantDeadlinesToCalendarEvents(loadImportantDeadlines());
    return [...fromStudyPlans, ...local, ...googleEvents];
  }, [googleEvents, deadlinesRevision, studyPlansRevision]);

  const byDay = useMemo(
    () => mapGoogleEventsToMonthDays(events, viewYear, viewMonthIndex),
    [events, viewYear, viewMonthIndex],
  );

  const handleDeleteEvent = useCallback(
    async (p: { eventId: string; calendarId: string }) => {
      const key = `${p.calendarId}\u0000${p.eventId}`;

      if (p.calendarId === STUDY_PLAN_PREVIEW_CALENDAR_ID) {
        window.alert(
          "Este bloque es la vista previa del plan en el Study Planner. Para quitarlo o editarlo, abre Study Planner; si ya usaste «Añadir al calendario», aparece como evento en «Exámenes y fechas».",
        );
        return;
      }

      if (p.calendarId === LOCAL_DEADLINES_CALENDAR_ID) {
        if (
          !window.confirm(
            "¿Eliminar este evento del calendario de la app? (también desaparece de «Exámenes y fechas»)",
          )
        ) {
          return;
        }
        setDeletingKey(key);
        try {
          let rawId = p.eventId;
          if (rawId.startsWith(DEADLINE_CALENDAR_EVENT_ID_PREFIX)) {
            rawId = rawId.slice(DEADLINE_CALENDAR_EVENT_ID_PREFIX.length);
          }
          const next = loadImportantDeadlines().filter((d) => d.id !== rawId);
          saveImportantDeadlines(next);
        } finally {
          setDeletingKey(null);
        }
        return;
      }

      if (
        !window.confirm(
          "¿Eliminar este evento de Google Calendar? Esta acción no se puede deshacer.",
        )
      ) {
        return;
      }
      setDeletingKey(key);
      setFetchError(null);
      try {
        const params = new URLSearchParams({
          calendarId: p.calendarId,
          eventId: p.eventId,
        });
        const res = await fetch(`/api/calendar/events?${params.toString()}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (!res.ok) {
          let message = "No se pudo eliminar el evento";
          const text = await res.text();
          try {
            const data = JSON.parse(text) as {
              error?: string;
              detail?: string;
            };
            message = data.detail ?? data.error ?? message;
          } catch {
            if (text) message = text.slice(0, 280);
          }
          throw new Error(message);
        }
        await loadEvents();
      } catch (e) {
        setFetchError(e instanceof Error ? e.message : "Error al eliminar");
      } finally {
        setDeletingKey(null);
      }
    },
    [loadEvents],
  );

  const handleMoveEvent = useCallback(
    (p: { eventId: string; newTime: string }) => {
      const all = loadImportantDeadlines();
      const idx = all.findIndex((d) => d.id === p.eventId);
      if (idx === -1) return;
      all[idx] = { ...all[idx], time: p.newTime };
      saveImportantDeadlines(all);
    },
    [],
  );

  const today = new Date();
  const isThisMonth =
    today.getFullYear() === viewYear && today.getMonth() === viewMonthIndex;
  const todayDay = isThisMonth ? today.getDate() : null;

  function goPrevMonth() {
    setViewMonthIndex((m) => {
      if (m === 0) {
        setViewYear((y) => y - 1);
        return 11;
      }
      return m - 1;
    });
  }

  function goNextMonth() {
    setViewMonthIndex((m) => {
      if (m === 11) {
        setViewYear((y) => y + 1);
        return 0;
      }
      return m + 1;
    });
  }

  function goTodayMonth() {
    const t = new Date();
    setViewYear(t.getFullYear());
    setViewMonthIndex(t.getMonth());
  }

  function goPrevWeek() {
    setWeekStart((ws) => {
      const n = new Date(
        ws.getFullYear(),
        ws.getMonth(),
        ws.getDate() - 7,
        0,
        0,
        0,
        0,
      );
      return n;
    });
  }

  function goNextWeek() {
    setWeekStart((ws) => {
      const n = new Date(
        ws.getFullYear(),
        ws.getMonth(),
        ws.getDate() + 7,
        0,
        0,
        0,
        0,
      );
      return n;
    });
  }

  function activateWeekFromMonth() {
    const t = new Date();
    const inView =
      t.getFullYear() === viewYear && t.getMonth() === viewMonthIndex;
    const firstOfView = new Date(viewYear, viewMonthIndex, 1);
    setWeekStart(startOfWeekMonday(inView ? t : firstOfView));
    setViewMode("week");
  }

  function clickMonthTab() {
    if (viewMode === "week") {
      setViewYear(weekStart.getFullYear());
      setViewMonthIndex(weekStart.getMonth());
    }
    setViewMode("month");
  }

  function isTodayDate(d: Date): boolean {
    return (
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    );
  }

  return (
    <div className="flex min-h-0 min-h-[70vh] flex-1 flex-col gap-4 px-3 py-4 md:px-6 md:py-5">
      {status === "unauthenticated" ? (
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-3 py-4">
          <button
            type="button"
            onClick={() => signIn("google", { callbackUrl: "/" })}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--ink)] px-6 py-3 text-base font-semibold text-white transition hover:opacity-90"
          >
            <SyncIcon className="h-5 w-5 shrink-0" />
            Conectar Google Calendar
          </button>
        </div>
      ) : status === "loading" ? (
        <p className="shrink-0 text-base text-[var(--ink-muted)]">Comprobando sesión…</p>
      ) : session?.error === "RefreshAccessTokenError" ? (
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-3 py-4">
          <button
            type="button"
            onClick={() => signIn("google", { callbackUrl: "/" })}
            className="inline-flex items-center gap-2 rounded-xl border-2 border-[var(--border-strong)] px-6 py-3 text-base font-semibold"
          >
            <SyncIcon className="h-5 w-5 shrink-0" />
            Volver a conectar Google
          </button>
        </div>
      ) : null}

      {status === "authenticated" && session?.error !== "RefreshAccessTokenError" ? (
        <>
          <div className="flex w-full min-w-0 shrink-0 flex-wrap items-center gap-2">
            <div
              className="flex rounded-2xl bg-zinc-100/90 p-1 shadow-inner ring-1 ring-zinc-200/60"
              role="group"
              aria-label="Tipo de vista"
            >
              <button
                type="button"
                onClick={clickMonthTab}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  viewMode === "month"
                    ? "bg-gradient-to-b from-zinc-800 to-zinc-900 text-white shadow-md"
                    : "text-zinc-500 hover:text-zinc-900"
                }`}
              >
                Mes
              </button>
              <button
                type="button"
                onClick={() => {
                  if (viewMode === "month") activateWeekFromMonth();
                  else setViewMode("week");
                }}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  viewMode === "week"
                    ? "bg-gradient-to-b from-zinc-800 to-zinc-900 text-white shadow-md"
                    : "text-zinc-500 hover:text-zinc-900"
                }`}
              >
                Semana
              </button>
            </div>

            {viewMode === "month" ? (
              <>
                <button
                  type="button"
                  onClick={goPrevMonth}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-zinc-700 shadow-sm ring-1 ring-zinc-200/80 transition hover:bg-zinc-50 hover:ring-zinc-300 active:scale-[0.97]"
                  aria-label="Mes anterior"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={goTodayMonth}
                  className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-zinc-600 shadow-sm ring-1 ring-zinc-200/80 transition hover:bg-zinc-50"
                >
                  Hoy
                </button>
                <button
                  type="button"
                  onClick={goNextMonth}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-zinc-700 shadow-sm ring-1 ring-zinc-200/80 transition hover:bg-zinc-50 hover:ring-zinc-300 active:scale-[0.97]"
                  aria-label="Mes siguiente"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={goPrevWeek}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-zinc-700 shadow-sm ring-1 ring-zinc-200/80 transition hover:bg-zinc-50 hover:ring-zinc-300 active:scale-[0.97]"
                  aria-label="Semana anterior"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={goNextWeek}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-zinc-700 shadow-sm ring-1 ring-zinc-200/80 transition hover:bg-zinc-50 hover:ring-zinc-300 active:scale-[0.97]"
                  aria-label="Semana siguiente"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </>
            )}
            <div className="ms-auto flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setCreateEventOpen(true)}
                className="inline-flex h-10 items-center gap-1.5 rounded-full bg-zinc-900 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 active:scale-[0.98] sm:px-4"
                title="Crear evento en Google Calendar"
                aria-label="Añadir evento"
              >
                <IconPlus className="h-4 w-4 shrink-0" />
                <span className="sm:hidden">Añadir</span>
                <span className="hidden sm:inline">Añadir evento</span>
              </button>
              <button
                type="button"
                onClick={() => signIn("google", { callbackUrl: "/" })}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-zinc-700 shadow-sm ring-1 ring-zinc-200/80 transition hover:bg-zinc-50 hover:ring-zinc-300 active:scale-[0.97]"
                title="Conectar o actualizar Google Calendar"
                aria-label="Conectar o actualizar Google Calendar"
              >
                <SyncIcon className="h-5 w-5" />
              </button>
            </div>
          </div>

          {viewMode === "month" ? (
            <h2 className="shrink-0 text-2xl font-semibold tracking-tight text-zinc-900 md:text-3xl">
              {MONTHS[viewMonthIndex]}{" "}
              <span className="font-normal text-zinc-400">{viewYear}</span>
            </h2>
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {loading ? (
              <p className="shrink-0 text-sm text-zinc-500">Cargando eventos…</p>
            ) : null}
            {fetchError ? (
              <p className="shrink-0 rounded-2xl border border-red-200/80 bg-red-50/90 px-4 py-3 text-sm text-red-900 shadow-sm ring-1 ring-red-100">
                {fetchError}
              </p>
            ) : null}

            {viewMode === "month" ? (
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-white via-zinc-50/95 to-zinc-100/50 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.14)] ring-1 ring-zinc-200/70">
                <div className="grid shrink-0 grid-cols-7 border-b border-zinc-200/60 bg-zinc-100/80 px-1 py-3 text-center text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
                  {WEEKDAYS.map((d) => (
                    <div key={d} className="px-1">
                      {d}
                    </div>
                  ))}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-auto">
                  <div className="grid min-w-[640px] grid-cols-7 gap-1.5 bg-zinc-100/40 p-2">
                    {grid.map((cell, i) => {
                      const list =
                        cell.inMonth &&
                        cell.date.getMonth() === viewMonthIndex &&
                        cell.date.getFullYear() === viewYear
                          ? (byDay.get(cell.day) ?? [])
                          : [];
                      const isTodayCell =
                        todayDay !== null && cell.inMonth && cell.day === todayDay;
                      return (
                        <div
                          key={`${cell.date.toISOString()}-${i}`}
                          className={`min-h-[5rem] rounded-xl bg-white/90 p-2 shadow-sm ring-1 ring-zinc-200/50 backdrop-blur-sm md:min-h-[5.5rem] ${
                            cell.inMonth ? "" : "opacity-45"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-1">
                            <span
                              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold shadow-sm ${
                                isTodayCell
                                  ? "bg-black text-white shadow-md ring-2 ring-black/25"
                                  : "bg-zinc-100/90 text-zinc-800 ring-1 ring-zinc-200/60"
                              }`}
                            >
                              {cell.day}
                            </span>
                          </div>
                          <ul className="mt-1.5 space-y-1">
                            {list.map((ev, j) => {
                              const c = getGoogleEventColorStyle(ev.colorId);
                              const delKey =
                                ev.calendarId && ev.eventId
                                  ? `${ev.calendarId}\u0000${ev.eventId}`
                                  : "";
                              const canDelete = Boolean(ev.calendarId && ev.eventId);
                              const isDeleting = deletingKey === delKey;
                              return (
                                <li
                                  key={`${cell.day}-${ev.eventId ?? j}-${ev.calendarId ?? ""}-${ev.title}`}
                                  className="flex min-w-0 items-start gap-0.5 rounded-lg border border-l-[3px] px-1.5 py-1 text-[10px] font-medium leading-tight shadow-sm ring-1 ring-black/[0.03] md:text-[11px]"
                                  style={{
                                    backgroundColor: c.bg,
                                    borderColor: c.border,
                                    borderLeftColor: c.borderLeft,
                                    color: c.text,
                                  }}
                                  title={`${ev.timeLabel} — ${ev.title}`}
                                >
                                  <span className="min-w-0 flex-1 truncate">
                                    <span
                                      className="font-mono-cli text-[9px] md:text-[10px]"
                                      style={{ color: c.textMuted }}
                                    >
                                      {ev.timeLabel}{" "}
                                    </span>
                                    {ev.title}
                                  </span>
                                  {canDelete ? (
                                    <button
                                      type="button"
                                      className="shrink-0 rounded p-0.5 opacity-80 hover:bg-black/10 hover:opacity-100 disabled:opacity-40"
                                      style={{ color: c.text }}
                                      aria-label="Eliminar evento"
                                      disabled={isDeleting}
                                      onClick={() =>
                                        handleDeleteEvent({
                                          eventId: ev.eventId!,
                                          calendarId: ev.calendarId!,
                                        })
                                      }
                                    >
                                      <TrashIcon className="h-3 w-3" />
                                    </button>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <WeekGoogleStyleGrid
                  weekDates={weekDates}
                  events={events}
                  isTodayDate={isTodayDate}
                  onDeleteEvent={handleDeleteEvent}
                  deletingKey={deletingKey}
                  onMoveEvent={handleMoveEvent}
                />
              </div>
            )}
          </div>

          <CreateCalendarEventModal
            open={createEventOpen}
            onClose={() => setCreateEventOpen(false)}
            onCreated={() => void loadEvents()}
          />
        </>
      ) : null}
    </div>
  );
}
