"use client";

import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ChecklistPriority,
  ChecklistTaskItem,
} from "@/types/dashboard";
import {
  DAILY_CHECKLIST_CHANGED_EVENT,
  DAILY_CHECKLIST_STORAGE_KEY,
  loadChecklistTasks,
  mondayYmdLocal,
  newTaskId,
  saveChecklistTasks,
  sundayAfterMondayYmd,
  todayYmdLocal,
} from "@/lib/daily-checklist-storage";
import {
  IconCalendar,
  IconChecklist,
  IconPlus,
  IconTrash,
} from "@/components/dashboard/icons";
import { requestCloudSyncPushDebounced } from "@/lib/cloud-sync-push";

const LIST_MODE_STORAGE_KEY = "iestudio-daily-tasks-list-mode";
const PANEL_VIEW_STORAGE_KEY = "iestudio-daily-tasks-panel-view";

type ListMode = "day" | "week";
type PanelView = "list" | "calendar";

type CalCell = {
  ymd: string;
  inMonth: boolean;
};

const WEEKDAY_SHORT = ["L", "M", "X", "J", "V", "S", "D"] as const;

const PRI_ORDER: Record<ChecklistPriority, number> = {
  red: 0,
  orange: 1,
  green: 2,
};

const PRI_DOT: Record<
  ChecklistPriority,
  { label: string; className: string }
> = {
  green: {
    label: "Prioridad baja (verde). Clic para subir a media.",
    className: "bg-emerald-500 shadow-[0_0_0_1px_rgba(16,185,129,0.35)]",
  },
  orange: {
    label: "Prioridad media (naranja). Clic para subir a alta.",
    className: "bg-amber-500 shadow-[0_0_0_1px_rgba(245,158,11,0.4)]",
  },
  red: {
    label: "Prioridad alta (roja). Clic para bajar a baja.",
    className: "bg-red-500 shadow-[0_0_0_1px_rgba(239,68,68,0.35)]",
  },
};

function cyclePriority(p: ChecklistPriority): ChecklistPriority {
  if (p === "green") return "orange";
  if (p === "orange") return "red";
  return "green";
}

function dateToYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 42 celdas desde el lunes anterior al día 1 hasta completar 6 semanas. */
function buildCalendarCells(viewYear: number, monthIndex: number): CalCell[] {
  const first = new Date(viewYear, monthIndex, 1);
  const pad = (first.getDay() + 6) % 7;
  const start = new Date(viewYear, monthIndex, 1 - pad);
  const out: CalCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    out.push({
      ymd: dateToYmd(d),
      inMonth: d.getMonth() === monthIndex,
    });
  }
  return out;
}

function loadListMode(): ListMode {
  if (typeof window === "undefined") return "day";
  try {
    const v = window.localStorage.getItem(LIST_MODE_STORAGE_KEY);
    if (v === "week") return "week";
  } catch {
    /* ignore */
  }
  return "day";
}

function saveListMode(mode: ListMode) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LIST_MODE_STORAGE_KEY, mode);
    requestCloudSyncPushDebounced();
  } catch {
    /* ignore */
  }
}

function loadPanelView(): PanelView {
  if (typeof window === "undefined") return "list";
  try {
    const v = window.localStorage.getItem(PANEL_VIEW_STORAGE_KEY);
    if (v === "calendar") return "calendar";
  } catch {
    /* ignore */
  }
  return "list";
}

function savePanelView(view: PanelView) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PANEL_VIEW_STORAGE_KEY, view);
    requestCloudSyncPushDebounced();
  } catch {
    /* ignore */
  }
}

