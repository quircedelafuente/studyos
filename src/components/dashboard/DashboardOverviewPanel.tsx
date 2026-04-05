"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  DEADLINES_CHANGED_EVENT,
  DEADLINES_STORAGE_KEY,
  loadImportantDeadlines,
} from "@/lib/deadlines-storage";

// ── Types & Constants ───────────────────────────────────────────────────────

type WidgetId =
  | "entregas"
  | "prioridad"
  | "sesiones"
  | "enfoque"
  | "examenes"
  | "adherencia"
  | "carga"
  | "studytrend"
  | "esfuerzo"
  | "burnout"
  | "racha"
  | "foco";

type WidgetSize = "half" | "square" | "wide";

type WidgetConfig = {
  id: WidgetId;
  size: WidgetSize;
};

const DEFAULT_WIDGET_ORDER: WidgetId[] = [
  "entregas",
  "prioridad",
  "sesiones",
  "enfoque",
  "examenes",
  "adherencia",
  "carga",
  "studytrend",
  "esfuerzo",
  "burnout",
  "racha",
  "foco",
];

const DESKTOP_CONFIG_KEY = "iestudio-dashboard-widget-config-desktop-v3";
const MOBILE_ORDER_KEY = "iestudio-dashboard-widget-order-mobile-v3";

// ── Components ──────────────────────────────────────────────────────────────

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

  const accentRing =
    tone === "danger"
      ? "shadow-[0_0_0_4px_rgba(239,68,68,0.08)]"
      : tone === "warning"
        ? "shadow-[0_0_0_4px_rgba(245,158,11,0.08)]"
        : "shadow-[0_0_0_4px_rgba(0,0,0,0.03)]";

  return (
    <section
      className={`relative h-full w-full overflow-hidden rounded-2xl border ${toneStyles} ${accentRing} transition-all duration-200 active:scale-[0.98] sm:active:scale-100`}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(0,0,0,0.05),transparent_45%)]" />
      <div className="relative p-3 sm:p-4 h-full flex flex-col">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-xs sm:text-sm font-bold sm:font-semibold tracking-tight">{title}</h3>
            {subtitle ? <p className="mt-0.5 line-clamp-1 text-[10px] sm:text-xs text-[var(--ink-muted)] leading-tight">{subtitle}</p> : null}
          </div>
          {right ? <div className="shrink-0">{right}</div> : null}
        </div>
        <div className="mt-3 flex-1 min-h-0">{children}</div>
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

