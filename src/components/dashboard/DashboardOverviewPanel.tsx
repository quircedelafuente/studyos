"use client";

import { Responsive, WidthProvider, type Layout, type LayoutItem, type ResponsiveLayouts } from "react-grid-layout/legacy";
import { useEffect, useMemo, useRef, useState } from "react";

const GridLayout = WidthProvider(Responsive);
import { useCloudSyncStatus } from "@/components/providers/CloudSyncProvider";
import type { ReactNode } from "react";
import { readBbDisplayedCoursesSnapshot } from "@/lib/bb-displayed-courses";
import { filterCoursesByMode, resolveGradebookColumnUltraUrl } from "@/lib/blackboard-api";
import { loadBbConfig } from "@/lib/blackboard-config";
import { bridgeBlackboardFetch } from "@/lib/blackboard-bridge-client";
import { getGoogleEventColorStyle } from "@/lib/google-calendar-event-colors";
import {
  BB_CONTENT_META_CHANGED,
  BB_COURSES_STORAGE_CHANGED,
  BB_GRADEBOOK_STORAGE_CHANGED,
  loadBbContentFirstLastModifiedMs,
  loadBbGradebook,
  saveBbContentFirstLastModifiedMs,
} from "@/lib/blackboard-storage";
import { getSubmissionLight } from "@/lib/blackboard-submission-status";
import { loadStudyPlans, STUDY_PLANS_CHANGED_EVENT } from "@/lib/study-plans-storage";
import { buildStudyTrendChartData } from "@/lib/study-trend-chart-data";
import {
  loadCompletedSessions,
  STUDY_ARENA_COMPLETED_CHANGED_EVENT,
  STUDY_ARENA_COMPLETED_STORAGE_KEY,
} from "@/lib/study-arena-completed-storage";
import {
  DEADLINES_CHANGED_EVENT,
  DEADLINES_STORAGE_KEY,
  loadImportantDeadlines,
} from "@/lib/deadlines-storage";
import {
  DAILY_CHECKLIST_CHANGED_EVENT,
  DAILY_CHECKLIST_STORAGE_KEY,
  loadChecklistTasks,
} from "@/lib/daily-checklist-storage";
import { HABITS_CHANGED_EVENT, HABITS_STORAGE_KEY, loadHabits } from "@/lib/habits-storage";
import { HABIT_LOGS_CHANGED_EVENT, HABIT_LOGS_STORAGE_KEY, loadHabitLogsFile } from "@/lib/habit-logs-storage";
import { isHabitLogDone, isHabitScheduledOnDate, periodKeyForHabitOnDate, periodKeyForHabitToday } from "@/lib/habits-schedule";

type WidgetShellProps = {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  tone?: "default" | "danger" | "warning" | "accent";
  children: ReactNode;
};

function WidgetShell({ title, subtitle, right, tone = "default", children }: WidgetShellProps) {
  const toneStyles =
    tone === "danger"
      ? "border-red-200/80 bg-red-50/40 text-red-950"
      : tone === "warning"
        ? "border-amber-200/80 bg-amber-50/40 text-amber-950"
        : tone === "accent"
          ? "border-zinc-200/90 bg-[var(--surface)]"
          : "border-[var(--border)] bg-[var(--surface)]";

  return (
    <section
      className={`relative h-full overflow-hidden rounded-2xl border shadow-none ring-0 ${toneStyles} transition-colors duration-200`}
    >
      <div className="relative p-3 sm:p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-xs sm:text-sm font-bold sm:font-semibold tracking-tight">{title}</h3>
            {subtitle ? <p className="mt-0.5 line-clamp-1 text-[10px] sm:text-xs text-[var(--ink-muted)] leading-tight">{subtitle}</p> : null}
          </div>
          {right ? <div className="shrink-0">{right}</div> : null}
        </div>
        <div className="mt-3">{children}</div>
      </div>
    </section>
  );
}

function Pill({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "red" | "amber" | "green" }) {
  const cls =
    tone === "red"
      ? "border-red-200 bg-red-50 text-red-900"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : tone === "green"
          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
          : "border-[var(--border)] bg-[var(--surface-muted)] text-[var(--ink)]";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold ${cls}`}>
      {children}
    </span>
  );
}

/** Rojo (0%) → verde (100%). Si `empty`, gris neutro. */
function rgbForAdherencePct(pct: number, empty: boolean): string {
  if (empty) return "rgb(148, 163, 184)";
  const p = Math.max(0, Math.min(100, pct)) / 100;
  const r = Math.round(239 * (1 - p) + 34 * p);
  const g = Math.round(68 * (1 - p) + 197 * p);
  const b = Math.round(68 * (1 - p) + 94 * p);
  return `rgb(${r},${g},${b})`;
}

function completionMeta(tasks: readonly { done: boolean }[]): {
  pct: number;
  empty: boolean;
  done: number;
  total: number;
} {
  const total = tasks.length;
  if (total === 0) {
    return { pct: 0, empty: true, done: 0, total: 0 };
  }
  const done = tasks.filter((t) => t.done).length;
  return {
    pct: Math.round((100 * done) / total),
    empty: false,
    done,
    total,
  };
}

function ProgressRing({
  valuePct,
  label,
  detail,
  accentColor,
}: {
  valuePct: number;
  label: string;
  /** Ej. "3/5" debajo del label */
  detail?: string;
  accentColor?: string;
}) {
  const r = 22;
  const cx = 28;
  const cy = 28;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, valuePct));
  const dash = (pct / 100) * c;
  const rest = c - dash;
  const stroke = accentColor ?? "currentColor";

  return (
    <div className="flex items-center gap-3">
      <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden>
        <circle cx={cx} cy={cy} r={r} stroke="rgba(0,0,0,0.08)" strokeWidth="7" fill="none" />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          stroke={stroke}
          strokeWidth="7"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${rest}`}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      </svg>
      <div className="min-w-0">
        <div
          className="text-lg font-extrabold leading-tight"
          style={accentColor ? { color: accentColor } : undefined}
        >
          {Math.round(pct)}%
        </div>
        <div className="text-xs text-[var(--ink-muted)]">{label}</div>
        {detail ? (
          <div className="text-[10px] font-semibold tabular-nums text-[var(--ink-faint)]">
            {detail}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DualProgressRing({
  innerPct,
  outerPct,
  innerLabel,
  outerLabel,
}: {
  innerPct: number;
  outerPct: number;
  innerLabel: string;
  outerLabel: string;
}) {
  const size = 80;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = 30;
  const rInner = 20;
  const cOuter = 2 * Math.PI * rOuter;
  const cInner = 2 * Math.PI * rInner;
  const o = Math.max(0, Math.min(100, outerPct));
  const i = Math.max(0, Math.min(100, innerPct));
  const oDash = (o / 100) * cOuter;
  const iDash = (i / 100) * cInner;
  const oRest = cOuter - oDash;
  const iRest = cInner - iDash;

  const outerColor = rgbForAdherencePct(o, false);
  const innerColor = rgbForAdherencePct(i, false);

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={cx} cy={cy} r={rOuter} stroke="rgba(0,0,0,0.08)" strokeWidth="8" fill="none" />
        <circle
          cx={cx}
          cy={cy}
          r={rOuter}
          stroke={outerColor}
          strokeWidth="8"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${oDash} ${oRest}`}
          transform={`rotate(-90 ${cx} ${cy})`}
        />

        <circle cx={cx} cy={cy} r={rInner} stroke="rgba(0,0,0,0.08)" strokeWidth="8" fill="none" />
        <circle
          cx={cx}
          cy={cy}
          r={rInner}
          stroke={innerColor}
          strokeWidth="8"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${iDash} ${iRest}`}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      </svg>

      <div className="min-w-0">
        <div className="text-[10px] font-semibold text-[var(--ink-muted)]">
          <span className="font-extrabold tabular-nums" style={{ color: innerColor }}>
            {Math.round(i)}%
          </span>{" "}
          · {innerLabel}
        </div>
        <div className="mt-1 text-[10px] font-semibold text-[var(--ink-muted)]">
          <span className="font-extrabold tabular-nums" style={{ color: outerColor }}>
            {Math.round(o)}%
          </span>{" "}
          · {outerLabel}
        </div>
      </div>
    </div>
  );
}

/**
 * Niveles 0–4 solo para color del heatmap: relativos a la semana (mismo valor numérico mostrado).
 * Día con menos carga en la semana → verde; el más cargado → rojo; el resto interpolado.
 */
function weeklyLoadRelativeLevels(scores: readonly number[]): number[] {
  const slice = scores.slice(0, 7);
  if (slice.length === 0) return [];
  const min = Math.min(...slice);
  const max = Math.max(...slice);
  if (max <= 0) return slice.map(() => 0);
  if (min === max) return slice.map(() => 2);
  return slice.map((v) => {
    const t = (v - min) / (max - min);
    return Math.min(4, Math.floor(t * 4.999 + 1e-9));
  });
}

