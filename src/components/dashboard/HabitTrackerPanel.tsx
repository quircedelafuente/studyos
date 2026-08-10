"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { HabitDefinition, HabitKind, HabitSchedule } from "@/types/dashboard";
import { IconPlus, IconTrash } from "@/components/dashboard/icons";
import { HABITS_CHANGED_EVENT, createHabitDraft, loadHabits, saveHabits } from "@/lib/habits-storage";
import { loadHabitLogsFile, HABIT_LOGS_CHANGED_EVENT, getHabitLog, patchHabitLog } from "@/lib/habit-logs-storage";
import { isHabitLogDone, isHabitScheduledOnDate, periodKeyForHabitOnDate, periodKeyForHabitToday } from "@/lib/habits-schedule";
import { requestCloudSyncPushDebounced } from "@/lib/cloud-sync-push";

function weekdayLabel(n: number): string {
  return ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"][n] ?? String(n);
}

type CalCell = { ymd: string; inMonth: boolean };

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

function monthLabelEs(viewYear: number, monthIndex: number): string {
  return new Date(viewYear, monthIndex, 1).toLocaleDateString("es", {
    month: "long",
    year: "numeric",
  });
}

function ymdToDate(ymd: string): Date | null {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function startOfDay(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setHours(0, 0, 0, 0);
  return x;
}

function SchedulePill({ schedule }: { schedule: HabitSchedule }) {
  if (schedule.mode === "times_per_week") {
    return (
      <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ink-muted)]">
        {schedule.timesPerWeek}/sem
      </span>
    );
  }
  return (
    <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ink-muted)]">
      {schedule.weekdays.map(weekdayLabel).join(" ")}
    </span>
  );
}

type HabitModalMode = "create";