function ProgressRing({ valuePct, label }: { valuePct: number; label: string }) {
  const r = 22;
  const cx = 28;
  const cy = 28;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, valuePct));
  const dash = (pct / 100) * c;
  const rest = c - dash;

  return (
    <div className="flex items-center gap-3">
      <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden>
        <circle cx={cx} cy={cy} r={r} stroke="rgba(0,0,0,0.08)" strokeWidth="7" fill="none" />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          stroke="currentColor"
          strokeWidth="7"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${rest}`}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      </svg>
      <div className="min-w-0">
        <div className="text-lg font-extrabold leading-tight">{Math.round(pct)}%</div>
        <div className="text-xs text-[var(--ink-muted)]">{label}</div>
      </div>
    </div>
  );
}

function HeatmapWeek({
  values,
  breakdowns,
}: {
  values: readonly number[];
  breakdowns?: readonly string[];
}) {
  const levels = useMemo(() => values.slice(0, 7).map((v) => Math.max(0, Math.min(4, Math.floor((v / 100) * 5)))), [values]);
  const today = new Date();
  const todayDow = today.getDay();
  const todayIdx = todayDow === 0 ? 6 : todayDow - 1;
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
      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {levels.map((lvl, i) => {
          const isToday = i === todayIdx;
          const tooltip = breakdowns?.[i]
            ? `${breakdowns[i]} (${values[i] ?? 0}/100)`
            : `Carga ${values[i] ?? 0}/100`;
          return (
            <div key={i} className="flex flex-col items-center gap-1">
              <div className={`text-[10px] font-bold ${isToday ? "text-[var(--ink)]" : "text-[var(--ink-faint)]"}`}>
                {dayLabels[i]}
              </div>
              <div
                className={`h-8 w-8 sm:h-10 sm:w-10 rounded-lg sm:rounded-xl border ${colorFor(lvl)} flex items-center justify-center font-extrabold text-[10px] sm:text-[11px] relative ${isToday ? "ring-2 ring-offset-1 ring-[var(--ink)]/40" : ""}`}
                title={tooltip}
              >
                {values[i] === 0 ? <span className="text-[10px] opacity-40">—</span> : Math.round(values[i] ?? 0)}
                {isToday && <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-[var(--ink)]" />}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-1.5 text-[10px] sm:text-xs text-[var(--ink-muted)]">
        <Pill tone="green">Ligero</Pill>
        <Pill tone="amber">Medio</Pill>
        <Pill tone="red">Pesado</Pill>
      </div>
    </div>
  );
}

function LineChart({ points, labels }: { points: readonly number[]; labels: readonly string[] }) {
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
      <svg className="w-full" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Gráfico del Reloj Biológico">
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
          <text key={lab} x={toX(i)} y={h - 4} textAnchor="middle" fontSize="11" fill="rgba(0,0,0,0.45)">
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
    <div className="relative mx-auto h-32 w-32 sm:h-40 sm:w-40">
      <div className="absolute inset-0 rounded-full border border-[var(--border)]" style={{ background: `conic-gradient(${conic})` }} />
      <div className="absolute left-1/2 top-1/2 h-20 w-24 sm:h-24 sm:w-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center text-center">
        <div>
          <div className="text-xs sm:text-sm font-extrabold">{centerLabel}</div>
          <div className="text-[9px] sm:text-[10px] text-[var(--ink-muted)]">esfuerzo</div>
        </div>
      </div>
    </div>
  );
}

function BurnoutGauge({ valuePct }: { valuePct: number }) {
  const size = 160;
  const stroke = 12;
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

  const tone = v < 35 ? "text-emerald-700" : v < 65 ? "text-amber-700" : "text-red-800";

  return (
    <div className="flex items-center justify-between gap-2 sm:gap-4 h-full pb-4">
      <div className="relative shrink-0">
        <svg width={size} height={size / 1.5} viewBox={`0 0 ${size} ${size / 1.5}`} aria-label="Índice de Fatiga">
          <path
            d={`M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(
              2,
            )} 0 0 1 ${polar(end).x.toFixed(2)} ${polar(end).y.toFixed(2)}`}
            stroke="rgba(0,0,0,0.10)"
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
          />
          <path d={valuePath} stroke="currentColor" strokeWidth={stroke} fill="none" strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center pt-4 pointer-events-none">
          <div className="text-center">
            <div className={`text-xl sm:text-2xl font-extrabold ${tone}`}>{Math.round(v)}</div>
            <div className="text-[9px] sm:text-[10px] text-[var(--ink-muted)]">fatiga</div>
          </div>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold leading-tight">
          {v < 35 ? "Carga sostenible." : v < 65 ? "Ojo: podrías saturarte." : "Considera descanso."}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Pill tone={v < 35 ? "green" : v < 65 ? "amber" : "red"}>
            {v < 35 ? "OK" : v < 65 ? "Riesgo medio" : "Riesgo alto"}
          </Pill>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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
  return d.toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
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
  const cls = light === "red" ? "bg-red-500" : "bg-amber-400";
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${cls} ring-1 ring-black/10`} aria-hidden />;
}

// ── Modals ──────────────────────────────────────────────────────────────────