function formatYmdLong(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString("es", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatWeekRange(mondayYmd: string): string {
  const sun = sundayAfterMondayYmd(mondayYmd);
  const fmt = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    if (!y || !m || !d) return ymd;
    return new Date(y, m - 1, d).toLocaleDateString("es", {
      day: "numeric",
      month: "short",
    });
  };
  if (!sun) return formatYmdLong(mondayYmd);
  return `${fmt(mondayYmd)} – ${fmt(sun)}`;
}

function formatMonthYear(viewYear: number, monthIndex: number): string {
  return new Date(viewYear, monthIndex, 1).toLocaleDateString("es", {
    month: "long",
    year: "numeric",
  });
}

function progressLabel(done: number, total: number): string {
  if (total === 0) return "Sin tareas";
  return `${done}/${total} hechas`;
}

function sortTasks(list: ChecklistTaskItem[]): ChecklistTaskItem[] {
  return [...list].sort((a, b) => {
    const pa = PRI_ORDER[a.priority];
    const pb = PRI_ORDER[b.priority];
    if (pa !== pb) return pa - pb;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

function dayTasksForYmd(
  ymd: string,
  all: ChecklistTaskItem[],
): ChecklistTaskItem[] {
  return sortTasks(
    all.filter((t) => t.scope === "day" && t.periodKey === ymd),
  );
}

function cellTone(
  total: number,
  done: number,
): "empty" | "pending" | "done" {
  if (total === 0) return "empty";
  if (done >= total) return "done";
  return "pending";
}

export function DailyTasksPanel() {
  const { status: sessionStatus } = useSession();
  const [tasks, setTasks] = useState<ChecklistTaskItem[]>(() =>
    typeof window === "undefined" ? [] : loadChecklistTasks(),
  );
  const [panelView, setPanelViewState] = useState<PanelView>(() =>
    loadPanelView(),
  );
  const [listMode, setListModeState] = useState<ListMode>(() =>
    loadListMode(),
  );
  const [draft, setDraft] = useState("");

  const now = new Date();
  const [calYear, setCalYear] = useState(() => now.getFullYear());
  const [calMonth, setCalMonth] = useState(() => now.getMonth());
  const [selectedYmd, setSelectedYmd] = useState(() => todayYmdLocal());

  const todayKey = todayYmdLocal();
  const weekKey = mondayYmdLocal();

  const setPanelView = useCallback((v: PanelView) => {
    setPanelViewState(v);
    savePanelView(v);
  }, []);

  const setListMode = useCallback((mode: ListMode) => {
    setListModeState(mode);
    saveListMode(mode);
  }, []);

  const refresh = useCallback(() => {
    setTasks(loadChecklistTasks());
  }, []);

  useEffect(() => {
    refresh();
    const bump = () => refresh();
    window.addEventListener(DAILY_CHECKLIST_CHANGED_EVENT, bump);
    const onStorage = (e: StorageEvent) => {
      if (e.key === DAILY_CHECKLIST_STORAGE_KEY) bump();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(DAILY_CHECKLIST_CHANGED_EVENT, bump);
      window.removeEventListener("storage", onStorage);
    };
  }, [refresh]);

  const calendarCells = useMemo(
    () => buildCalendarCells(calYear, calMonth),
    [calYear, calMonth],
  );

  const todayTasks = sortTasks(
    tasks.filter((t) => t.scope === "day" && t.periodKey === todayKey),
  );

  const weekTasks = sortTasks(
    tasks.filter((t) => t.scope === "week" && t.periodKey === weekKey),
  );

  const visibleItems = listMode === "day" ? todayTasks : weekTasks;
  const doneCount = visibleItems.filter((t) => t.done).length;

  const selectedDayTasks = dayTasksForYmd(selectedYmd, tasks);
  const selectedDone = selectedDayTasks.filter((t) => t.done).length;

  function persist(next: ChecklistTaskItem[]) {
    setTasks(next);
    saveChecklistTasks(next);
  }

  function addTask() {
    const title = draft.trim();
    if (!title) return;
    const nowIso = new Date().toISOString();
    const scope = listMode;
    const periodKey = scope === "day" ? todayKey : weekKey;
    persist([
      ...tasks,
      {
        id: newTaskId(),
        title,
        done: false,
        createdAt: nowIso,
        scope,
        periodKey,
        priority: "green",
      },
    ]);
    setDraft("");
  }

  function toggle(id: string) {
    persist(
      tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    );
  }

  function remove(id: string) {
    persist(tasks.filter((t) => t.id !== id));
  }

  function setPriority(id: string, priority: ChecklistPriority) {
    persist(
      tasks.map((t) => (t.id === id ? { ...t, priority } : t)),
    );
  }

  function cycleTaskPriority(id: string) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    setPriority(id, cyclePriority(t.priority));
  }

  function shiftCalendarMonth(delta: number) {
    const d = new Date(calYear, calMonth + delta, 1);
    setCalYear(d.getFullYear());
    setCalMonth(d.getMonth());
  }

  const cardTitle = listMode === "day" ? "Hoy" : "Esta semana";
  const cardSubtitle =
    listMode === "day" ? formatYmdLong(todayKey) : formatWeekRange(weekKey);
  const addLabel =
    listMode === "day" ? "Añadir tarea de hoy" : "Añadir tarea de la semana";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 px-4 py-6 md:px-10 md:py-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
          Organización
        </p>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <h1 className="text-3xl font-bold tracking-tight text-[var(--ink)]">
            Tareas
          </h1>
          <span className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-muted)]/80 px-2.5 py-1 text-[11px] font-semibold text-[var(--ink-muted)]">
            <IconChecklist className="h-3.5 w-3.5" />
            Checklist
          </span>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-[var(--ink-muted)]">
          Lista diaria o semanal, prioridad por colores, y calendario para revisar
          días anteriores y si completaste cada tarea. Los datos se guardan en este
          dispositivo
          {sessionStatus === "authenticated" ? " y se sincronizan con tu cuenta." : "."}
        </p>
      </header>

      <div
        className="flex flex-wrap gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)]/40 p-1"
        role="tablist"
        aria-label="Vista principal"
      >
        <button
          type="button"
          role="tab"
          aria-selected={panelView === "list"}
          onClick={() => setPanelView("list")}
          className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition sm:flex-none ${
            panelView === "list"
              ? "bg-[var(--surface)] text-[var(--ink)] shadow-sm ring-1 ring-[var(--border)]"
              : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
          }`}
        >
          <IconChecklist className="h-4 w-4 opacity-80" />
          Lista
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={panelView === "calendar"}
          onClick={() => setPanelView("calendar")}
          className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition sm:flex-none ${
            panelView === "calendar"
              ? "bg-[var(--surface)] text-[var(--ink)] shadow-sm ring-1 ring-[var(--border)]"
              : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
          }`}
        >
          <IconCalendar className="h-4 w-4 opacity-80" />
          Calendario
        </button>
      </div>

      {panelView === "list" ? (
        <>
          <div
            className="flex flex-wrap gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)]/40 p-1"
            role="tablist"
            aria-label="Tipo de lista"
          >
            <button
              type="button"
              role="tab"
              aria-selected={listMode === "day"}
              onClick={() => setListMode("day")}
              className={`min-h-[44px] flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold transition sm:flex-none ${
                listMode === "day"
                  ? "bg-[var(--surface)] text-[var(--ink)] shadow-sm ring-1 ring-[var(--border)]"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
              }`}
            >
              Diaria
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={listMode === "week"}
              onClick={() => setListMode("week")}
              className={`min-h-[44px] flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold transition sm:flex-none ${
                listMode === "week"
                  ? "bg-[var(--surface)] text-[var(--ink)] shadow-sm ring-1 ring-[var(--border)]"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
              }`}
            >
              Semanal
            </button>
          </div>

          <p className="flex flex-wrap items-center gap-3 text-[11px] text-[var(--ink-muted)]">
            <span className="font-semibold text-[var(--ink-faint)]">Prioridad:</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
              Baja
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden />
              Media
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" aria-hidden />
              Alta
            </span>
          </p>

          <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            <div className="border-b border-[var(--border)] px-4 py-3 md:px-5 md:py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold text-[var(--ink)]">{cardTitle}</h2>
                  <p className="mt-0.5 text-xs text-[var(--ink-muted)]">{cardSubtitle}</p>
                </div>
                <span className="rounded-lg bg-[var(--surface-muted)] px-2 py-1 text-[11px] font-semibold tabular-nums text-[var(--ink)]">
                  {progressLabel(doneCount, visibleItems.length)}
                </span>
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTask();
                    }
                  }}
                  placeholder="Nueva tarea…"
                  className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--ink-muted)]"
                  aria-label={`Texto de tarea para ${cardTitle}`}
                />
                <button
                  type="button"
                  onClick={addTask}
                  disabled={!draft.trim()}
                  title={addLabel}
                  className="flex shrink-0 items-center justify-center rounded-xl bg-[var(--ink)] px-3 py-2 text-white transition hover:opacity-90 disabled:opacity-40"
                  aria-label={addLabel}
                >
                  <IconPlus className="h-5 w-5" />
                </button>
              </div>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto p-2 md:p-3">
              {visibleItems.length === 0 ? (
                <li className="px-2 py-10 text-center text-sm text-[var(--ink-muted)]">
                  No hay tareas en esta lista. Añade la primera arriba.
                </li>
              ) : (
                visibleItems.map((t) => {
                  const pri = PRI_DOT[t.priority];
                  return (
                    <li
                      key={t.id}
                      className="group flex items-start gap-2 rounded-xl px-2 py-2 transition hover:bg-[var(--surface-muted)]/60"
                    >
                      <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          checked={t.done}
                          onChange={() => toggle(t.id)}
                          className="mt-1 h-4 w-4 shrink-0 rounded border-[var(--border)] text-[var(--ink)] focus:ring-[var(--ink)]"
                        />
                        <span
                          className={`min-w-0 flex-1 break-words text-sm leading-snug ${
                            t.done
                              ? "text-[var(--ink-muted)] line-through"
                              : "text-[var(--ink)]"
                          }`}
                        >
                          {t.title}
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={() => remove(t.id)}
                        className="shrink-0 rounded-lg p-2 text-[var(--ink-faint)] opacity-70 transition hover:bg-[var(--surface-muted)] hover:text-red-600 hover:opacity-100"
                        aria-label={`Eliminar: ${t.title}`}
                      >
                        <IconTrash className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => cycleTaskPriority(t.id)}
                        title={pri.label}
                        aria-label={pri.label}
                        className="mt-0.5 shrink-0 rounded-full p-2 transition hover:bg-[var(--surface-muted)]"
                      >
                        <span
                          className={`mx-auto block h-2.5 w-2.5 rounded-full ${pri.className}`}
                        />
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </section>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 md:px-4">
            <button
              type="button"
              onClick={() => shiftCalendarMonth(-1)}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--canvas)] text-lg font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
              aria-label="Mes anterior"
            >
              ‹
            </button>
            <h2 className="min-w-0 flex-1 text-center text-base font-bold capitalize tracking-tight text-[var(--ink)] md:text-lg">
              {formatMonthYear(calYear, calMonth)}
            </h2>
            <button
              type="button"
              onClick={() => shiftCalendarMonth(1)}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--canvas)] text-lg font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
              aria-label="Mes siguiente"
            >
              ›
            </button>
          </div>

          <p className="text-[11px] leading-relaxed text-[var(--ink-muted)]">
            <span className="font-semibold text-[var(--ink-faint)]">Leyenda:</span>{" "}
            tono neutro = sin tareas ·{" "}
            <span className="text-amber-700/90">ámbar</span> = hay pendientes ·{" "}
            <span className="text-emerald-700/90">verde</span> = todas completadas. El borde
            marcado es el día seleccionado; resaltado en negrita es hoy.
          </p>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2 md:p-4">
            <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase tracking-wider text-[var(--ink-muted)] md:text-[11px]">
              {WEEKDAY_SHORT.map((w) => (
                <div key={w} className="py-1">
                  {w}
                </div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {calendarCells.map(({ ymd, inMonth }) => {
                const list = tasks.filter(
                  (t) => t.scope === "day" && t.periodKey === ymd,
                );
                const total = list.length;
                const done = list.filter((t) => t.done).length;
                const tone = cellTone(total, done);
                const isToday = ymd === todayKey;
                const isSelected = ymd === selectedYmd;

                const bg =
                  tone === "empty"
                    ? inMonth
                      ? "bg-[var(--canvas)]/50"
                      : "bg-[var(--surface-muted)]/30"
                    : tone === "done"
                      ? "bg-emerald-500/15 ring-1 ring-emerald-500/25"
                      : "bg-amber-500/12 ring-1 ring-amber-500/25";

                const dayNum = Number(ymd.slice(8, 10));

                return (
                  <button
                    key={ymd}
                    type="button"
                    onClick={() => setSelectedYmd(ymd)}
                    className={`flex min-h-[3rem] flex-col items-center justify-center rounded-xl px-0.5 py-1.5 text-center transition hover:opacity-95 md:min-h-[3.5rem] ${bg} ${
                      isSelected
                        ? "ring-2 ring-[var(--ink)] ring-offset-2 ring-offset-[var(--surface)]"
                        : isToday
                          ? "ring-1 ring-[var(--ink-muted)]/50"
                          : ""
                    } ${inMonth ? "text-[var(--ink)]" : "text-[var(--ink-faint)]"}`}
                  >
                    <span
                      className={`text-sm tabular-nums ${
                        isToday ? "font-bold text-[var(--ink)]" : "font-semibold"
                      }`}
                    >
                      {dayNum}
                    </span>
                    {total > 0 ? (
                      <span className="mt-0.5 text-[9px] font-semibold tabular-nums text-[var(--ink-muted)] md:text-[10px]">
                        {done}/{total}
                      </span>
                    ) : (
                      <span className="mt-0.5 text-[9px] opacity-0 md:text-[10px]">·</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            <div className="px-4 pt-4 md:px-5 md:pt-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-[var(--ink)]">
                    Tareas del día
                  </h2>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--ink-muted)]">
                    <span>{formatYmdLong(selectedYmd)}</span>
                    {selectedYmd === todayKey ? (
                      <span className="rounded-md bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink)]">
                        Hoy
                      </span>
                    ) : null}
                  </div>
                </div>
                <span className="shrink-0 rounded-lg bg-[var(--surface-muted)] px-2 py-1 text-[11px] font-semibold tabular-nums text-[var(--ink)]">
                  {progressLabel(selectedDone, selectedDayTasks.length)}
                </span>
              </div>
            </div>
            <ul className="min-h-0 max-h-[min(50vh,28rem)] flex-1 overflow-y-auto p-2 pt-3 md:p-3 md:pt-4">
              {selectedDayTasks.length === 0 ? (
                <li className="px-2 py-10 text-center text-sm text-[var(--ink-muted)]">
                  No hay tareas diarias registradas para esta fecha.
                </li>
              ) : (
                selectedDayTasks.map((t) => {
                  const pri = PRI_DOT[t.priority];
                  return (
                    <li
                      key={t.id}
                      className="group flex items-start gap-2 rounded-xl px-2 py-2 transition hover:bg-[var(--surface-muted)]/60"
                    >
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <input
                          type="checkbox"
                          checked={t.done}
                          onChange={() => toggle(t.id)}
                          className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-[var(--border)] text-[var(--ink)] focus:ring-[var(--ink)]"
                          aria-label={
                            t.done ? "Marcar como no hecha" : "Marcar como hecha"
                          }
                        />
                        <span
                          className={`min-w-0 flex-1 break-words text-sm leading-snug ${
                            t.done
                              ? "text-[var(--ink-muted)] line-through"
                              : "text-[var(--ink)]"
                          }`}
                        >
                          {t.title}
                        </span>
                      </div>
                      <span
                        className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                          t.done
                            ? "bg-emerald-500/15 text-emerald-800"
                            : "bg-amber-500/15 text-amber-900"
                        }`}
                      >
                        {t.done ? "Hecha" : "Pendiente"}
                      </span>
                      <button
                        type="button"
                        onClick={() => remove(t.id)}
                        className="shrink-0 rounded-lg p-2 text-[var(--ink-faint)] opacity-70 transition hover:bg-[var(--surface-muted)] hover:text-red-600 hover:opacity-100"
                        aria-label={`Eliminar: ${t.title}`}
                      >
                        <IconTrash className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => cycleTaskPriority(t.id)}
                        title={pri.label}
                        aria-label={pri.label}
                        className="mt-0.5 shrink-0 rounded-full p-2 transition hover:bg-[var(--surface-muted)]"
                      >
                        <span
                          className={`mx-auto block h-2.5 w-2.5 rounded-full ${pri.className}`}
                        />
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