function HabitModal({
  open,
  mode,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: HabitModalMode;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<HabitDefinition>(() => createHabitDraft());
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<HabitKind>("check");
  const [scheduleMode, setScheduleMode] = useState<HabitSchedule["mode"]>("weekdays");
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [timesPerWeek, setTimesPerWeek] = useState(3);
  const [unit, setUnit] = useState("L");
  const [target, setTarget] = useState<number>(2);
  const [remEnabled, setRemEnabled] = useState(false);
  const [remTime, setRemTime] = useState("09:00");
  const [remMsg, setRemMsg] = useState("");

  useEffect(() => {
    if (!open) return;
    const d = createHabitDraft();
    setDraft(d);
    setTitle("");
    setKind("check");
    setScheduleMode("weekdays");
    setWeekdays([1, 2, 3, 4, 5]);
    setTimesPerWeek(3);
    setUnit("L");
    setTarget(2);
    setRemEnabled(false);
    setRemTime("09:00");
    setRemMsg("");
  }, [open, mode]);

  if (!open) return null;

  function toggleWeekday(w: number) {
    setWeekdays((prev) => {
      const s = new Set(prev);
      if (s.has(w)) s.delete(w);
      else s.add(w);
      return [...s].sort((a, b) => a - b);
    });
  }

  function save() {
    const t = title.trim();
    if (!t) return;
    const schedule: HabitSchedule =
      scheduleMode === "times_per_week"
        ? { mode: "times_per_week", timesPerWeek: Math.max(1, Math.min(7, Math.round(timesPerWeek))) }
        : { mode: "weekdays", weekdays: weekdays.length ? weekdays : [1] };
    const now = new Date().toISOString();
    const next: HabitDefinition = {
      ...draft,
      title: t,
      kind,
      schedule,
      ...(kind === "measure"
        ? { unit: unit.trim() || undefined, target: Number.isFinite(target) ? target : null, targetMode: "at_least" as const }
        : {}),
      reminder: { enabled: remEnabled, timeLocal: remTime, message: remMsg },
      updatedAt: now,
      createdAt: draft.createdAt ?? now,
    };
    const all = loadHabits();
    saveHabits([...all, next]);
    requestCloudSyncPushDebounced();
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Cerrar" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="habit-modal-title"
        className="relative z-10 max-h-[min(92dvh,100%)] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl sm:rounded-2xl sm:p-5"
      >
        <h2 id="habit-modal-title" className="text-lg font-extrabold text-[var(--ink)]">
          Nuevo hábito
        </h2>
        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Nombre
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej. Beber agua, Meditar…"
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-base text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--ink)] focus:outline-none sm:text-sm"
              autoFocus
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="min-w-[10rem] flex-1">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                Tipo
              </label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value === "measure" ? "measure" : "check")}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-base text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none sm:text-sm"
              >
                <option value="check">Check (hecho / no hecho)</option>
                <option value="measure">Medida (sumar cantidades)</option>
              </select>
            </div>
            <div className="min-w-[10rem] flex-1">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                Frecuencia
              </label>
              <select
                value={scheduleMode}
                onChange={(e) =>
                  setScheduleMode(e.target.value === "times_per_week" ? "times_per_week" : "weekdays")
                }
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-base text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none sm:text-sm"
              >
                <option value="weekdays">Días específicos</option>
                <option value="times_per_week">N veces por semana</option>
              </select>
            </div>
          </div>

          {scheduleMode === "weekdays" ? (
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                Días
              </label>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5, 6, 0].map((w) => {
                  const on = weekdays.includes(w);
                  return (
                    <button
                      key={w}
                      type="button"
                      onClick={() => toggleWeekday(w)}
                      className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                        on
                          ? "border-[var(--ink)] bg-[var(--ink)] text-white"
                          : "border-[var(--border)] bg-[var(--canvas)] text-[var(--ink)] hover:bg-[var(--surface-muted)]"
                      }`}
                    >
                      {weekdayLabel(w)}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex items-end gap-3">
              <div className="min-w-[10rem]">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                  Veces por semana
                </label>
                <input
                  type="number"
                  min={1}
                  max={7}
                  value={timesPerWeek}
                  onChange={(e) => setTimesPerWeek(Number(e.target.value))}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-base text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none sm:text-sm"
                />
              </div>
              <p className="text-xs text-[var(--ink-muted)]">
                Te permitirá completar el hábito {timesPerWeek}/semana.
              </p>
            </div>
          )}

          {kind === "measure" ? (
            <div className="flex flex-wrap gap-3">
              <div className="min-w-[10rem] flex-1">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                  Unidad
                </label>
                <input
                  type="text"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="L, min, páginas…"
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-base text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none sm:text-sm"
                />
              </div>
              <div className="min-w-[10rem] flex-1">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                  Objetivo (opcional)
                </label>
                <input
                  type="number"
                  value={target}
                  onChange={(e) => setTarget(Number(e.target.value))}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-base text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none sm:text-sm"
                />
              </div>
            </div>
          ) : null}

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--canvas)] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--ink)]">Recordatorio (iOS)</p>
                <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                  Notificación local opcional con tu propio mensaje motivador.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRemEnabled((v) => !v)}
                className={`min-h-[36px] rounded-xl border px-3 text-xs font-bold transition ${
                  remEnabled
                    ? "border-emerald-600/30 bg-emerald-50 text-emerald-900"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink)]"
                }`}
              >
                {remEnabled ? "Activado" : "Desactivado"}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-3">
              <div className="min-w-[9rem]">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                  Hora
                </label>
                <input
                  type="time"
                  value={remTime}
                  onChange={(e) => setRemTime(e.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none sm:text-sm"
                  disabled={!remEnabled}
                />
              </div>
              <div className="min-w-[12rem] flex-1">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                  Mensaje
                </label>
                <input
                  type="text"
                  value={remMsg}
                  onChange={(e) => setRemMsg(e.target.value)}
                  placeholder="Ej. Vamos, 5 minutos y listo."
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--ink)] focus:outline-none sm:text-sm"
                  disabled={!remEnabled}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2 pb-[env(safe-area-inset-bottom,0px)]">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-muted)]"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!title.trim()}
            className="min-h-[44px] rounded-xl bg-[var(--ink)] px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Crear
          </button>
        </div>
      </div>
    </div>
  );
}

function progressMeta(h: HabitDefinition, periodKey: string): { label: string; pct: number } {
  const e = getHabitLog(periodKey, h.id);
  if (h.kind === "check") {
    const done = Boolean(e?.done);
    return { label: done ? "Hecho" : "Pendiente", pct: done ? 100 : 0 };
  }
  const v = typeof e?.value === "number" ? e.value : 0;
  const tgt = typeof h.target === "number" && h.target > 0 ? h.target : null;
  if (!tgt) return { label: v > 0 ? `${v}${h.unit ? ` ${h.unit}` : ""}` : "0", pct: v > 0 ? 100 : 0 };
  const pct = Math.max(0, Math.min(100, Math.round((100 * v) / tgt)));
  return { label: `${v}${h.unit ? ` ${h.unit}` : ""} / ${tgt}${h.unit ? ` ${h.unit}` : ""}`, pct };
}

export function HabitTrackerPanel() {
  const [habits, setHabits] = useState<HabitDefinition[]>([]);
  const [logsRevision, setLogsRevision] = useState(0);
  const [creating, setCreating] = useState(false);
  const now = new Date();
  const [calYear, setCalYear] = useState(() => now.getFullYear());
  const [calMonth, setCalMonth] = useState(() => now.getMonth());

  const refresh = useCallback(() => {
    setHabits(loadHabits().filter((h) => !h.archived));
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(HABITS_CHANGED_EVENT, refresh);
    function onStorage(e: StorageEvent) {
      if (e.key === "iestudio-habits-v1") refresh();
    }
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(HABITS_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, [refresh]);

  useEffect(() => {
    const bump = () => setLogsRevision((n) => n + 1);
    bump();
    window.addEventListener(HABIT_LOGS_CHANGED_EVENT, bump);
    function onStorage(e: StorageEvent) {
      if (e.key === "iestudio-habit-logs-v1") bump();
    }
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(HABIT_LOGS_CHANGED_EVENT, bump);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const today = new Date();

  const activeToday = useMemo(() => {
    void logsRevision;
    // v1: mostramos todos los hábitos no archivados; el schedule afecta el periodo (day vs week) y el pill.
    return habits;
  }, [habits, logsRevision]);

  const calendarCells = useMemo(() => buildCalendarCells(calYear, calMonth), [calYear, calMonth]);

  const habitCalendarMeta = useMemo(() => {
    void logsRevision;
    const logs = loadHabitLogsFile();
    const byDay: Record<string, { pct: number; done: number; total: number }> = {};
    for (const cell of calendarCells) {
      const dt = ymdToDate(cell.ymd);
      if (!dt) continue;
      // Para el calendario diario, usamos solo hábitos "programados ese día" (weekdays) + también times/week como “aplican siempre”.
      // En times/week, el periodo es semanal; el día muestra el estado de esa semana.
      const scheduled = habits.filter((h) => isHabitScheduledOnDate(h, dt));
      const total = scheduled.length;
      if (total === 0) {
        byDay[cell.ymd] = { pct: 0, done: 0, total: 0 };
        continue;
      }
      let done = 0;
      for (const h of scheduled) {
        const pk = periodKeyForHabitOnDate(h, dt);
        const e = logs.byPeriod[pk]?.[h.id];
        if (isHabitLogDone(h, e)) done++;
      }
      byDay[cell.ymd] = { pct: Math.round((100 * done) / total), done, total };
    }
    return byDay;
  }, [calendarCells, habits, logsRevision]);

  function cellTone(pct: number, total: number): "empty" | "low" | "mid" | "high" | "full" {
    if (total === 0) return "empty";
    if (pct >= 100) return "full";
    if (pct >= 67) return "high";
    if (pct >= 34) return "mid";
    return "low";
  }

  function toggleDone(h: HabitDefinition) {
    const pk = periodKeyForHabitToday(h);
    const prev = getHabitLog(pk, h.id);
    const done = !isHabitLogDone(h, prev);
    if (h.kind === "check") {
      patchHabitLog(pk, h.id, { done });
    } else {
      // para medida: si tiene target, al togglear lo ponemos a target o 0
      const tgt = typeof h.target === "number" && h.target > 0 ? h.target : 1;
      patchHabitLog(pk, h.id, { value: done ? tgt : 0 });
    }
  }

  function addMeasure(h: HabitDefinition, delta: number) {
    const pk = periodKeyForHabitToday(h);
    const prev = getHabitLog(pk, h.id);
    const cur = typeof prev?.value === "number" ? prev.value : 0;
    const next = Math.max(0, cur + delta);
    patchHabitLog(pk, h.id, { value: next });
  }

  function deleteHabit(h: HabitDefinition) {
    if (!window.confirm(`¿Eliminar el hábito «${h.title}»?`)) return;
    saveHabits(loadHabits().filter((x) => x.id !== h.id));
    requestCloudSyncPushDebounced();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-col gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-3 md:px-6">
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight text-[var(--ink)]">Habit Tracker</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Hábitos con frecuencia flexible y marcado rápido. Los recordatorios iOS se configuran por hábito.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 self-start rounded-xl bg-[var(--ink)] px-4 py-2.5 text-sm font-bold text-white transition hover:opacity-90 sm:self-auto"
          aria-label="Nuevo hábito"
        >
          <IconPlus className="h-5 w-5" />
          Nuevo
        </button>
      </header>

      {/* Mismo respiro que la página de Tareas, y sin columna centrada: el
          contenido usa todo el ancho disponible. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-10 md:py-8">
        <div>
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--ink)]">Hoy</p>
              <p className="text-xs text-[var(--ink-muted)]">
                {today.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" })}
              </p>
            </div>
          </div>

          {activeToday.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface-muted)] px-6 py-10 text-center text-sm text-[var(--ink-muted)]">
              No tienes hábitos todavía. Pulsa <strong className="text-[var(--ink)]">Nuevo</strong> para crear el primero.
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3">
              {activeToday.map((h) => {
                const pk = periodKeyForHabitToday(h);
                const meta = progressMeta(h, pk);
                const done = isHabitLogDone(h, getHabitLog(pk, h.id));
                return (
                  <li
                    key={h.id}
                    className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-bold text-[var(--ink)]">{h.title}</p>
                          <SchedulePill schedule={h.schedule} />
                          {h.kind === "measure" ? (
                            <span className="rounded-full border border-[var(--border)] bg-[var(--canvas)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ink-muted)]">
                              Medida{h.unit ? ` · ${h.unit}` : ""}
                            </span>
                          ) : (
                            <span className="rounded-full border border-[var(--border)] bg-[var(--canvas)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ink-muted)]">
                              Check
                            </span>
                          )}
                        </div>
                        <div className="mt-2">
                          <div className="h-2 w-full overflow-hidden rounded-full bg-black/10">
                            <div
                              className="h-full rounded-full bg-emerald-600/90 transition-[width]"
                              style={{ width: `${meta.pct}%` }}
                            />
                          </div>
                          <p className="mt-1 text-xs text-[var(--ink-muted)]">{meta.label}</p>
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                        {h.kind === "measure" ? (
                          <>
                            <button
                              type="button"
                              onClick={() => addMeasure(h, -1)}
                              className="min-h-[36px] rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 text-xs font-bold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                            >
                              −
                            </button>
                            <button
                              type="button"
                              onClick={() => addMeasure(h, 1)}
                              className="min-h-[36px] rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 text-xs font-bold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                            >
                              +
                            </button>
                          </>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => toggleDone(h)}
                          className={`min-h-[36px] rounded-xl px-3 text-xs font-bold transition ${
                            done
                              ? "border border-emerald-600/30 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
                              : "border border-[var(--border)] bg-[var(--canvas)] text-[var(--ink)] hover:bg-[var(--surface-muted)]"
                          }`}
                        >
                          {done ? "Hecho" : "Marcar"}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteHabit(h)}
                          className="min-h-[36px] rounded-xl border border-[var(--border)] px-3 text-xs font-bold text-red-600 transition hover:bg-red-50"
                          title="Eliminar hábito"
                          aria-label="Eliminar hábito"
                        >
                          <IconTrash className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[var(--ink)]">Calendario</p>
                    <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                      Cada día se colorea según el % de hábitos completados (para los hábitos que aplican ese día).
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const d = new Date(calYear, calMonth, 1);
                        d.setMonth(d.getMonth() - 1);
                        setCalYear(d.getFullYear());
                        setCalMonth(d.getMonth());
                      }}
                      className="min-h-[36px] rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 text-xs font-bold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                      aria-label="Mes anterior"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const d = new Date(calYear, calMonth, 1);
                        d.setMonth(d.getMonth() + 1);
                        setCalYear(d.getFullYear());
                        setCalMonth(d.getMonth());
                      }}
                      className="min-h-[36px] rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 text-xs font-bold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                      aria-label="Mes siguiente"
                    >
                      →
                    </button>
                  </div>
                </div>
                <div className="mt-2 text-center text-xs font-bold capitalize text-[var(--ink)] sm:text-left">
                  {monthLabelEs(calYear, calMonth)}
                </div>
              </div>
            </div>

            {/* Misma rejilla que el calendario de Tareas. */}
            <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase tracking-wider text-[var(--ink-muted)] md:text-[11px]">
              {["L", "M", "X", "J", "V", "S", "D"].map((w) => (
                <div key={w} className="py-1">
                  {w}
                </div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {calendarCells.map((c) => {
                const meta = habitCalendarMeta[c.ymd] ?? { pct: 0, done: 0, total: 0 };
                const dt = ymdToDate(c.ymd);
                const today0 = startOfDay(new Date());
                const inPastOrToday = dt ? startOfDay(dt).getTime() <= today0.getTime() : false;
                // Regla: antes de que llegue el día (futuro) o si aún no hubo hábitos configurados ese día, mostrar gris.
                const shouldColor = inPastOrToday && meta.total > 0;
                const tone = shouldColor ? cellTone(meta.pct, meta.total) : "empty";
                /* Tintes al estilo de Tareas: fondo translúcido + anillo, en vez
                   de color plano con borde. */
                const base =
                  tone === "empty"
                    ? c.inMonth
                      ? "bg-[var(--canvas)]/50"
                      : "bg-[var(--surface-muted)]/30"
                    : tone === "full"
                      ? "bg-emerald-500/15 ring-1 ring-emerald-500/25"
                      : tone === "high"
                        ? "bg-emerald-500/10 ring-1 ring-emerald-500/20"
                        : tone === "mid"
                          ? "bg-amber-500/12 ring-1 ring-amber-500/25"
                          : "bg-red-500/12 ring-1 ring-red-500/25";
                const dayNum = Number(c.ymd.slice(-2));
                const isToday = c.ymd === dateToYmd(new Date());
                const tooltip =
                  !inPastOrToday
                    ? `${c.ymd} · Aún no`
                    : meta.total === 0
                      ? `${c.ymd} · Sin hábitos`
                      : `${c.ymd} · ${meta.done}/${meta.total} · ${meta.pct}%`;
                return (
                  <div
                    key={c.ymd}
                    title={tooltip}
                    className={`flex min-h-[3rem] flex-col items-center justify-center rounded-xl px-0.5 py-1.5 text-center md:min-h-[3.5rem] ${base} ${
                      isToday ? "ring-1 ring-[var(--ink-muted)]/50" : ""
                    } ${c.inMonth ? "text-[var(--ink)]" : "text-[var(--ink-faint)]"}`}
                  >
                    <span
                      className={`text-sm tabular-nums ${
                        isToday ? "font-bold text-[var(--ink)]" : "font-semibold"
                      }`}
                    >
                      {Number.isFinite(dayNum) ? dayNum : "·"}
                    </span>
                    {/* El hueco se reserva aunque no haya datos, para que todas
                        las celdas midan lo mismo. */}
                    {meta.total > 0 ? (
                      <span className="mt-0.5 text-[9px] font-semibold tabular-nums text-[var(--ink-muted)] md:text-[10px]">
                        {meta.done}/{meta.total}
                      </span>
                    ) : (
                      <span className="mt-0.5 text-[9px] opacity-0 md:text-[10px]">·</span>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 text-[10px] font-semibold text-[var(--ink-muted)]">
              <span className="text-[var(--ink-faint)]">Leyenda:</span>
              <span className="inline-flex items-center gap-1">
                <span className="h-3 w-3 rounded bg-red-500/12 ring-1 ring-red-500/25" /> 0–33%
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-3 w-3 rounded bg-amber-500/12 ring-1 ring-amber-500/25" /> 34–66%
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-3 w-3 rounded bg-emerald-500/10 ring-1 ring-emerald-500/20" /> 67–99%
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-3 w-3 rounded bg-emerald-500/15 ring-1 ring-emerald-500/25" /> 100%
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-3 w-3 rounded bg-[var(--canvas)]/50 ring-1 ring-[var(--border)]" /> sin hábitos
              </span>
            </div>
          </div>
        </div>
      </div>

      <HabitModal open={creating} mode="create" onClose={() => setCreating(false)} onSaved={refresh} />
    </div>
  );
}