function UpcomingDeliveriesModal({
  open,
  onClose,
  items,
  title = "Próximas entregas",
  subtitle = "Solo no entregadas · semestre actual.",
}: {
  open: boolean;
  onClose: () => void;
  items: UpcomingDelivery[];
  title?: string;
  subtitle?: string;
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
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
            <h2 className="truncate text-sm sm:text-base font-extrabold">{title}</h2>
            <p className="mt-0.5 text-[10px] sm:text-xs text-[var(--ink-muted)] line-clamp-1">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1.5 text-[10px] sm:text-xs font-bold text-[var(--ink)]">
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
                  <li key={it.key} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5 sm:p-3">
                    <div className="flex items-start gap-3">
                      <SubmissionPip light={it.light} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                          <span className="rounded-full bg-[var(--surface-muted)] px-1.5 py-0.5 text-[9px] sm:text-[11px] font-bold text-[var(--ink-muted)]">{it.courseName}</span>
                          {it.dueIso ? (
                            <>
                              <Pill tone={rel?.tone === "red" ? "red" : rel?.tone === "amber" ? "amber" : "default"}>
                                <span className="text-[9px] sm:text-[11px]">{rel?.label ?? "—"}</span>
                              </Pill>
                              <span className="text-[9px] sm:text-[11px] text-[var(--ink-faint)]">{formatDue(it.dueIso)}</span>
                            </>
                          ) : (
                            <Pill tone="default"><span className="text-[9px] sm:text-[11px]">Sin fecha</span></Pill>
                          )}
                        </div>
                        <div className="mt-1 truncate text-xs sm:text-sm font-extrabold">{it.title}</div>
                      </div>
                      {it.url && (
                        <a href={it.url} target="_blank" rel="noreferrer"
                          className="shrink-0 flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1 text-[10px] sm:text-xs font-bold text-[var(--ink)] min-h-[36px]">
                          Abrir
                        </a>
                      )}
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

function StudySessionsModal({ open, onClose, items }: { open: boolean; onClose: () => void; items: any[] }) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
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
            <p className="mt-0.5 text-[10px] sm:text-xs text-[var(--ink-muted)] line-clamp-1">Extraídas de planes.</p>
          </div>
          <button type="button" onClick={onClose}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1.5 text-[10px] sm:text-xs font-bold text-[var(--ink)]">
            Cerrar
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
          {items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-8 text-center text-xs sm:text-sm text-[var(--ink-muted)]">Sin sesiones.</div>
          ) : (
            <ul className="space-y-2">
              {items.map((s) => (
                <li key={s.key} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5 sm:p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                        <span className="rounded-full border px-1.5 py-0.5 text-[9px] sm:text-[11px] font-bold"
                          style={{ color: s.sessionTextColor, borderColor: s.sessionTextColor, backgroundColor: "color-mix(in srgb, white 84%, transparent)" }}>
                          {s.planTitle}
                        </span>
                        <Pill><span className="text-[9px] sm:text-[11px]">{s.date}</span></Pill>
                        <span className="text-[9px] sm:text-[11px] text-[var(--ink-faint)] font-bold">{Math.round(s.hours * 10) / 10}h</span>
                      </div>
                      <div className="mt-1 truncate text-xs sm:text-sm font-extrabold text-[var(--ink)]">{s.sessionTitle || "Estudio"}</div>
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

// ── Main Dashboard Component ────────────────────────────────────────────────

const MOCK = {
  acciones: [
    { label: "Historia: entrega de resumen final", urg: true, imp: true, estimateMin: 35, tag: "Alta" },
    { label: "Programación: mini-proyecto", urg: true, imp: true, estimateMin: 50, tag: "Directo" },
    { label: "Física: práctica cinemática", urg: true, imp: false, estimateMin: 25, tag: "Rápido" },
    { label: "Literatura: plantilla ensayo", urg: false, imp: true, estimateMin: 40, tag: "Clave" },
  ],
  enfoqueDia: {
    sessionTitle: "Álgebra (repaso profundo)",
    block: "Siguiente sesión",
    startInMin: 12,
    focusPrompt: "Completa 10 ejercicios tipo examen.",
  },
  adherencia: { valuePct: 85, suggestion: "Tu plan funciona. Sigue así." },
  bio: { points: [35, 42, 55, 70, 63, 58, 40, 30], labels: ["8", "10", "12", "14", "16", "18", "20", "22"] },
  burnout: { valuePct: 62 },
  streaks: { days: 6, bestDays: 12, message: "Mantén la inercia hoy." },
  distractionsRatio: { studyPct: 72, distractPct: 28 },
} as const;

function getCurrentWeekDates(): string[] {
  const today = new Date();
  const dow = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return formatLocalYmd(d);
  });
}

function StudyTrendChart({ data }: { data: any[] }) {
  const W = 340; const H = 110; const PX = 8; const PY = 10;
  const LABEL_H = 14; const CHART_H = H - PY * 2 - LABEL_H;
  const N = data.length; const maxH = Math.max(0.5, ...data.map((d) => d.hours));
  const toX = (i: number) => PX + ((W - PX * 2) * i) / Math.max(1, N - 1);
  const toY = (v: number) => PY + CHART_H - (CHART_H * v) / maxH;
  const pts = data.map((d, i) => ({ ...d, x: toX(i), y: toY(d.hours) }));
  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const base = (PY + CHART_H).toFixed(1);
  const areaPath = N > 1 ? `${linePath} L ${pts[N - 1]!.x.toFixed(1)} ${base} L ${pts[0]!.x.toFixed(1)} ${base} Z` : "";
  const todayIdx = data.findIndex((d) => d.isToday);
  return (
    <div className="w-full">
      <svg className="w-full" viewBox={`0 0 ${W} ${H}`} role="img">
        <defs>
          <linearGradient id="stArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="rgba(99,102,241,0.18)" /><stop offset="100%" stopColor="rgba(99,102,241,0)" /></linearGradient>
        </defs>
        {areaPath && <path d={areaPath} fill="url(#stArea)" />}
        <path d={linePath} fill="none" stroke="rgb(99,102,241)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((p, i) => (p.hours > 0 || p.isToday) && <circle key={i} cx={p.x} cy={p.y} r={p.isToday ? 4 : 2.5} fill={p.isToday ? "rgb(99,102,241)" : "white"} stroke="rgb(99,102,241)" strokeWidth={p.isToday ? 2 : 1.5} />)}
      </svg>
    </div>
  );
}

// ── State for layout ────────────────────────────────────────────────────────

const DESKTOP_CONFIG_KEY_V3 = "iestudio-dashboard-widget-config-v3";
const MOBILE_ORDER_KEY_V3 = "iestudio-dashboard-widget-order-mobile-v3";

function loadDesktopConfig(): WidgetConfig[] {
  if (typeof window === "undefined") return DEFAULT_WIDGET_ORDER.map(id => ({ id, size: "square" }));
  try {
    const raw = localStorage.getItem(DESKTOP_CONFIG_KEY_V3);
    if (raw) return JSON.parse(raw);
  } catch {}
  return DEFAULT_WIDGET_ORDER.map(id => ({ id, size: "square" }));
}

function loadMobileOrder(): WidgetId[] {
  if (typeof window === "undefined") return [...DEFAULT_WIDGET_ORDER];
  try {
    const raw = localStorage.getItem(MOBILE_ORDER_KEY_V3);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [...DEFAULT_WIDGET_ORDER];
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

  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [desktopConfigs, setDesktopConfigs] = useState<WidgetConfig[]>([]);
  const [mobileOrder, setMobileOrder] = useState<WidgetId[]>([]);
  const [editMode, setEditMode] = useState(false);

  useEffect(() => {
    setDesktopConfigs(loadDesktopConfig());
    setMobileOrder(loadMobileOrder());
    const mql = window.matchMedia("(max-width: 639px)");
    setIsMobileLayout(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobileLayout(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const saveDesktop = (c: WidgetConfig[]) => { setDesktopConfigs(c); localStorage.setItem(DESKTOP_CONFIG_KEY_V3, JSON.stringify(c)); };
  const saveMobile = (o: WidgetId[]) => { setMobileOrder(o); localStorage.setItem(MOBILE_ORDER_KEY_V3, JSON.stringify(o)); };

  const reorder = (srcId: WidgetId, targetId: WidgetId) => {
    if (isMobileLayout) {
      const o = [...mobileOrder];
      const fi = o.indexOf(srcId); const ti = o.indexOf(targetId);
      o.splice(fi, 1); o.splice(ti, 0, srcId); saveMobile(o);
    } else {
      const o = [...desktopConfigs];
      const fi = o.findIndex(x => x.id === srcId); const ti = o.findIndex(x => x.id === targetId);
      const [moved] = o.splice(fi, 1); if (moved) o.splice(ti, 0, moved); saveDesktop(o);
    }
  };

  const setSize = (id: WidgetId, size: WidgetSize) => {
    saveDesktop(desktopConfigs.map(c => c.id === id ? { ...c, size } : c));
  };

  const [dragOverId, setDragOverId] = useState<WidgetId | null>(null);
  const dragSrcRef = useRef<WidgetId | null>(null);

  // ── Data Hooks ────────────────────────────────────────────────────────────

  useEffect(() => {
    const bump = () => setBbRevision(n => n + 1);
    window.addEventListener(BB_GRADEBOOK_STORAGE_CHANGED, bump);
    return () => window.removeEventListener(BB_GRADEBOOK_STORAGE_CHANGED, bump);
  }, []);

  const upcomingDeliveries = useMemo(() => {
    if (typeof window === "undefined") return [];
    const snap = readBbDisplayedCoursesSnapshot();
    if (!snap.hasConfig) return [];
    const now = Date.now();
    const courses = filterCoursesByMode(snap.curatedCourses, "__auto__");
    const out: UpcomingDelivery[] = [];
    for (const c of courses) {
      const cols = loadBbGradebook(c.learnCourseId)?.columns ?? [];
      for (const col of cols) {
        const light = getSubmissionLight(col.submissionReason, col.submissionSubmitted);
        if (light !== "red" && light !== "yellow") continue;
        const due = col.grading?.due;
        if (due && dueTs(due)! >= now) {
          out.push({ key: `${c.learnCourseId}-${col.id}`, courseName: c.name, title: col.displayName || col.name || "Entrega", dueIso: due, contentId: String(col.contentId), creationMs: null, light, url: resolveGradebookColumnUltraUrl(c.learnCourseId, col, {}) });
        }
      }
    }
    return out.sort((a, b) => (dueTs(a.dueIso!) || 0) - (dueTs(b.dueIso!) || 0));
  }, [bbRevision]);

  const criticalAlerts = useMemo(() => {
    if (typeof window === "undefined") return [];
    const snap = readBbDisplayedCoursesSnapshot();
    if (!snap.hasConfig) return [];
    const now = Date.now();
    const out: UpcomingDelivery[] = [];
    for (const c of filterCoursesByMode(snap.curatedCourses, "__auto__")) {
      const cols = loadBbGradebook(c.learnCourseId)?.columns ?? [];
      for (const col of cols) {
        const due = col.grading?.due;
        if (due && dueTs(due)! < now) {
          const light = getSubmissionLight(col.submissionReason, col.submissionSubmitted);
          if (light === "red" || light === "yellow") {
            out.push({ key: `crit-${col.id}`, courseName: c.name, title: col.displayName || col.name || "Vencida", dueIso: due, contentId: null, creationMs: null, light, url: resolveGradebookColumnUltraUrl(c.learnCourseId, col, {}) });
          }
        }
      }
    }
    return out.sort((a, b) => (dueTs(b.dueIso!) || 0) - (dueTs(a.dueIso!) || 0));
  }, [bbRevision]);

  const upcomingStudySessions = useMemo(() => {
    if (typeof window === "undefined") return [];
    const today = formatLocalYmd(new Date());
    const plans = loadStudyPlans();
    const out = [];
    for (const p of plans) {
      for (const d of p.aiSchedule?.days || []) {
        if (d.date >= today) out.push({ key: `${p.id}-${d.date}`, planTitle: p.title, date: d.date, hours: d.studyHours, sessionTitle: d.sessionTitle, sessionTextColor: "#3b82f6" });
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }, [studyPlansRevision]);

  const top3Deliveries = useMemo(() => upcomingDeliveries.slice(0, 3), [upcomingDeliveries]);
  const top3Critical = useMemo(() => criticalAlerts.slice(0, 3), [criticalAlerts]);
  const top3Sessions = useMemo(() => upcomingStudySessions.slice(0, 3), [upcomingStudySessions]);

  const weeklyLoad = useMemo(() => Array(7).fill(40), []);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 py-3 sm:gap-4 sm:px-6 sm:py-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">Panel de Control</h1>
          <p className="text-[11px] sm:text-sm text-[var(--ink-muted)]">Organiza tu dashboard arrastrando y redimensionando.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setEditMode(!editMode)}
            className={`rounded-full border px-4 py-1.5 text-xs font-bold transition-all shadow-sm ${editMode ? "border-indigo-500 bg-indigo-600 text-white" : "border-[var(--border)] bg-white text-[var(--ink)] hover:bg-zinc-50"}`}>
            {editMode ? "✓ Guardar Cambios" : "⚙ Personalizar"}
          </button>
        </div>
      </header>

      <div className={`grid min-h-0 gap-3 sm:gap-4 ${isMobileLayout ? "grid-cols-1" : "grid-cols-12"}`}>
        {(isMobileLayout ? mobileOrder.map(id => ({ id, size: "square" as const })) : desktopConfigs).map((cfg) => {
          const { id, size } = cfg;
          const colSpan = isMobileLayout ? "col-span-1" : size === "wide" ? "lg:col-span-8" : "lg:col-span-4";
          const rowHeight = isMobileLayout ? "h-[20rem]" : size === "half" ? "h-[10rem]" : "h-[20rem]";
          const isDragging = dragSrcRef.current === id;
          const isOver = dragOverId === id;

          return (
            <div key={id} data-wid={id}
              className={`relative group transition-all duration-300 ${colSpan} ${rowHeight} ${editMode ? "cursor-move" : ""} ${isOver ? "ring-4 ring-indigo-500/30 rounded-3xl" : ""} ${isDragging ? "opacity-40 scale-95" : ""}`}
              draggable={editMode}
              onDragStart={(e) => { dragSrcRef.current = id; e.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(e) => { e.preventDefault(); if (dragSrcRef.current !== id) setDragOverId(id); }}
              onDragEnd={() => { dragSrcRef.current = null; setDragOverId(null); }}
              onDrop={(e) => { e.preventDefault(); const src = dragSrcRef.current; if (src && src !== id) reorder(src, id); }}
            >
              {editMode && !isMobileLayout && (
                <div className="absolute top-2 left-2 z-30 flex items-center gap-1 bg-white/95 backdrop-blur-sm p-1 rounded-xl shadow-xl border border-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => setSize(id, "half")} className={`px-2 py-1 text-[9px] font-black rounded-lg ${size === "half" ? "bg-indigo-600 text-white" : "hover:bg-zinc-100"}`}>1/2 H</button>
                  <button onClick={() => setSize(id, "square")} className={`px-2 py-1 text-[9px] font-black rounded-lg ${size === "square" ? "bg-indigo-600 text-white" : "hover:bg-zinc-100"}`}>1x1</button>
                  <button onClick={() => setSize(id, "wide")} className={`px-2 py-1 text-[9px] font-black rounded-lg ${size === "wide" ? "bg-indigo-600 text-white" : "hover:bg-zinc-100"}`}>Wide</button>
                </div>
              )}

              {id === "entregas" && (
                <WidgetShell title="Próximas Entregas" subtitle="Top 3 pendientes"
                  right={<button onClick={() => setUpcomingModalOpen(true)} className="h-7 w-7 rounded-full bg-zinc-900 text-white text-lg font-black shadow-lg">+</button>}>
                  <ul className="space-y-2 relative">
                    {top3Deliveries.map(it => (
                      <li key={it.key} className={`flex items-center h-[4.25rem] gap-3 rounded-xl border border-zinc-100 bg-white/60 px-3 shadow-sm ${size === "half" ? "h-14" : "h-[4.25rem]"}`}>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[8px] font-black uppercase text-zinc-400">{it.courseName}</p>
                          <p className="truncate text-xs font-black text-zinc-900">{it.title}</p>
                        </div>
                        {it.url && <a href={it.url} target="_blank" className="shrink-0 h-6 w-6 flex items-center justify-center rounded-lg bg-zinc-100 font-bold text-[10px]">↗</a>}
                      </li>
                    ))}
                  </ul>
                </WidgetShell>
              )}

              {id === "prioridad" && (
                <section className={`relative h-full w-full overflow-hidden rounded-2xl border-2 border-red-500/20 bg-[#fffafa] shadow-xl p-4 sm:p-5 flex flex-col`}>
                  <header className="flex items-center justify-between mb-2">
                    <h3 className="text-[10px] font-black uppercase text-red-600">Prioridad</h3>
                    <button onClick={() => setCriticalModalOpen(true)} className="h-6 px-3 rounded-full bg-red-600 text-[8px] font-black text-white">Ver todo</button>
                  </header>
                  <div className="space-y-2 flex-1 min-h-0 overflow-hidden">
                    {top3Critical.map(it => (
                      <div key={it.key} className={`flex items-center gap-3 rounded-xl border border-red-100 bg-white p-3 h-[4.25rem] ${size === "half" ? "h-12" : "h-[4.25rem]"}`}>
                        <div className="h-1.5 w-1.5 rounded-full bg-red-600 animate-pulse" />
                        <div className="min-w-0 flex-1"><p className="truncate text-[8px] font-black uppercase text-red-600">{it.courseName}</p><p className="truncate text-xs font-black text-zinc-900">{it.title}</p></div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {id === "sesiones" && (
                <section className="relative h-full w-full overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50/50 to-indigo-50/30 shadow-xl p-4 sm:p-5 flex flex-col">
                  <h3 className="text-[10px] font-black uppercase text-blue-400 mb-2">Sesiones</h3>
                  <div className="space-y-2 flex-1 min-h-0 overflow-hidden">
                    {top3Sessions.map(s => (
                      <div key={s.key} className={`flex items-center gap-3 rounded-xl border border-white bg-white/80 p-3 h-[4.25rem] ${size === "half" ? "h-12" : "h-[4.25rem]"}`}>
                        <div className="h-8 w-8 shrink-0 rounded-lg bg-blue-50 text-blue-600 flex flex-col items-center justify-center font-black text-[9px] leading-none"><span>{s.date.split("-")[2]}</span><span className="text-[7px] opacity-60 uppercase">{s.date.split("-")[1]}</span></div>
                        <div className="min-w-0 flex-1"><p className="truncate text-[8px] font-black uppercase text-blue-400">{s.planTitle}</p><p className="truncate text-xs font-black text-blue-900">{s.sessionTitle || "Estudio"}</p></div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {id === "enfoque" && <WidgetShell title="Enfoque"><div className="space-y-2"><div className="rounded-xl bg-zinc-50 p-3"><p className="text-[10px] font-black uppercase text-zinc-400">Ahora</p><p className="text-sm font-black text-zinc-900">{MOCK.enfoqueDia.sessionTitle}</p></div><p className="text-[11px] font-bold text-zinc-500 italic">"{MOCK.enfoqueDia.focusPrompt}"</p></div></WidgetShell>}
              {id === "carga" && <WidgetShell title="Carga Semanal"><HeatmapWeek values={weeklyLoad} /></WidgetShell>}
              {id === "studytrend" && <WidgetShell title="Estadísticas"><StudyTrendChart data={[]} /></WidgetShell>}
              {id === "burnout" && <WidgetShell title="Fatiga"><BurnoutGauge valuePct={MOCK.burnout.valuePct} /></WidgetShell>}
              {id === "adherencia" && <WidgetShell title="Adherencia"><div className="flex items-center gap-4"><ProgressRing valuePct={MOCK.adherencia.valuePct} label="Plan" /><p className="text-xs font-bold text-zinc-500">{MOCK.adherencia.suggestion}</p></div></WidgetShell>}
              {id === "racha" && <WidgetShell title="Racha"><div className="flex items-center gap-4"><div className="rounded-2xl bg-zinc-900 p-4 text-white text-center"><p className="text-[10px] font-black uppercase opacity-60 tracking-tighter">Días</p><p className="text-3xl font-black">{MOCK.streaks.days}</p></div><p className="text-xs font-black text-zinc-800">{MOCK.streaks.message}</p></div></WidgetShell>}
              {id === "foco" && <WidgetShell title="Enfoque vs Distracciones"><div className="space-y-3"><div className="h-3 w-full overflow-hidden rounded-full bg-zinc-100 flex"><div className="bg-zinc-900 h-full" style={{ width: "72%" }} /><div className="bg-amber-400 h-full" style={{ width: "28%" }} /></div><p className="text-xs font-bold text-zinc-500">72% de enfoque hoy.</p></div></WidgetShell>}
              {id === "esfuerzo" && <WidgetShell title="Distribución"><Doughnut segments={[]} centerLabel="Materia" /></WidgetShell>}
              {id === "examenes" && <WidgetShell title="Próximos"><div className="rounded-xl border-2 border-zinc-100 p-4 text-center"><p className="text-xs font-black text-zinc-400 uppercase">Sin exámenes próximos</p></div></WidgetShell>}
            </div>
          );
        })}
      </div>

      <UpcomingDeliveriesModal open={upcomingModalOpen} onClose={() => setUpcomingModalOpen(false)} items={upcomingDeliveries} />
      <UpcomingDeliveriesModal open={criticalModalOpen} onClose={() => setCriticalModalOpen(false)} items={criticalAlerts} title="Alertas Críticas" />
      <StudySessionsModal open={studyModalOpen} onClose={() => setStudyModalOpen(false)} items={upcomingStudySessions} />
    </div>
  );
}