function HeatmapWeek({
  values,
  breakdowns,
}: {
  values: readonly number[];
  breakdowns?: readonly string[];
}) {
  const levels = useMemo(() => weeklyLoadRelativeLevels(values), [values]);
  const today = new Date();
  const todayDow = today.getDay(); // 0=Dom
  const todayIdx = todayDow === 0 ? 6 : todayDow - 1; // 0=Lun…6=Dom
  const dayLabels = ["L", "M", "X", "J", "V", "S", "D"];

  const colorFor = (level: number) => {
    if (level <= 0) return "bg-emerald-50 text-emerald-900 border-emerald-100";
    if (level === 1) return "bg-emerald-100/70 text-emerald-900 border-emerald-200";
    if (level === 2) return "bg-amber-100/70 text-amber-900 border-amber-200";
    if (level === 3) return "bg-orange-100/80 text-orange-950 border-orange-200";
    return "bg-red-100/90 text-red-950 border-red-200";
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-7 gap-2">
        {levels.map((lvl, i) => {
          const isToday = i === todayIdx;
          const tooltip = breakdowns?.[i]
            ? `${breakdowns[i]} · índice ${values[i] ?? 0}/100 (color vs resto de la semana)`
            : `Índice ${values[i] ?? 0}/100 · color relativo a esta semana`;
          return (
            <div key={i} className="flex flex-col items-center gap-1">
              <div
                className={`text-[10px] font-bold ${isToday ? "text-[var(--ink)]" : "text-[var(--ink-faint)]"}`}
              >
                {dayLabels[i]}
              </div>
              <div
                className={`h-10 w-10 rounded-xl border ${colorFor(lvl)} flex items-center justify-center font-extrabold text-[11px] relative ${isToday ? "ring-2 ring-offset-1 ring-[var(--ink)]/40" : ""}`}
                title={tooltip}
              >
                {values[i] === 0 ? (
                  <span className="text-[10px] opacity-40">—</span>
                ) : (
                  Math.round(values[i] ?? 0)
                )}
                {isToday && (
                  <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-[var(--ink)]" />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] font-medium leading-snug text-[var(--ink-muted)]">
        Color relativo a esta semana: verde = día menos cargado, rojo = más cargado. El número es el índice absoluto (0–100).
      </p>
    </div>
  );
}

function LineChart({ points, labels }: { points: readonly number[]; labels: readonly string[] }) {
  // SVG polyline normalizando 0..100
  const w = 360;
  const h = 140;
  const pad = 18;
  const max = 100;
  const min = 0;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;

  const toX = (i: number) => pad + (innerW * i) / Math.max(1, points.length - 1);
  const toY = (v: number) => pad + innerH - (innerH * (v - min)) / (max - min);

  const path = points
    .map((v, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(2)} ${toY(v).toFixed(2)}`)
    .join(" ");

  const areaPath = `${path} L ${toX(points.length - 1).toFixed(2)} ${(pad + innerH).toFixed(2)} L ${toX(0).toFixed(2)} ${(pad + innerH).toFixed(2)} Z`;

  return (
    <div className="w-full">
      <svg className="w-full" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Gráfico del Reloj Biológico (mock)">
        <defs>
          <linearGradient id="bioFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(0,0,0,0.12)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.0)" />
          </linearGradient>
        </defs>
        <g opacity="0.9">
          {[0, 25, 50, 75, 100].map((t) => {
            const y = toY(t);
            return <line key={t} x1={pad} x2={w - pad} y1={y} y2={y} stroke="rgba(0,0,0,0.07)" strokeDasharray="3 6" />;
          })}
        </g>
        <path d={areaPath} fill="url(#bioFill)" />
        <path d={path} fill="none" stroke="rgba(0,0,0,0.65)" strokeWidth="3" strokeLinecap="round" />
        {points.map((v, i) => (
          <circle key={i} cx={toX(i)} cy={toY(v)} r={4} fill="white" stroke="rgba(0,0,0,0.6)" strokeWidth="2" />
        ))}
        {labels.map((lab, i) => (
          <text
            key={lab}
            x={toX(i)}
            y={h - 4}
            textAnchor="middle"
            fontSize="11"
            fill="rgba(0,0,0,0.45)"
          >
            {lab}
          </text>
        ))}
      </svg>
    </div>
  );
}

function Doughnut({ segments, centerLabel }: { segments: { value: number; color: string }[]; centerLabel: string }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  let acc = 0;
  const conic = segments
    .map((s) => {
      const start = (acc / total) * 100;
      acc += s.value;
      const end = (acc / total) * 100;
      return `${s.color} ${start}% ${end}%`;
    })
    .join(", ");

  return (
    <div className="relative mx-auto h-40 w-40">
      <div className="absolute inset-0 rounded-full border border-[var(--border)]" style={{ background: `conic-gradient(${conic})` }} />
      <div className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center text-center">
        <div>
          <div className="text-sm font-extrabold">{centerLabel}</div>
          <div className="text-[10px] text-[var(--ink-muted)]">esfuerzo</div>
        </div>
      </div>
    </div>
  );
}

function BurnoutGauge({ valuePct }: { valuePct: number }) {
  const size = 180;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;

  const polar = (angle: number) => {
    const rad = (Math.PI / 180) * angle;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };

  const start = 180;
  const end = 0;
  const v = Math.max(0, Math.min(100, valuePct));
  const cur = start + ((end - start) * v) / 100;

  const s = polar(start);
  const e = polar(cur);
  const largeArc = v > 50 ? 1 : 0;

  const valuePath = `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${largeArc} 1 ${e.x.toFixed(
    2,
  )} ${e.y.toFixed(2)}`;

  const tone =
    v < 35 ? "text-emerald-700" : v < 65 ? "text-amber-700" : "text-red-800";

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="relative">
        <svg width={size} height={size / 1.1} viewBox={`0 0 ${size} ${size}`} aria-label="Índice de Fatiga (mock)">
          <path
            d={`M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(
              2,
            )} 0 1 1 ${polar(end).x.toFixed(2)} ${polar(end).y.toFixed(2)}`}
            stroke="rgba(0,0,0,0.10)"
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
          />
          <path d={valuePath} stroke="currentColor" strokeWidth={stroke} fill="none" strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex items-end justify-center pb-12 pointer-events-none">
          <div className="text-center">
            <div className={`text-2xl font-extrabold ${tone}`}>{Math.round(v)}</div>
            <div className="text-[10px] text-[var(--ink-muted)]">fatiga</div>
          </div>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-[var(--ink-muted)]">Lectura rápida</p>
        <p className="mt-2 text-sm font-bold">
          {v < 35 ? "Vas bien: carga sostenible." : v < 65 ? "Ojo: podrías saturarte." : "Crítico: considera descanso."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Pill tone={v < 35 ? "green" : v < 65 ? "amber" : "red"}>
            {v < 35 ? "Recuperas" : v < 65 ? "Riesgo medio" : "Riesgo alto"}
          </Pill>
          <Pill>Mock</Pill>
        </div>
      </div>
    </div>
  );
}

type UpcomingDelivery = {
  key: string;
  courseName: string;
  title: string;
  dueIso: string | null;
  contentId: string | null;
  creationMs: number | null;
  url?: string | null;
  light: "red" | "yellow";
};

function dueTs(iso: string): number | null {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function formatDue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function relativeDue(iso: string): { label: string; tone: "red" | "amber" | "default" } {
  const t = dueTs(iso);
  if (t == null) return { label: "—", tone: "default" };
  const diff = t - Date.now();
  const mins = Math.round(diff / 60_000);
  const hrs = Math.round(diff / 3_600_000);
  const days = Math.round(diff / 86_400_000);
  if (mins < 0) return { label: "Vencida", tone: "red" };
  if (mins < 90) return { label: `En ${Math.max(1, mins)} min`, tone: "red" };
  if (hrs < 30) return { label: `En ${Math.max(1, hrs)} h`, tone: "amber" };
  return { label: `En ${Math.max(1, days)} d`, tone: "default" };
}

function formatCreationMs(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(ms);
  return d.toLocaleString("es", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function relativeCreationMs(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `Hace ${Math.max(1, mins)} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Hace ${hrs} h`;
  const days = Math.floor(hrs / 24);
  return `Hace ${days} d`;
}

function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function SubmissionPip({ light }: { light: "red" | "yellow" }) {
  const cls =
    light === "red"
      ? "bg-red-500"
      : "bg-amber-400";
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${cls} ring-1 ring-black/10`} aria-hidden />;
}

function UpcomingDeliveriesModal({
  open,
  onClose,
  items,
  title = "Próximas entregas",
  subtitle = "Solo no entregadas · semestre actual (según Blackboard) · ordenadas por fecha.",
}: {
  open: boolean;
  onClose: () => void;
  items: UpcomingDelivery[];
  title?: string;
  subtitle?: string;
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/45 p-0 sm:p-4">
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Cerrar"
        onClick={onClose}
      />
      <div className="relative flex flex-col h-[92vh] sm:h-auto sm:max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-t-3xl sm:rounded-2xl border border-[var(--border)] bg-white shadow-2xl pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3 sm:px-5 sm:py-4 shrink-0">
          <div className="min-w-0">
            <h2 className="truncate text-sm sm:text-base font-extrabold">{title}</h2>
            <p className="mt-0.5 text-[10px] sm:text-xs text-[var(--ink-muted)] line-clamp-1">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1.5 text-[10px] sm:text-xs font-bold text-[var(--ink)]"
          >
            Cerrar
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
          {items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-8 text-center text-xs sm:text-sm text-[var(--ink-muted)]">
              No hay entregas pendientes.
            </div>
          ) : (
            <ul className="space-y-2">
              {items.map((it) => {
                const rel = it.dueIso ? relativeDue(it.dueIso) : null;
                return (
                  <li
                    key={it.key}
                    className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5 sm:p-3"
                  >
                    <div className="flex items-start gap-3">
                      <SubmissionPip light={it.light} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                          <span className="rounded-full bg-[var(--surface-muted)] px-1.5 py-0.5 text-[9px] sm:text-[11px] font-bold text-[var(--ink-muted)]">
                            {it.courseName}
                          </span>
                          {it.dueIso ? (
                            <>
                              <Pill
                                tone={
                                  rel?.tone === "red"
                                    ? "red"
                                    : rel?.tone === "amber"
                                      ? "amber"
                                      : "default"
                                }
                              >
                                <span className="text-[9px] sm:text-[11px]">{rel?.label ?? "—"}</span>
                              </Pill>
                              <span className="text-[9px] sm:text-[11px] text-[var(--ink-faint)]">
                                {formatDue(it.dueIso)}
                              </span>
                            </>
                          ) : (
                            <Pill tone="default"><span className="text-[9px] sm:text-[11px]">Sin fecha</span></Pill>
                          )}
                        </div>
                        <div className="mt-1 truncate text-xs sm:text-sm font-extrabold">{it.title}</div>
                      </div>
                      {it.url ? (
                        <a
                          href={it.url}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1 text-[10px] sm:text-xs font-bold text-[var(--ink)] min-h-[36px]"
                        >
                          Abrir
                        </a>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function StudySessionsModal({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: {
    key: string;
    planTitle: string;
    date: string;
    hours: number;
    sessionTextColor: string;
    sessionTitle?: string;
    focus?: string;
  }[];
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/45 p-0 sm:p-4">
      <button type="button" className="absolute inset-0" aria-label="Cerrar" onClick={onClose} />
      <div className="relative flex flex-col h-[92vh] sm:h-auto sm:max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-t-3xl sm:rounded-2xl border border-[var(--border)] bg-white shadow-2xl pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3 sm:px-5 sm:py-4 shrink-0">
          <div className="min-w-0">
            <h2 className="truncate text-sm sm:text-base font-extrabold">Sesiones de estudio</h2>
            <p className="mt-0.5 text-[10px] sm:text-xs text-[var(--ink-muted)] line-clamp-1">
              Sesiones extraídas de todos los planes de estudio.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1.5 text-[10px] sm:text-xs font-bold text-[var(--ink)]"
          >
            Cerrar
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
          {items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-8 text-center text-xs sm:text-sm text-[var(--ink-muted)]">
              No hay sesiones próximas.
            </div>
          ) : (
            <ul className="space-y-2">
              {items.map((s) => (
                <li
                  key={s.key}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5 sm:p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                        <span
                          className="rounded-full border px-1.5 py-0.5 text-[9px] sm:text-[11px] font-bold"
                          style={{
                            color: s.sessionTextColor,
                            borderColor: s.sessionTextColor,
                            backgroundColor: "color-mix(in srgb, white 84%, transparent)",
                          }}
                        >
                          {s.planTitle}
                        </span>
                        <Pill><span className="text-[9px] sm:text-[11px]">{s.date}</span></Pill>
                        <span className="text-[9px] sm:text-[11px] text-[var(--ink-faint)] font-bold">
                          {Math.round(s.hours * 10) / 10}h
                        </span>
                      </div>
                      <div className="mt-1 truncate text-xs sm:text-sm font-extrabold text-[var(--ink)]">
                        {s.sessionTitle?.trim() ? s.sessionTitle : "Sesión de estudio"}
                      </div>
                      {s.focus?.trim() ? (
                        <div className="mt-1 line-clamp-2 text-[10px] sm:text-xs text-[var(--ink-muted)]">
                          {s.focus}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

const MOCK = {
  acciones: [
    { label: "Historia: entrega de resumen final", urg: true, imp: true, estimateMin: 35, tag: "Alta" },
    { label: "Programación: mini-proyecto (alcance mínimo)", urg: true, imp: true, estimateMin: 50, tag: "Directo" },
    { label: "Física: práctica de cinemática", urg: true, imp: false, estimateMin: 25, tag: "Rápido" },
    { label: "Literatura: plantilla de ensayo", urg: false, imp: true, estimateMin: 40, tag: "Clava" },
    { label: "Álgebra: repaso flashcards", urg: false, imp: true, estimateMin: 30, tag: "Eficiente" },
    { label: "Organización: limpiar carpeta de PDFs", urg: true, imp: false, estimateMin: 15, tag: "Chore" },
    { label: "Meditación ligera", urg: false, imp: false, estimateMin: 10, tag: "Extra" },
  ],
  enfoqueDia: {
    sessionTitle: "Enfoque del Día: Álgebra (repaso profundo)",
    block: "Siguiente sesión",
    startInMin: 12,
    focusPrompt: "Completa 10 ejercicios tipo examen + 10 flashcards de corrección.",
  },
  alertasCriticas: [
    { label: "Historia", riskPct: 18, bullets: ["Falta actividad 3", "Objetivo: nota estable", "Riesgo por no repasar"] },
    { label: "Programación", riskPct: 11, bullets: ["Pendiente mini-proyecto", "Ajustar alcance", "Repaso de rúbrica"] },
  ],
  nextExam: {
    subject: "Historia",
    daysLeft: 5,
    suggestion: "1h de repaso diario (20min resumen + 40min problemas).",
  },
  bio: { points: [35, 42, 55, 70, 63, 58, 40, 30], labels: ["8", "10", "12", "14", "16", "18", "20", "22"] },
  effort: {
    segments: [
      { value: 34, color: "#0a0a0a" },
      { value: 24, color: "#2563eb" },
      { value: 20, color: "#16a34a" },
      { value: 14, color: "#f59e0b" },
      { value: 8, color: "#ef4444" },
    ],
  },
  burnout: { valuePct: 62 },
  streaks: { days: 6, bestDays: 12, message: "Tu racha te está dando inercia. Mantén 1 sesión mínima hoy." },
  distractionsRatio: { studyPct: 72, distractPct: 28 },
} as const;

/** Devuelve los 7 strings YYYY-MM-DD de la semana actual (lunes → domingo). */
function getCurrentWeekDates(): string[] {
  const today = new Date();
  const dow = today.getDay(); // 0=Dom
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return formatLocalYmd(d);
  });
}

/** Minutos de bloques (clase + estudio) para cubrir la franja temporal (~70 pts); misma escala que el diseño original (~6 h). */
const WEEKLY_LOAD_TIMED_MINS_FOR_MAX = 360;

// ── Widget grid (react-grid-layout) ───────────────────────────────────────
const LAYOUT_KEY = "iestudio-dashboard-layout-v4";
const MOBILE_HEIGHTS_KEY = "iestudio-dashboard-mobile-heights-v1";
const WIDGET_IDS = [
  "entregas", "prioridad", "sesiones",
  "enfoque", "examenes", "adherencia",
  "habits",
  "carga", "studytrend",
  "esfuerzo", "burnout",
  "racha", "foco",
] as const;
type WidgetId = (typeof WIDGET_IDS)[number];

// rowHeight = 32px → h:8 ≈ 256 px (one "normal" card)
const ROW_H = 32;

const DEFAULT_LAYOUT: LayoutItem[] = [
  { i: "entregas",   x: 0, y: 0,  w: 4, h: 8, minW: 2, minH: 3 },
  { i: "prioridad",  x: 4, y: 0,  w: 4, h: 8, minW: 2, minH: 3 },
  { i: "sesiones",   x: 8, y: 0,  w: 4, h: 8, minW: 2, minH: 3 },
  { i: "enfoque",    x: 0, y: 8,  w: 4, h: 8, minW: 2, minH: 3 },
  { i: "examenes",   x: 4, y: 8,  w: 4, h: 8, minW: 2, minH: 3 },
  { i: "adherencia", x: 8, y: 8,  w: 4, h: 11, minW: 2, minH: 5 },
  { i: "habits",     x: 0, y: 19, w: 4, h: 8, minW: 2, minH: 3 },
  { i: "carga",      x: 4, y: 19, w: 8, h: 8, minW: 2, minH: 3 },
  { i: "studytrend", x: 0, y: 27, w: 4, h: 8, minW: 2, minH: 3 },
  { i: "esfuerzo",   x: 4, y: 27, w: 4, h: 8, minW: 2, minH: 3 },
  { i: "burnout",    x: 8, y: 27, w: 4, h: 8, minW: 2, minH: 3 },
  { i: "racha",      x: 0, y: 35, w: 4, h: 8, minW: 2, minH: 3 },
  { i: "foco",       x: 4, y: 35, w: 8, h: 8, minW: 2, minH: 3 },
];

function daysUntilLocalDate(ymd: string): number {
  const parts = ymd.split("-").map(Number);
  if (parts.length < 3) return 0;
  const [y, m, d] = parts as [number, number, number];
  const target = new Date(y, m - 1, d);
  target.setHours(0, 0, 0, 0);
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((target.getTime() - base.getTime()) / 86_400_000));
}

function StudyTrendChart({
  data,
}: {
  data: Array<{ label: string; hours: number; isToday: boolean }>;
}) {
  const W = 340; const H = 110; const PX = 8; const PY = 10;
  const LABEL_H = 14;
  const CHART_H = H - PY * 2 - LABEL_H;
  const N = data.length;
  const maxH = Math.max(0.5, ...data.map((d) => d.hours));
  const toX = (i: number) => PX + ((W - PX * 2) * i) / Math.max(1, N - 1);
  const toY = (v: number) => PY + CHART_H - (CHART_H * v) / maxH;
  const pts = data.map((d, i) => ({ ...d, x: toX(i), y: toY(d.hours) }));
  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const base = (PY + CHART_H).toFixed(1);
  const areaPath = N > 1
    ? `${linePath} L ${pts[N - 1]!.x.toFixed(1)} ${base} L ${pts[0]!.x.toFixed(1)} ${base} Z`
    : "";
  const todayIdx = data.findIndex((d) => d.isToday);
  return (
    <div className="w-full">
      <svg className="w-full" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="StudyTrend: sesiones de estudio">
        <defs>
          <linearGradient id="stArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(99,102,241,0.18)" />
            <stop offset="100%" stopColor="rgba(99,102,241,0)" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={PX} x2={W - PX} y1={toY(f * maxH)} y2={toY(f * maxH)}
            stroke="rgba(0,0,0,0.06)" strokeDasharray="3 6" />
        ))}
        {todayIdx >= 0 && (
          <line x1={pts[todayIdx]!.x} x2={pts[todayIdx]!.x} y1={PY} y2={PY + CHART_H}
            stroke="rgba(99,102,241,0.3)" strokeWidth={1} strokeDasharray="3 4" />
        )}
        {areaPath && <path d={areaPath} fill="url(#stArea)" />}
        <path d={linePath} fill="none" stroke="rgb(99,102,241)" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
        {pts.map((p, i) => {
          if (p.hours === 0 && !p.isToday) return null;
          return (
            <circle key={i} cx={p.x} cy={p.y} r={p.isToday ? 4 : 2.5}
              fill={p.isToday ? "rgb(99,102,241)" : "white"}
              stroke="rgb(99,102,241)" strokeWidth={p.isToday ? 2 : 1.5} />
          );
        })}
        {pts.map((p, i) => {
          const show = p.isToday || i === 0 || i === N - 1 || i % 3 === 0;
          if (!show) return null;
          return (
            <text key={i} x={p.x} y={H - 2} textAnchor="middle" fontSize="8"
              fontWeight={p.isToday ? "800" : "500"}
              fill={p.isToday ? "rgb(99,102,241)" : "rgba(0,0,0,0.35)"}>
              {p.label}
            </text>
          );
        })}
        {maxH > 0.5 && (
          <text x={PX + 1} y={PY + 9} fontSize="7" fill="rgba(99,102,241,0.55)">{maxH.toFixed(1)}h</text>
        )}
      </svg>
    </div>
  );
}

function EisenhowerMatrix() {
  const quadrants = [
    { key: "Q1", title: "Urgente + Importante", tone: "danger" as const, tonePill: "red" as const },
    { key: "Q2", title: "Importante (no urgente)", tone: "default" as const, tonePill: "green" as const },
    { key: "Q3", title: "Urgente (no importante)", tone: "warning" as const, tonePill: "amber" as const },
    { key: "Q4", title: "Ni urgente ni importante", tone: "default" as const, tonePill: "default" as const },
  ];

  const pick = (urg: boolean, imp: boolean) =>
    MOCK.acciones
      .filter((a) => a.urg === urg && a.imp === imp)
      .slice(0, 3);

  const q1 = pick(true, true);
  const q2 = pick(false, true);
  const q3 = pick(true, false);
  const q4 = pick(false, false);

  const map = { Q1: q1, Q2: q2, Q3: q3, Q4: q4 } as const;

  return (
    <div className="grid grid-cols-2 gap-3">
      {quadrants.map((q) => {
        const items = map[q.key as keyof typeof map] ?? [];
        const toneBorder =
          q.key === "Q1"
            ? "border-red-200 bg-red-50/40"
            : q.key === "Q2"
              ? "border-emerald-200 bg-emerald-50/35"
              : q.key === "Q3"
                ? "border-amber-200 bg-amber-50/35"
                : "border-[var(--border)] bg-[var(--surface-muted)]";
        return (
          <div key={q.key} className={`rounded-xl border p-3 ${toneBorder}`}>
            <div className="flex items-center justify-between gap-2">
              <Pill tone={q.tonePill === "default" ? "default" : q.tonePill}>{q.key}</Pill>
              <div className="text-[11px] font-bold text-[var(--ink-faint)]">{q.title}</div>
            </div>
            <div className="mt-3 space-y-2">
              {items.length === 0 ? (
                <p className="text-xs text-[var(--ink-muted)]">Sin tareas (mock).</p>
              ) : (
                items.map((it) => (
                  <div key={it.label} className="rounded-lg border border-black/5 bg-white/60 p-2">
                    <div className="truncate text-[12px] font-bold">{it.label}</div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-[var(--ink-muted)]">
                      <span className="font-semibold">{it.tag}</span>
                      <span className="font-mono-cli">{it.estimateMin}min</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function isoToDateOrNull(iso: string): Date | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}

function startOfDay(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setHours(0, 0, 0, 0);
  return x;
}

function computeHabitRates(): {
  today: { pct: number; done: number; total: number; empty: boolean };
  overall: { pct: number; done: number; total: number; empty: boolean };
} {
  const habits = loadHabits();
  const logs = loadHabitLogsFile();
  const today = startOfDay(new Date());

  // ── Hoy: hábitos programados hoy (incluye archived=false por UX)
  const todayHabits = habits.filter((h) => !h.archived).filter((h) => isHabitScheduledOnDate(h, today));
  let todayTotal = todayHabits.length;
  let todayDone = 0;
  for (const h of todayHabits) {
    const pk = periodKeyForHabitToday(h);
    const e = logs.byPeriod[pk]?.[h.id];
    if (isHabitLogDone(h, e)) todayDone++;
  }
  const todayEmpty = todayTotal === 0;
  const todayPct = todayEmpty ? 0 : Math.round((100 * todayDone) / todayTotal);

  // ── Overall (histórico): contamos “oportunidades” por periodo:
  // - weekdays → cada día programado desde createdAt hasta hoy
  // - times_per_week → cada semana (lunes) desde createdAt hasta hoy
  let overallTotal = 0;
  let overallDone = 0;
  const maxDaysScan = 365 * 3; // safety

  for (const h of habits) {
    const created = isoToDateOrNull(h.createdAt) ?? today;

    if (h.schedule.mode === "times_per_week") {
      // iterate weeks (by monday ymd key)
      const curMonday = startOfDay(today);
      const baseMonday = startOfDay(created);
      // align baseMonday to Monday
      const dow = baseMonday.getDay(); // 0=Dom
      const monday = new Date(baseMonday);
      monday.setDate(baseMonday.getDate() - (dow === 0 ? 6 : dow - 1));
      monday.setHours(0, 0, 0, 0);

      let w = new Date(monday);
      let safety = 0;
      while (w.getTime() <= curMonday.getTime() && safety < 400) {
        const pk = periodKeyForHabitOnDate(h, w);
        overallTotal++;
        const e = logs.byPeriod[pk]?.[h.id];
        if (isHabitLogDone(h, e)) overallDone++;
        w.setDate(w.getDate() + 7);
        safety++;
      }
      continue;
    }

    // weekdays daily scan
    let d = startOfDay(created);
    let safety = 0;
    while (d.getTime() <= today.getTime() && safety < maxDaysScan) {
      if (isHabitScheduledOnDate(h, d)) {
        const pk = periodKeyForHabitOnDate(h, d);
        overallTotal++;
        const e = logs.byPeriod[pk]?.[h.id];
        if (isHabitLogDone(h, e)) overallDone++;
      }
      d.setDate(d.getDate() + 1);
      safety++;
    }
  }

  const overallEmpty = overallTotal === 0;
  const overallPct = overallEmpty ? 0 : Math.round((100 * overallDone) / overallTotal);
  return {
    today: { pct: todayPct, done: todayDone, total: todayTotal, empty: todayEmpty },
    overall: { pct: overallPct, done: overallDone, total: overallTotal, empty: overallEmpty },
  };
}

export function DashboardOverviewPanel() {
  const cloudSync = useCloudSyncStatus();
  const [upcomingModalOpen, setUpcomingModalOpen] = useState(false);
  const [criticalModalOpen, setCriticalModalOpen] = useState(false);
  const [studyModalOpen, setStudyModalOpen] = useState(false);
  const [bbRevision, setBbRevision] = useState(0);
  const [contentFetchBusy, setContentFetchBusy] = useState(false);
  const [studyPlansRevision, setStudyPlansRevision] = useState(0);
  const [deadlinesRevision, setDeadlinesRevision] = useState(0);
  const [checklistRevision, setChecklistRevision] = useState(0);
  const [arenaCompletedRevision, setArenaCompletedRevision] = useState(0);
  const [habitsRevision, setHabitsRevision] = useState(0);
  const [habitLogsRevision, setHabitLogsRevision] = useState(0);

  useEffect(() => {
    if (cloudSync?.initialSyncDone) {
      setBbRevision((n) => n + 1);
    }
  }, [cloudSync?.initialSyncDone]);

  useEffect(() => {
    function bump() {
      setBbRevision((n) => n + 1);
    }
    window.addEventListener(BB_COURSES_STORAGE_CHANGED, bump);
    window.addEventListener(BB_GRADEBOOK_STORAGE_CHANGED, bump);
    window.addEventListener(BB_CONTENT_META_CHANGED, bump);
    function onStorage(e: StorageEvent) {
      if (!e.key) return;
      if (
        e.key === "iestudio-bb-courses" ||
        e.key.startsWith("iestudio-bb-gb-") ||
        e.key.startsWith("iestudio-bb-content-first-lastmod-")
      ) {
        bump();
      }
    }
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(BB_COURSES_STORAGE_CHANGED, bump);
      window.removeEventListener(BB_GRADEBOOK_STORAGE_CHANGED, bump);
      window.removeEventListener(BB_CONTENT_META_CHANGED, bump);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    function bump() {
      setDeadlinesRevision((n) => n + 1);
    }
    window.addEventListener(DEADLINES_CHANGED_EVENT, bump);
    function onStorage(e: StorageEvent) {
      if (e.key === DEADLINES_STORAGE_KEY) bump();
    }
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(DEADLINES_CHANGED_EVENT, bump);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    function bump() {
      setStudyPlansRevision((n) => n + 1);
    }
    window.addEventListener(STUDY_PLANS_CHANGED_EVENT, bump);
    function onStorage(e: StorageEvent) {
      if (e.key === "iestudio-study-plans") bump();
    }
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(STUDY_PLANS_CHANGED_EVENT, bump);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    function bump() {
      setChecklistRevision((n) => n + 1);
    }
    window.addEventListener(DAILY_CHECKLIST_CHANGED_EVENT, bump);
    function onStorage(e: StorageEvent) {
      if (e.key === DAILY_CHECKLIST_STORAGE_KEY) bump();
    }
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(DAILY_CHECKLIST_CHANGED_EVENT, bump);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    function bump() {
      setArenaCompletedRevision((n) => n + 1);
    }
    window.addEventListener(STUDY_ARENA_COMPLETED_CHANGED_EVENT, bump);
    function onStorage(e: StorageEvent) {
      if (e.key === STUDY_ARENA_COMPLETED_STORAGE_KEY) bump();
    }
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(STUDY_ARENA_COMPLETED_CHANGED_EVENT, bump);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    function bump() {
      setHabitsRevision((n) => n + 1);
    }
    window.addEventListener(HABITS_CHANGED_EVENT, bump);
    function onStorage(e: StorageEvent) {
      if (e.key === HABITS_STORAGE_KEY) bump();
    }
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(HABITS_CHANGED_EVENT, bump);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    function bump() {
      setHabitLogsRevision((n) => n + 1);
    }
    window.addEventListener(HABIT_LOGS_CHANGED_EVENT, bump);
    function onStorage(e: StorageEvent) {
      if (e.key === HABIT_LOGS_STORAGE_KEY) bump();
    }
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(HABIT_LOGS_CHANGED_EVENT, bump);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  function extractLastModifiedMsFromContentPayload(payload: unknown): number | null {
    const seen = new Set<unknown>();
    const stack: unknown[] = [payload];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (!cur || typeof cur !== "object") continue;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const o = cur as Record<string, unknown>;
      const lm = o.lastModifiedDate ?? o.lastModificationDate;
      if (typeof lm === "string" && lm.trim()) {
        const ms = Date.parse(lm);
        if (!Number.isNaN(ms)) return ms;
      }
      if (typeof o.modifiedDate === "number" && Number.isFinite(o.modifiedDate)) {
        // Fallback top-level, pero solo si no encontramos lastModifiedDate string en el árbol.
        // No retornamos aquí inmediatamente para dar prioridad a lastModifiedDate.
      }
      for (const v of Object.values(o)) {
        if (v && typeof v === "object") stack.push(v);
      }
    }
    if (payload && typeof payload === "object") {
      const root = payload as Record<string, unknown>;
      const md = root.modifiedDate;
      if (typeof md === "number" && Number.isFinite(md)) return md;
    }
    return null;
  }

  async function fetchAndCacheFirstCreationMs(courseId: string, contentId: string): Promise<void> {
    const already = loadBbContentFirstLastModifiedMs(courseId, contentId);
    if (already != null) return;
    const cfg = loadBbConfig();
    if (!cfg?.baseUrl) return;
    const payload = await bridgeBlackboardFetch<unknown>(
      `/learn/api/v1/courses/${encodeURIComponent(courseId)}/contents/${encodeURIComponent(contentId)}`,
      cfg.baseUrl,
    );
    const ms = extractLastModifiedMsFromContentPayload(payload);
    if (ms != null) {
      saveBbContentFirstLastModifiedMs(courseId, contentId, ms);
    }
  }

  const upcomingDeliveries = useMemo<UpcomingDelivery[]>(() => {
    if (typeof window === "undefined") return [];
    const snap = readBbDisplayedCoursesSnapshot();
    if (!snap.hasConfig) return [];
    const now = Date.now();

    // Forzamos el semestre actual con la regla existente de Blackboard:
    // __auto__ => Q2 si hay Q2; si no, Q1; además incluye OTHER.
    const semesterCourses = filterCoursesByMode(snap.curatedCourses, "__auto__");
    const byId = new Map(semesterCourses.map((c) => [c.learnCourseId, c]));

    const out: UpcomingDelivery[] = [];
    for (const c of semesterCourses) {
      const gb = loadBbGradebook(c.learnCourseId);
      const cols = gb?.columns ?? [];
      for (const col of cols) {
        const due = col.grading?.due;
        const light = getSubmissionLight(col.submissionReason, col.submissionSubmitted);
        if (light !== "red" && light !== "yellow") continue; // no entregado todavía

        const courseName = byId.get(c.learnCourseId)?.name ?? c.name;
        const title = (col.displayName ?? col.name ?? "Entrega").trim() || "Entrega";
        if (due) {
          const t = dueTs(due);
          if (t == null) continue;
          // Solo próximas: excluir ya vencidas.
          if (t < now) continue;
          out.push({
            key: `${c.learnCourseId}\u0000${col.id}`,
            courseName,
            title,
            dueIso: due,
            contentId: col.contentId ? String(col.contentId) : null,
            creationMs: null,
            url: resolveGradebookColumnUltraUrl(c.learnCourseId, col, {
              gradebookCategoryTitles:
                loadBbGradebook(c.learnCourseId)?.gradebookCategoryTitles,
            }),
            light,
          });
        } else {
          const contentId = col.contentId ? String(col.contentId) : null;
          const creationMs =
            contentId ? loadBbContentFirstLastModifiedMs(c.learnCourseId, contentId) : null;
          out.push({
            key: `${c.learnCourseId}\u0000${col.id}`,
            courseName,
            title,
            dueIso: null,
            contentId,
            creationMs,
            url: resolveGradebookColumnUltraUrl(c.learnCourseId, col, {
              gradebookCategoryTitles:
                loadBbGradebook(c.learnCourseId)?.gradebookCategoryTitles,
            }),
            light,
          });
        }
      }
    }

    const withDue = out
      .filter((x) => x.dueIso)
      .sort((a, b) => (dueTs(a.dueIso!) ?? 0) - (dueTs(b.dueIso!) ?? 0));
    const noDue = out
      .filter((x) => !x.dueIso)
      .sort((a, b) => {
        const am = a.creationMs ?? -1;
        const bm = b.creationMs ?? -1;
        return bm - am; // más reciente primero; null al final
      });
    return [...withDue, ...noDue];
  }, [bbRevision]);

  const top3 = useMemo(() => upcomingDeliveries.slice(0, 3), [upcomingDeliveries]);

  const upcomingStudySessions = useMemo(() => {
    if (typeof window === "undefined") return [];
    const todayYmd = formatLocalYmd(new Date());
    const deadlines = loadImportantDeadlines();
    const deadlineById = new Map(deadlines.map((d) => [d.id, d]));
    const plans = loadStudyPlans();
    const out: {
      key: string;
      planTitle: string;
      date: string;
      hours: number;
      sessionTitle?: string;
      focus?: string;
      sessionTextColor: string;
    }[] = [];
    for (const p of plans) {
      const linkedDeadline = p.targetDeadlineId
        ? deadlineById.get(p.targetDeadlineId)
        : undefined;
      const colorText = getGoogleEventColorStyle(linkedDeadline?.calendarColorId).text;
      const days = p.aiSchedule?.days ?? [];
      for (const d of days) {
        if (!d?.date) continue;
        if (d.date < todayYmd) continue;
        out.push({
          key: `${p.id}\u0000${d.date}\u0000${d.sessionTitle ?? ""}`,
          planTitle: p.title,
          date: d.date,
          hours: d.studyHours,
          sessionTitle: d.sessionTitle,
          focus: d.focus,
          sessionTextColor: colorText,
        });
      }
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  }, [studyPlansRevision, deadlinesRevision]);

  /** Sesiones del plan solo para hoy + estado Study Arena (mismo `key` que al completar). */
  const todayPlanningSessions = useMemo(() => {
    if (typeof window === "undefined") return [];
    void arenaCompletedRevision;
    const todayYmd = formatLocalYmd(new Date());
    const completedKeys = new Set(loadCompletedSessions().map((s) => s.key));
    const deadlines = loadImportantDeadlines();
    const deadlineById = new Map(deadlines.map((d) => [d.id, d]));
    const plans = loadStudyPlans();
    const out: {
      arenaKey: string;
      planTitle: string;
      date: string;
      hours: number;
      sessionTitle?: string;
      focus?: string;
      sessionTextColor: string;
      completed: boolean;
    }[] = [];
    for (const p of plans) {
      const linkedDeadline = p.targetDeadlineId
        ? deadlineById.get(p.targetDeadlineId)
        : undefined;
      const colorText = getGoogleEventColorStyle(linkedDeadline?.calendarColorId).text;
      const days = p.aiSchedule?.days ?? [];
      for (const d of days) {
        if (!d?.date || d.date !== todayYmd) continue;
        const arenaKey = `${p.id}::${d.date}`;
        out.push({
          arenaKey,
          planTitle: p.title,
          date: d.date,
          hours: d.studyHours,
          sessionTitle: d.sessionTitle,
          focus: d.focus,
          sessionTextColor: colorText,
          completed: completedKeys.has(arenaKey),
        });
      }
    }
    out.sort((a, b) => {
      const ca = a.completed === b.completed ? 0 : a.completed ? 1 : -1;
      if (ca !== 0) return ca;
      return a.planTitle.localeCompare(b.planTitle, "es");
    });
    return out;
  }, [studyPlansRevision, deadlinesRevision, arenaCompletedRevision]);

  const effortByObjective = useMemo(() => {
    type Item = {
      label: string;
      hours: number;
      pct: number;
      color: string;
    };

    const deadlines = loadImportantDeadlines().filter((d) => !d.id.startsWith("study-"));
    const plans = loadStudyPlans();

    const totalByDeadline = new Map<string, number>();
    for (const p of plans) {
      const targetId = p.targetDeadlineId;
      if (!targetId) continue;
      const days = p.aiSchedule?.days ?? [];
      const totalHours = days.reduce((s, d) => s + (Number.isFinite(d.studyHours) ? d.studyHours : 0), 0);
      if (!(totalHours > 0)) continue;
      totalByDeadline.set(targetId, (totalByDeadline.get(targetId) ?? 0) + totalHours);
    }

    const entries = deadlines
      .map((d) => {
        const hours = totalByDeadline.get(d.id) ?? 0;
        return { d, hours };
      })
      .filter((x) => x.hours > 0)
      .sort((a, b) => {
        const cmp = a.d.date.localeCompare(b.d.date);
        if (cmp !== 0) return cmp;
        const ta = a.d.time ?? "";
        const tb = b.d.time ?? "";
        if (ta !== tb) return ta.localeCompare(tb);
        return a.d.title.localeCompare(b.d.title, "es");
      });

    const totalHoursAll = entries.reduce((s, x) => s + x.hours, 0);
    if (!(totalHoursAll > 0)) {
      return { items: [] as Item[], segments: [] as { value: number; color: string }[] };
    }

    const items: Item[] = entries.map((x) => {
      const style = getGoogleEventColorStyle(x.d.calendarColorId);
      return {
        label: x.d.title,
        hours: x.hours,
        pct: (x.hours / totalHoursAll) * 100,
        color: style.borderLeft,
      };
    });

    return {
      items,
      segments: items.map((it) => ({ value: it.hours, color: it.color })),
    };
  }, [studyPlansRevision, deadlinesRevision]);

  /**
   * Carga semanal real (lun-dom): índice 0–100 absoluto por día (estudio+clase en minutos, eventos, BB).
   * El color del heatmap no usa estos umbrales: es relativo al min/max de la semana.
   */
  const weeklyLoad = useMemo<number[]>(() => {
    if (typeof window === "undefined") return Array(7).fill(0);

    const weekDates = getCurrentWeekDates();
    const deadlines = loadImportantDeadlines();

    const timedMinsByDate = new Map<string, number>();
    const importantBareByDate = new Map<string, number>();

    for (const d of deadlines) {
      if (!weekDates.includes(d.date)) continue;
      if (d.id.startsWith("study-")) {
        const mins = d.durationMinutes ?? 60;
        timedMinsByDate.set(d.date, (timedMinsByDate.get(d.date) ?? 0) + mins);
        continue;
      }
      const dm = d.durationMinutes;
      if (dm != null && dm > 0) {
        timedMinsByDate.set(d.date, (timedMinsByDate.get(d.date) ?? 0) + dm);
      } else {
        importantBareByDate.set(d.date, (importantBareByDate.get(d.date) ?? 0) + 1);
      }
    }

    // Entregas Blackboard (sin entregar, con fecha de entrega esta semana)
    const bbDeadlinesByDate = new Map<string, number>();
    const snap = readBbDisplayedCoursesSnapshot();
    if (snap.hasConfig) {
      const courses = filterCoursesByMode(snap.curatedCourses, "__auto__");
      for (const course of courses) {
        const cols = loadBbGradebook(course.learnCourseId)?.columns ?? [];
        for (const col of cols) {
          const light = getSubmissionLight(col.submissionReason, col.submissionSubmitted);
          if (light !== "red" && light !== "yellow") continue;
          const due = col.grading?.due;
          if (!due) continue;
          const dueDate = due.slice(0, 10); // YYYY-MM-DD
          if (!weekDates.includes(dueDate)) continue;
          bbDeadlinesByDate.set(dueDate, (bbDeadlinesByDate.get(dueDate) ?? 0) + 1);
        }
      }
    }

    return weekDates.map((date) => {
      const timedMins = timedMinsByDate.get(date) ?? 0;
      const bareImp = importantBareByDate.get(date) ?? 0;
      const bbDue = bbDeadlinesByDate.get(date) ?? 0;

      const timedLoad = Math.min(
        70,
        (timedMins / WEEKLY_LOAD_TIMED_MINS_FOR_MAX) * 70,
      );
      const eventLoad = Math.min(30, (bareImp + bbDue) * 15);

      return Math.round(Math.min(100, timedLoad + eventLoad));
    });
  }, [studyPlansRevision, deadlinesRevision, bbRevision]);

  /**
   * Descripción de la carga de cada día para el tooltip/título del heatmap.
   * weeklyLoadBreakdown[i] = string legible del día i de la semana actual.
   */
  const weeklyLoadBreakdown = useMemo<string[]>(() => {
    if (typeof window === "undefined") return Array(7).fill("");
    const weekDates = getCurrentWeekDates();
    const deadlines = loadImportantDeadlines();
    return weekDates.map((date) => {
      const studySessions = deadlines.filter((d) => d.id.startsWith("study-") && d.date === date);
      const studyMins = studySessions.reduce((s, d) => s + (d.durationMinutes ?? 60), 0);
      const timedOthers = deadlines
        .filter((d) => !d.id.startsWith("study-") && d.date === date)
        .reduce((s, d) => s + (d.durationMinutes && d.durationMinutes > 0 ? d.durationMinutes : 0), 0);
      const timedTotal = studyMins + timedOthers;
      const bareCount = deadlines.filter(
        (d) =>
          !d.id.startsWith("study-") &&
          d.date === date &&
          !(d.durationMinutes != null && d.durationMinutes > 0),
      ).length;
      const parts: string[] = [];
      if (timedTotal > 0) {
        parts.push(
          `${Math.round((timedTotal / 60) * 10) / 10}h bloques (clase+estudio)`,
        );
      }
      if (bareCount > 0) parts.push(`${bareCount} fecha${bareCount > 1 ? "s" : ""} (sin duración)`);
      return parts.length ? parts.join(" · ") : "Sin carga";
    });
  }, [studyPlansRevision, deadlinesRevision]);

  // ── Exámenes y Fechas ─────────────────────────────────────────────────────
  const nextExams = useMemo(() => {
    if (typeof window === "undefined") return [];
    const todayYmd = formatLocalYmd(new Date());
    return loadImportantDeadlines()
      .filter((d) => !d.id.startsWith("study-") && d.date >= todayYmd)
      .sort((a, b) => {
        const c = a.date.localeCompare(b.date);
        if (c !== 0) return c;
        return (a.time ?? "23:59").localeCompare(b.time ?? "23:59");
      })
      .slice(0, 2);
  }, [deadlinesRevision]);

  // ── StudyTrend ────────────────────────────────────────────────────────────
  const studyTrendData = useMemo(() => buildStudyTrendChartData(), [deadlinesRevision]);

  const taskAdherence = useMemo(() => {
    if (typeof window === "undefined") {
      return {
        today: { pct: 0, empty: true, done: 0, total: 0 },
        weekDaily: { pct: 0, empty: true, done: 0, total: 0 },
        weekScope: { pct: 0, empty: true, done: 0, total: 0 },
      };
    }
    const all = loadChecklistTasks();
    const todayYmd = formatLocalYmd(new Date());
    const weekDates = getCurrentWeekDates();
    const weekMonday = weekDates[0] ?? todayYmd;

    const todayList = all.filter(
      (t) => t.scope === "day" && t.periodKey === todayYmd,
    );
    const weekDailyList = all.filter(
      (t) => t.scope === "day" && weekDates.includes(t.periodKey),
    );
    const weekScopeList = all.filter(
      (t) => t.scope === "week" && t.periodKey === weekMonday,
    );

    return {
      today: completionMeta(todayList),
      weekDaily: completionMeta(weekDailyList),
      weekScope: completionMeta(weekScopeList),
    };
  }, [checklistRevision]);

  const habitRates = useMemo(() => {
    void habitsRevision;
    void habitLogsRevision;
    return computeHabitRates();
  }, [habitsRevision, habitLogsRevision]);

  const taskAdherenceHint = useMemo(() => {
    const { today: t, weekDaily: w, weekScope: s } = taskAdherence;
    if (t.empty && w.empty && s.empty) {
      return "Añade tareas en la sección Tareas (Diaria o Semanal) para ver tu adherencia aquí.";
    }
    const parts: string[] = [];
    if (!t.empty) {
      if (t.pct >= 100) parts.push("Hoy completaste todas las tareas diarias.");
      else if (t.pct >= 70) {
        parts.push(`Hoy vas bien: ${t.done}/${t.total} diarias hechas.`);
      } else {
        parts.push(
          t.total > 0
            ? `Hoy quedan ${t.total - t.done} tareas diarias por cerrar.`
            : "Revisa tus tareas diarias.",
        );
      }
    }
    if (!w.empty && w.total > 0) {
      if (w.pct >= 100) {
        parts.push("Esta semana todas las diarias están hechas.");
      } else {
        parts.push(
          `Diarias de la semana: ${w.done}/${w.total} completadas (lunes–domingo).`,
        );
      }
    }
    if (!s.empty && s.total > 0) {
      if (s.pct >= 100) {
        parts.push("Lista semanal completada.");
      } else {
        parts.push(`Semanales: ${s.done}/${s.total} hechas.`);
      }
    }
    return parts.join(" ");
  }, [taskAdherence]);

  // ── Widget layout (react-grid-layout) ────────────────────────────────────
  const [layout, setLayout] = useState<LayoutItem[]>(() => {
    if (typeof window === "undefined") return [...DEFAULT_LAYOUT];
    try {
      const saved = localStorage.getItem(LAYOUT_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as LayoutItem[];
        const savedById = new Map(parsed.map((l) => [l.i, l]));
        return DEFAULT_LAYOUT.map((def) => ({ ...def, ...(savedById.get(def.i) ?? {}) }));
      }
    } catch { /* */ }
    return [...DEFAULT_LAYOUT];
  });

  const [currentBreakpoint, setCurrentBreakpoint] = useState<string>("lg");
  const currentBreakpointRef = useRef<string>("lg");
  const isDesktop = currentBreakpoint === "lg";

  // Independent mobile heights (don't affect desktop)
  const [mobileHeights, setMobileHeights] = useState<Record<string, number>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const saved = localStorage.getItem(MOBILE_HEIGHTS_KEY);
      if (saved) return JSON.parse(saved) as Record<string, number>;
    } catch { /* */ }
    return {};
  });

  // Mobile layout: desktop order (y then x), independent heights, fixed x/w
  const mobileLayout = useMemo<LayoutItem[]>(() => {
    const sorted = [...layout].sort((a, b) => a.y - b.y || a.x - b.x);
    let y = 0;
    return sorted.map((item) => {
      const h = mobileHeights[item.i] ?? item.h;
      const li: LayoutItem = { i: item.i, x: 0, y, w: 1, h, minH: 3, minW: 1, maxW: 1 };
      y += h;
      return li;
    });
  }, [layout, mobileHeights]);

  const [editMode, setEditMode] = useState(false);

  const modalBtnClass =
    "rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1.5 text-xs font-bold text-[var(--ink)] hover:bg-white";

  const criticalAlerts = useMemo<UpcomingDelivery[]>(() => {
    if (typeof window === "undefined") return [];
    const snap = readBbDisplayedCoursesSnapshot();
    if (!snap.hasConfig) return [];
    const now = Date.now();

    const semesterCourses = filterCoursesByMode(snap.curatedCourses, "__auto__");
    const byId = new Map(semesterCourses.map((c) => [c.learnCourseId, c]));

    const overdue: UpcomingDelivery[] = [];
    const noDueCreated: UpcomingDelivery[] = [];

    for (const c of semesterCourses) {
      const gb = loadBbGradebook(c.learnCourseId);
      const cols = gb?.columns ?? [];
      for (const col of cols) {
        const light = getSubmissionLight(col.submissionReason, col.submissionSubmitted);
        if (light !== "red" && light !== "yellow") continue;

        const courseName = byId.get(c.learnCourseId)?.name ?? c.name;
        const title = (col.displayName ?? col.name ?? "Entrega").trim() || "Entrega";
        const contentId = col.contentId ? String(col.contentId) : null;
        const due = col.grading?.due;

        if (due) {
          const t = dueTs(due);
          if (t == null) continue;
          if (t >= now) continue; // aquí solo vencidas
          overdue.push({
            key: `${c.learnCourseId}\u0000${col.id}`,
            courseName,
            title,
            dueIso: due,
            contentId,
            creationMs: null,
            url: resolveGradebookColumnUltraUrl(c.learnCourseId, col, {
              gradebookCategoryTitles:
                loadBbGradebook(c.learnCourseId)?.gradebookCategoryTitles,
            }),
            light,
          });
        } else if (contentId) {
          const creationMs = loadBbContentFirstLastModifiedMs(c.learnCourseId, contentId);
          noDueCreated.push({
            key: `${c.learnCourseId}\u0000${col.id}`,
            courseName,
            title,
            dueIso: null,
            contentId,
            creationMs,
            url: resolveGradebookColumnUltraUrl(c.learnCourseId, col, {
              gradebookCategoryTitles:
                loadBbGradebook(c.learnCourseId)?.gradebookCategoryTitles,
            }),
            light,
          });
        }
      }
    }

    overdue.sort((a, b) => (dueTs(b.dueIso!) ?? 0) - (dueTs(a.dueIso!) ?? 0)); // más recientemente vencidas primero
    noDueCreated.sort((a, b) => (b.creationMs ?? -1) - (a.creationMs ?? -1)); // más reciente primero (null al final)

    return [...overdue, ...noDueCreated];
  }, [bbRevision]);

  useEffect(() => {
    // Fetch perezoso: solo para completar el top3 en el dashboard; y al abrir el modal, para todo.
    let cancelled = false;
    const need = upcomingModalOpen ? upcomingDeliveries.length : 3;
    const candidates = [
      ...upcomingDeliveries.slice(0, need),
      ...criticalAlerts.slice(0, 8),
    ].filter((it) => !it.dueIso && it.contentId && it.creationMs == null);
    if (candidates.length === 0) return;

    void (async () => {
      setContentFetchBusy(true);
      try {
        // Concurrencia moderada + batches (especialmente en "Ver todas").
        const batchSize = upcomingModalOpen ? 10 : candidates.length;
        for (let i = 0; i < candidates.length; i += batchSize) {
          if (cancelled) break;
          const batch = candidates.slice(i, i + batchSize);
          await Promise.all(
            batch.map((it) =>
              fetchAndCacheFirstCreationMs(it.key.split("\u0000")[0]!, it.contentId!),
            ),
          );
        }
      } finally {
        if (!cancelled) setContentFetchBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [upcomingDeliveries, criticalAlerts, upcomingModalOpen]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 py-3 sm:gap-4 sm:px-6 sm:py-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-extrabold tracking-tight sm:text-2xl">Panel de Control</h1>
          <p className="mt-0.5 text-[11px] sm:text-sm text-[var(--ink-muted)]">
            Widgets y métricas optimizadas para tu móvil (iOS).
          </p>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 scrollbar-hide">
          <Pill>Actualizado: hoy</Pill>
          <Pill tone="amber">Modo: demo</Pill>
          <button
            type="button"
            onClick={() => setEditMode((v) => !v)}
            className={`rounded-full border px-3 py-1 text-[11px] font-bold transition-colors ${
              editMode
                ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                : "border-[var(--border)] bg-[var(--surface-muted)] text-[var(--ink-muted)]"
            }`}
          >
            {editMode ? "✓ Listo" : "⠿ Ordenar"}
          </button>
        </div>
      </header>

      <GridLayout
        className="layout"
        layouts={{ lg: layout, sm: mobileLayout }}
        breakpoints={{ lg: 768, sm: 0 }}
        cols={{ lg: 12, sm: 1 }}
        rowHeight={ROW_H}
        isDraggable={editMode && isDesktop}
        isResizable={isDesktop ? editMode : true}
        resizeHandles={isDesktop ? ["se"] : ["s"]}
        compactType={null}
        preventCollision={false}
        margin={[12, 12]}
        onBreakpointChange={(bp: string) => { setCurrentBreakpoint(bp); currentBreakpointRef.current = bp; }}
        onLayoutChange={(cur: Layout) => {
          if (currentBreakpointRef.current === "lg") {
            const items = [...cur];
            setLayout(items);
            try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(items)); } catch { /* */ }
          } else {
            const heights: Record<string, number> = {};
            for (const item of cur) heights[item.i] = item.h;
            setMobileHeights(heights);
            try { localStorage.setItem(MOBILE_HEIGHTS_KEY, JSON.stringify(heights)); } catch { /* */ }
          }
        }}
      >
        {WIDGET_IDS.map((wid) => (
          <div key={wid} className="relative overflow-hidden shadow-none">
            {editMode && (
              <div className="pointer-events-none absolute left-2 top-2 z-30 flex h-6 w-6 select-none items-center justify-center rounded-lg bg-indigo-600/90 text-sm text-white shadow">
                ⠿
              </div>
            )}

            {/* ── Próximas Entregas ── */}
              {wid === "entregas" && (
                <section className="relative h-full overflow-hidden rounded-3xl border border-zinc-200/50 bg-white/40 backdrop-blur-md transition-colors duration-300 group">
                  <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-zinc-100/50 blur-3xl group-hover:bg-zinc-200/50 transition-colors" />
                  <div className="relative flex h-full flex-col p-5">
                    <header className="flex items-center justify-between mb-4">
                      <div className="min-w-0">
                        <h3 className="text-sm font-black uppercase tracking-widest text-zinc-400">Entregas</h3>
                        <div className="flex items-center gap-2 mt-0.5">
                          <div className="h-1.5 w-1.5 rounded-full bg-zinc-800 animate-pulse" />
                          <p className="text-xs font-bold text-zinc-800">Próximas 3</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setUpcomingModalOpen(true)}
                        className="h-8 w-8 flex items-center justify-center rounded-full bg-zinc-900 text-white shadow-lg active:scale-90 transition-transform"
                      >
                        <span className="flex items-center justify-center text-xl leading-none select-none">+</span>
                      </button>
                    </header>
                    <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide pr-1">
                      {top3.length === 0 ? (
                        <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-white/20 px-4 text-center">
                          <p className="text-xs font-medium text-zinc-400">Sin entregas pendientes</p>
                        </div>
                      ) : (
                        <ul className="space-y-2 relative">
                          <div className="absolute left-2.5 top-2 bottom-2 w-px bg-zinc-200/60" />
                          {top3.map((it) => {
                            const rel = it.dueIso ? relativeDue(it.dueIso) : null;
                            return (
                              <li key={it.key} className="relative pl-7 group/item h-[4.25rem]">
                                <div className="absolute left-1.5 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-white ring-2 ring-zinc-800 z-10" />
                                <div className="h-full flex items-center rounded-xl border border-white bg-white/60 px-3 shadow-sm transition-all hover:bg-white hover:shadow-md active:bg-zinc-50">
                                  <div className="flex flex-col justify-center gap-0.5 w-full">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex items-center gap-1.5 overflow-hidden">
                                        <span className="truncate text-[8px] font-black uppercase tracking-tighter text-zinc-400 px-1.5 py-0.5 rounded-md bg-zinc-100 shrink-0">
                                          {it.courseName}
                                        </span>
                                        <span className={`text-[8px] font-black uppercase shrink-0 ${rel?.tone === "red" ? "text-red-500" : "text-amber-500"}`}>
                                          {rel?.label}
                                        </span>
                                      </div>
                                      {it.url && (
                                        <a href={it.url} target="_blank" rel="noreferrer"
                                          className="shrink-0 h-6 w-6 flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 transition-colors">
                                          <span className="text-[10px] font-bold">↗</span>
                                        </a>
                                      )}
                                    </div>
                                    <div className="truncate text-sm font-black text-zinc-900 leading-tight">{it.title}</div>
                                  </div>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                    {contentFetchBusy && (
                      <div className="mt-2 text-[9px] font-bold text-center text-zinc-400 uppercase tracking-widest animate-pulse">
                        Sincronizando...
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* ── Prioridad Máxima ── */}
              {wid === "prioridad" && (
                <section className="relative h-full overflow-hidden rounded-3xl border-2 border-red-500/20 bg-[#fffafa] transition-colors duration-300">
                  <div className="relative flex h-full flex-col p-4 sm:p-5">
                    <header className="flex items-center justify-between mb-3">
                      <div className="min-w-0">
                        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-red-600">Prioridad Máxima</h3>
                        <p className="text-xl font-black tracking-tighter text-red-950">Alertas</p>
                      </div>
                      <button type="button" onClick={() => setCriticalModalOpen(true)}
                        className="h-7 px-3 rounded-full bg-red-600 text-[9px] font-black uppercase tracking-widest text-white hover:bg-red-700 transition-colors shadow-lg shadow-red-200">
                        Ver todo
                      </button>
                    </header>
                    <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
                      {criticalAlerts.length === 0 ? (
                        <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-red-100 bg-white px-4 text-center">
                          <p className="text-[10px] font-bold text-red-200 uppercase tracking-widest">Sin alertas pendientes</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {criticalAlerts.slice(0, 3).map((it) => (
                            <div key={it.key}
                              className="group flex items-center h-[4.25rem] gap-3 rounded-xl border border-red-100 bg-white p-3 transition-all hover:border-red-300 hover:shadow-md">
                              <div className="h-2 w-2 shrink-0 rounded-full bg-red-600 animate-pulse" />
                              <div className="min-w-0 flex-1 flex flex-col justify-center">
                                <div className="flex items-center gap-1.5 mb-0.5">
                                  <span className="truncate max-w-[100px] text-[8px] font-black uppercase tracking-wider text-red-600">{it.courseName}</span>
                                  <span className="text-[8px] font-bold text-red-300 uppercase">Vencida</span>
                                </div>
                                <div className="truncate text-sm font-black text-zinc-900 leading-tight">{it.title}</div>
                              </div>
                              {it.url && (
                                <a href={it.url} target="_blank" rel="noreferrer"
                                  className="shrink-0 h-7 w-7 flex items-center justify-center rounded-full bg-zinc-950 text-white active:scale-90 transition-transform">
                                  <span className="text-[10px]">!</span>
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              )}

              {/* ── Sesiones de Estudio ── */}
              {wid === "sesiones" && (
                <section className="relative h-full overflow-hidden rounded-3xl border border-blue-100 bg-gradient-to-br from-blue-50/50 to-indigo-50/30 transition-colors duration-300">
                  <div className="absolute right-0 top-0 h-32 w-32 translate-x-10 translate-y-[-10px] rounded-full bg-blue-200/20 blur-2xl" />
                  <div className="relative flex h-full flex-col p-5">
                    <header className="flex items-center justify-between mb-4">
                      <div className="min-w-0">
                        <h3 className="text-sm font-black uppercase tracking-widest text-blue-400">Planificación</h3>
                        <p className="text-xl font-black tracking-tight text-blue-900">Sesiones</p>
                        <p className="mt-0.5 text-[10px] font-bold text-blue-600/70 uppercase tracking-wide">
                          Solo hoy · rojo pendiente · verde hecha
                        </p>
                      </div>
                      <button type="button" onClick={() => setStudyModalOpen(true)}
                        className="rounded-2xl bg-blue-600/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-blue-700 hover:bg-blue-600/20 transition-colors">
                        Ver plan
                      </button>
                    </header>
                    <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
                      {todayPlanningSessions.length === 0 ? (
                        <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-blue-200 bg-white/40 px-4 text-center">
                          <p className="text-[10px] font-bold text-blue-300 uppercase tracking-widest">Sin sesiones hoy</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 gap-2">
                          {todayPlanningSessions.map((s) => (
                            <div
                              key={s.arenaKey}
                              className="group flex items-center min-h-[4.25rem] gap-2.5 rounded-xl border border-white bg-white/80 p-3 shadow-sm transition-all hover:shadow-md hover:translate-y-[-1px]"
                            >
                              <span
                                className={`h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white ${
                                  s.completed ? "bg-emerald-500" : "bg-red-500"
                                }`}
                                title={s.completed ? "Completada en Study Arena" : "Pendiente"}
                                aria-hidden
                              />
                              <div className="flex flex-col items-center justify-center h-10 w-10 shrink-0 rounded-lg"
                                style={{ backgroundColor: `color-mix(in srgb, ${s.sessionTextColor} 12%, white)`, color: s.sessionTextColor }}>
                                <span className="text-[10px] font-black uppercase leading-none">{s.date.split("-")[2]}</span>
                                <span className="text-[7px] font-bold uppercase opacity-70 leading-none">{s.date.split("-")[1]}</span>
                              </div>
                              <div className="min-w-0 flex-1 flex flex-col justify-center">
                                <div className="flex items-center gap-1.5 mb-0.5">
                                  <span className="truncate max-w-[70px] text-[7px] font-black uppercase px-1.5 py-0.5 rounded-lg"
                                    style={{ color: s.sessionTextColor, backgroundColor: "color-mix(in srgb, white 20%, transparent)", border: `1px solid ${s.sessionTextColor}` }}>
                                    {s.planTitle}
                                  </span>
                                  <span className="text-[9px] font-black text-blue-900/40">{s.hours}h</span>
                                </div>
                                <div className="truncate text-xs font-black text-blue-950 leading-tight">
                                  {s.sessionTitle?.trim() ? s.sessionTitle : "Estudio"}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              )}

              {/* ── Enfoque del Día ── */}
              {wid === "enfoque" && (
                <WidgetShell title="Enfoque del Día" subtitle="Siguiente bloque">
                  <div className="space-y-2.5">
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-2.5">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-[var(--ink-faint)]">{MOCK.enfoqueDia.block}</div>
                      <div className="mt-0.5 text-xs font-bold leading-tight">{MOCK.enfoqueDia.sessionTitle}</div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <Pill><span className="text-[9px]">En {MOCK.enfoqueDia.startInMin} min</span></Pill>
                        <span className="text-[9px] font-bold text-[var(--ink-faint)]">Mock</span>
                      </div>
                    </div>
                    <div className="rounded-xl border border-black/5 bg-white/50 p-2.5">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-[var(--ink-faint)]">Focus</div>
                      <p className="mt-1 text-xs font-bold leading-tight">{MOCK.enfoqueDia.focusPrompt}</p>
                    </div>
                    <button type="button" disabled
                      className="w-full min-h-[44px] rounded-xl bg-[var(--ink)] px-4 py-2 text-xs font-extrabold text-white opacity-70">
                      Empezar (mock)
                    </button>
                  </div>
                </WidgetShell>
              )}

              {/* ── Exámenes y Fechas ── */}
              {wid === "examenes" && (
                <WidgetShell title="Exámenes y Fechas" subtitle="Próximas 2 fechas">
                  {nextExams.length === 0 ? (
                    <div className="flex h-16 items-center justify-center rounded-xl border border-dashed border-[var(--border)] text-xs text-[var(--ink-muted)]">
                      Sin próximos exámenes o fechas
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {nextExams.map((exam) => {
                        const days = daysUntilLocalDate(exam.date);
                        const progress = Math.max(5, Math.min(100, Math.round((1 - Math.max(0, days) / 30) * 100)));
                        const cs = getGoogleEventColorStyle(exam.calendarColorId);
                        return (
                          <div key={exam.id} className="space-y-1.5">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[11px] font-black text-[var(--ink)]">{exam.title}</div>
                                <div className="text-[9px] font-bold text-[var(--ink-muted)]">
                                  {exam.date}{exam.time ? ` · ${exam.time}` : ""}
                                </div>
                              </div>
                              <div className="shrink-0 rounded-lg px-2 py-0.5 text-[9px] font-black"
                                style={{ backgroundColor: cs.bg, color: cs.text, borderLeft: `3px solid ${cs.borderLeft}` }}>
                                {days === 0 ? "Hoy" : `${days}d`}
                              </div>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/5">
                              <div className="h-full rounded-full transition-all duration-500"
                                style={{ width: `${progress}%`, backgroundColor: cs.borderLeft }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </WidgetShell>
              )}

              {/* ── Adherencia (tareas reales) ── */}
              {wid === "adherencia" && (
                <WidgetShell title="Adherencia" subtitle="% completadas · rojo → verde">
                  <div className="flex flex-col gap-4">
                    <ProgressRing
                      valuePct={
                        taskAdherence.today.empty
                          ? 0
                          : taskAdherence.today.pct
                      }
                      label="Hoy (diarias)"
                      detail={
                        taskAdherence.today.empty
                          ? "Sin tareas hoy"
                          : `${taskAdherence.today.done}/${taskAdherence.today.total} hechas`
                      }
                      accentColor={rgbForAdherencePct(
                        taskAdherence.today.empty
                          ? 0
                          : taskAdherence.today.pct,
                        taskAdherence.today.empty,
                      )}
                    />
                    <ProgressRing
                      valuePct={
                        taskAdherence.weekDaily.empty
                          ? 0
                          : taskAdherence.weekDaily.pct
                      }
                      label="Diarias · esta semana"
                      detail={
                        taskAdherence.weekDaily.empty
                          ? "Sin diarias en la semana"
                          : `${taskAdherence.weekDaily.done}/${taskAdherence.weekDaily.total} hechas (lun–dom)`
                      }
                      accentColor={rgbForAdherencePct(
                        taskAdherence.weekDaily.empty
                          ? 0
                          : taskAdherence.weekDaily.pct,
                        taskAdherence.weekDaily.empty,
                      )}
                    />
                    <ProgressRing
                      valuePct={
                        taskAdherence.weekScope.empty
                          ? 0
                          : taskAdherence.weekScope.pct
                      }
                      label="Lista semanal"
                      detail={
                        taskAdherence.weekScope.empty
                          ? "Sin tareas semanales"
                          : `${taskAdherence.weekScope.done}/${taskAdherence.weekScope.total} hechas`
                      }
                      accentColor={rgbForAdherencePct(
                        taskAdherence.weekScope.empty
                          ? 0
                          : taskAdherence.weekScope.pct,
                        taskAdherence.weekScope.empty,
                      )}
                    />
                    <p className="text-[10px] font-semibold leading-snug text-[var(--ink-muted)]">
                      {taskAdherenceHint}
                    </p>
                  </div>
                </WidgetShell>
              )}

              {/* ── Hábitos (doble ring) ── */}
              {wid === "habits" && (
                <WidgetShell
                  title="Hábitos"
                  subtitle="Hoy vs histórico"
                >
                  <DualProgressRing
                    innerPct={habitRates.today.empty ? 0 : habitRates.today.pct}
                    outerPct={habitRates.overall.empty ? 0 : habitRates.overall.pct}
                    innerLabel={
                      habitRates.today.empty
                        ? "Sin hábitos hoy"
                        : `Hoy ${habitRates.today.done}/${habitRates.today.total}`
                    }
                    outerLabel={
                      habitRates.overall.empty
                        ? "Sin historial"
                        : `Total ${habitRates.overall.done}/${habitRates.overall.total}`
                    }
                  />
                  <p className="mt-3 text-[10px] font-semibold leading-snug text-[var(--ink-muted)]">
                    Anillo interior: hábitos programados hoy. Anillo exterior: histórico (incluye hábitos archivados).
                  </p>
                </WidgetShell>
              )}

              {/* ── Carga Semanal ── */}
              {wid === "carga" && (
                <WidgetShell title="Carga Semanal" subtitle="Sesiones · exámenes · entregas BB">
                  <HeatmapWeek values={weeklyLoad} breakdowns={weeklyLoadBreakdown} />
                </WidgetShell>
              )}

              {/* ── StudyTrend ── */}
              {wid === "studytrend" && (
                <WidgetShell title="StudyTrend" subtitle="Sesiones de estudio · ±6 días">
                  <StudyTrendChart data={studyTrendData} />
                </WidgetShell>
              )}

              {/* ── Esfuerzo por Asignatura ── */}
              {wid === "esfuerzo" && (
                <WidgetShell title="Esfuerzo por Asignatura" subtitle="Distribución horaria">
                  {effortByObjective.items.length === 0 ? (
                    <div className="text-xs text-[var(--ink-muted)] py-4 text-center border border-dashed rounded-xl">
                      Sin datos de plan.
                    </div>
                  ) : (
                    <div className="flex flex-col gap-4">
                      <div className="flex justify-center scale-90 sm:scale-100">
                        <Doughnut segments={effortByObjective.segments} centerLabel="Mix" />
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {effortByObjective.items.slice(0, 4).map((it) => (
                          <div key={it.label}
                            className="flex items-center justify-between gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1.5">
                            <span className="flex items-center gap-1 text-[9px] font-bold text-[var(--ink-muted)] truncate">
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: it.color }} />
                              <span className="truncate">{it.label}</span>
                            </span>
                            <span className="font-mono-cli text-[9px] font-bold shrink-0">{Math.round(it.pct)}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </WidgetShell>
              )}

              {/* ── Burnout / Fatiga ── */}
              {wid === "burnout" && (
                <WidgetShell title="Burnout / Fatiga" subtitle="Señales tempranas">
                  <BurnoutGauge valuePct={MOCK.burnout.valuePct} />
                </WidgetShell>
              )}

              {/* ── Racha ── */}
              {wid === "racha" && (
                <WidgetShell title="Racha (Streaks)" subtitle="Gamificación" tone="accent">
                  <div className="flex items-center gap-3">
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-2.5 shrink-0 text-center">
                      <div className="text-[9px] font-bold text-[var(--ink-muted)] uppercase tracking-tight">Racha</div>
                      <div className="text-2xl font-extrabold">{MOCK.streaks.days}</div>
                      <div className="text-[8px] font-bold text-[var(--ink-faint)]">Récord: {MOCK.streaks.bestDays}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-bold leading-tight">{MOCK.streaks.message}</p>
                      <button type="button" disabled
                        className="mt-2 w-full min-h-[36px] rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1 text-[10px] font-bold opacity-70">
                        Objetivo hoy (mock)
                      </button>
                    </div>
                  </div>
                </WidgetShell>
              )}

              {/* ── Foco vs Distracciones ── */}
              {wid === "foco" && (
                <WidgetShell title="Foco vs. Distracciones" subtitle="Ratio actual (mock)">
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold">
                          Estudio: {MOCK.distractionsRatio.studyPct}% · Dist: {MOCK.distractionsRatio.distractPct}%
                        </div>
                      </div>
                      <Pill tone="green"><span className="text-[9px]">Enfocado</span></Pill>
                    </div>
                    <div className="h-3 w-full overflow-hidden rounded-full bg-black/5 ring-1 ring-black/5">
                      <div className="flex h-full">
                        <div className="bg-[var(--ink)]" style={{ width: `${MOCK.distractionsRatio.studyPct}%` }} />
                        <div className="bg-amber-400/80" style={{ width: `${MOCK.distractionsRatio.distractPct}%` }} />
                      </div>
                    </div>
                    <p className="text-[10px] font-bold text-[var(--ink-muted)] leading-tight">
                      Tip: ventana de 15 min si te cuesta empezar.
                    </p>
                  </div>
                </WidgetShell>
              )}
          </div>
        ))}
      </GridLayout>

      <UpcomingDeliveriesModal
        open={upcomingModalOpen}
        onClose={() => setUpcomingModalOpen(false)}
        items={upcomingDeliveries}
        title="Próximas entregas"
        subtitle="Solo no entregadas · semestre actual · ordenadas según prioridad."
      />
      <UpcomingDeliveriesModal
        open={criticalModalOpen}
        onClose={() => setCriticalModalOpen(false)}
        items={criticalAlerts}
        title="Cosas no entregadas · Alertas Críticas"
        subtitle="Primero vencidas (due pasada), después sin due con creación más reciente."
      />
      <StudySessionsModal
        open={studyModalOpen}
        onClose={() => setStudyModalOpen(false)}
        items={upcomingStudySessions}
      />
    </div>
  );
}

