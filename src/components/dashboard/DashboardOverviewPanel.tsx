"use client";

import { useEffect, useMemo, useState } from "react";
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
      className={`relative overflow-hidden rounded-2xl border ${toneStyles} ${accentRing} transition-all duration-200 active:scale-[0.98] sm:active:scale-100`}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(0,0,0,0.05),transparent_45%)]" />
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

function HeatmapWeek({ values }: { values: readonly number[] }) {
  // valores 0..100, 7 días. Convertimos a 5 niveles.
  const levels = useMemo(() => values.slice(0, 7).map((v) => Math.max(0, Math.min(4, Math.floor((v / 100) * 5)))), [values]);
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
        {levels.map((lvl, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <div className="text-[10px] font-bold text-[var(--ink-faint)]">{dayLabels[i]}</div>
            <div
              className={`h-10 w-10 rounded-xl border ${colorFor(lvl)} flex items-center justify-center font-extrabold text-[11px]`}
              title={`Carga ${values[i] ?? 0}/100`}
            >
              {Math.round(values[i] ?? 0)}
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 text-xs text-[var(--ink-muted)]">
        <Pill tone="green">Verde: ligero</Pill>
        <Pill tone="amber">Ámbar: medio</Pill>
        <Pill tone="red">Rojo: pesado</Pill>
      </div>
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
  adherencia: { valuePct: 85, suggestion: "Parece que tu plan funciona. Prueba con 1 bloque más corto para afinar." },
  heatmap: { values: [20, 45, 70, 30, 85, 60, 25] },
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

export function DashboardOverviewPanel() {
  const cloudSync = useCloudSyncStatus();
  const [upcomingModalOpen, setUpcomingModalOpen] = useState(false);
  const [criticalModalOpen, setCriticalModalOpen] = useState(false);
  const [studyModalOpen, setStudyModalOpen] = useState(false);
  const [bbRevision, setBbRevision] = useState(0);
  const [contentFetchBusy, setContentFetchBusy] = useState(false);
  const [studyPlansRevision, setStudyPlansRevision] = useState(0);
  const [deadlinesRevision, setDeadlinesRevision] = useState(0);

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

  const topStudy3 = useMemo(
    () => upcomingStudySessions.slice(0, 3),
    [upcomingStudySessions],
  );

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
        </div>
      </header>

      <div className="grid min-h-0 gap-3 sm:gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-12">
        <div className="lg:col-span-4 xl:col-span-4">
          <section className="relative h-[20rem] overflow-hidden rounded-3xl border border-zinc-200/50 bg-white/40 shadow-xl backdrop-blur-md transition-all duration-300 hover:shadow-2xl active:scale-[0.98] group">
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
                  <span className="text-lg leading-none">+</span>
                </button>
              </header>

              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide pr-1">
                {top3.length === 0 ? (
                  <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-white/20 px-4 text-center">
                    <p className="text-xs font-medium text-zinc-400">Sin entregas pendientes</p>
                  </div>
                ) : (
                  <ul className="space-y-3 relative">
                    <div className="absolute left-2.5 top-2 bottom-2 w-px bg-zinc-200/60" />
                    {top3.map((it) => {
                      const rel = it.dueIso ? relativeDue(it.dueIso) : null;
                      return (
                        <li key={it.key} className="relative pl-7 group/item">
                          <div className="absolute left-1.5 top-1.5 h-2 w-2 rounded-full bg-white ring-2 ring-zinc-800 z-10" />
                          <div className="rounded-2xl border border-white bg-white/60 p-3 shadow-sm transition-all hover:bg-white hover:shadow-md active:bg-zinc-50">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 mb-1">
                                  <span className="truncate text-[9px] font-black uppercase tracking-tighter text-zinc-400 px-1.5 py-0.5 rounded-md bg-zinc-100">
                                    {it.courseName}
                                  </span>
                                  {it.dueIso && (
                                    <span className={`text-[9px] font-black uppercase ${rel?.tone === 'red' ? 'text-red-500' : 'text-amber-500'}`}>
                                      {rel?.label}
                                    </span>
                                  )}
                                </div>
                                <div className="truncate text-[13px] font-black text-zinc-900 leading-tight">
                                  {it.title}
                                </div>
                              </div>
                              {it.url && (
                                <a
                                  href={it.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="shrink-0 h-7 w-7 flex items-center justify-center rounded-xl bg-zinc-100 hover:bg-zinc-200 transition-colors"
                                >
                                  <span className="text-[10px] font-bold">↗</span>
                                </a>
                              )}
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
        </div>

        <div className="lg:col-span-4 xl:col-span-4">
          <section className="relative h-[20rem] overflow-hidden rounded-3xl bg-zinc-950 text-white shadow-2xl transition-all duration-300 active:scale-[0.98]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(239,68,68,0.15),transparent_70%)]" />
            <div className="relative flex h-full flex-col p-5">
              <header className="flex items-center justify-between mb-4">
                <div className="min-w-0">
                  <h3 className="text-sm font-black uppercase tracking-[0.2em] text-red-500/80">Urgente</h3>
                  <p className="text-xl font-black tracking-tight">Alertas Críticas</p>
                </div>
                <button
                  type="button"
                  onClick={() => setCriticalModalOpen(true)}
                  className="rounded-full bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white/60 hover:bg-white/20 transition-colors"
                >
                  Ver todas
                </button>
              </header>

              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
                {criticalAlerts.length === 0 ? (
                  <div className="flex h-full items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 text-center">
                    <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Todo al día</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {criticalAlerts.slice(0, 3).map((it) => (
                      <div
                        key={it.key}
                        className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-4 transition-all hover:bg-white/10"
                      >
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-600 shadow-[0_0_15px_rgba(220,38,38,0.5)]" />
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="truncate text-[9px] font-black uppercase tracking-wider text-red-400">
                                {it.courseName}
                              </span>
                              <span className="h-1 w-1 rounded-full bg-white/20" />
                              <span className="text-[9px] font-black text-white/40 uppercase">Vencida</span>
                            </div>
                            <div className="truncate text-sm font-black text-white leading-tight">
                              {it.title}
                            </div>
                          </div>
                          {it.url && (
                            <a
                              href={it.url}
                              target="_blank"
                              rel="noreferrer"
                              className="shrink-0 h-8 w-8 flex items-center justify-center rounded-full bg-red-600 text-white shadow-lg shadow-red-900/20 active:scale-90 transition-transform"
                            >
                              <span className="text-xs">!</span>
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>

        <div className="lg:col-span-4 xl:col-span-4">
          <section className="relative h-[20rem] overflow-hidden rounded-3xl border border-blue-100 bg-gradient-to-br from-blue-50/50 to-indigo-50/30 shadow-xl transition-all duration-300 active:scale-[0.98]">
            <div className="absolute right-0 top-0 h-32 w-32 translate-x-10 translate-y-[-10px] rounded-full bg-blue-200/20 blur-2xl" />
            <div className="relative flex h-full flex-col p-5">
              <header className="flex items-center justify-between mb-4">
                <div className="min-w-0">
                  <h3 className="text-sm font-black uppercase tracking-widest text-blue-400">Planificación</h3>
                  <p className="text-xl font-black tracking-tight text-blue-900">Sesiones</p>
                </div>
                <button
                  type="button"
                  onClick={() => setStudyModalOpen(true)}
                  className="rounded-2xl bg-blue-600/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-blue-700 hover:bg-blue-600/20 transition-colors"
                >
                  Ver plan
                </button>
              </header>

              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
                {topStudy3.length === 0 ? (
                  <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-blue-200 bg-white/40 px-4 text-center">
                    <p className="text-xs font-bold text-blue-300 uppercase tracking-widest">Sin sesiones</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2.5">
                    {topStudy3.map((s) => (
                      <div
                        key={s.key}
                        className="group flex items-center gap-3 rounded-2xl border border-white bg-white/80 p-3 shadow-sm transition-all hover:shadow-md hover:translate-y-[-1px]"
                      >
                        <div className="flex flex-col items-center justify-center h-10 w-10 shrink-0 rounded-xl bg-blue-50 text-blue-600">
                          <span className="text-[10px] font-black uppercase">{s.date.split("-")[2]}</span>
                          <span className="text-[8px] font-bold uppercase opacity-60">{s.date.split("-")[1]}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span
                              className="truncate max-w-[80px] text-[8px] font-black uppercase px-1.5 py-0.5 rounded-lg"
                              style={{
                                color: s.sessionTextColor,
                                backgroundColor: "color-mix(in srgb, white 20%, transparent)",
                                border: `1px solid ${s.sessionTextColor}`,
                              }}
                            >
                              {s.planTitle}
                            </span>
                            <span className="text-[10px] font-black text-blue-900/40">{s.hours}h</span>
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
        </div>

        <div className="lg:col-span-5 xl:col-span-4">
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
              <button
                type="button"
                disabled
                className="w-full min-h-[44px] rounded-xl bg-[var(--ink)] px-4 py-2 text-xs font-extrabold text-white opacity-70"
              >
                Empezar (mock)
              </button>
            </div>
          </WidgetShell>
        </div>

        <div className="lg:col-span-7 xl:col-span-8">
          <div className="grid gap-3 sm:gap-4 grid-cols-1 md:grid-cols-2">
            <WidgetShell title="Exámenes" subtitle="Cuenta regresiva">
              <div className="flex items-center justify-between gap-3">
                <div className="shrink-0">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-[var(--ink-faint)]">Materia</div>
                  <div className="text-sm font-bold truncate max-w-[100px]">{MOCK.nextExam.subject}</div>
                  <div className="mt-1 flex items-baseline gap-1">
                    <div className="text-3xl font-extrabold tracking-tight">{MOCK.nextExam.daysLeft}</div>
                    <div className="text-[10px] font-bold text-[var(--ink-muted)]">días</div>
                  </div>
                </div>
                <div className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-2.5">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-[var(--ink-faint)]">Tip</div>
                  <div className="mt-0.5 text-[11px] font-bold leading-tight line-clamp-2">{MOCK.nextExam.suggestion}</div>
                </div>
              </div>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-black/5">
                <div className="h-full bg-[var(--ink)]" style={{ width: `${Math.max(10, 100 - MOCK.nextExam.daysLeft * 12)}%` }} />
              </div>
            </WidgetShell>

            <WidgetShell
              title="Adherencia"
              subtitle="Semana actual"
              right={<span className="text-[9px] font-bold text-[var(--ink-faint)] uppercase">Mock</span>}
            >
              <div className="flex items-center gap-4">
                <ProgressRing valuePct={MOCK.adherencia.valuePct} label="Plan" />
                <p className="text-[11px] font-bold text-[var(--ink-muted)] leading-tight">{MOCK.adherencia.suggestion}</p>
              </div>
            </WidgetShell>
          </div>
        </div>

        <div className="md:col-span-2 lg:col-span-6 xl:col-span-7">
          <WidgetShell title="Carga Semanal" subtitle="Mapa de calor (mock)">
            <HeatmapWeek values={MOCK.heatmap.values} />
          </WidgetShell>
        </div>

        <div className="md:col-span-2 lg:col-span-6 xl:col-span-5">
          <WidgetShell title="Reloj Biológico" subtitle="Eficiencia (mock)">
            <LineChart points={MOCK.bio.points} labels={MOCK.bio.labels} />
          </WidgetShell>
        </div>

        <div className="md:col-span-2 lg:col-span-6 xl:col-span-4">
          <WidgetShell
            title="Esfuerzo por Asignatura"
            subtitle="Distribución horaria"
          >
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
                    <div
                      key={it.label}
                      className="flex items-center justify-between gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1.5"
                    >
                      <span className="flex items-center gap-1 text-[9px] font-bold text-[var(--ink-muted)] truncate">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: it.color }}
                        />
                        <span className="truncate">{it.label}</span>
                      </span>
                      <span className="font-mono-cli text-[9px] font-bold shrink-0">
                        {Math.round(it.pct)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </WidgetShell>
        </div>

        <div className="md:col-span-2 lg:col-span-6 xl:col-span-8">
          <WidgetShell title="Burnout / Fatiga" subtitle="Señales tempranas">
            <BurnoutGauge valuePct={MOCK.burnout.valuePct} />
          </WidgetShell>
        </div>

        <div className="md:col-span-2 lg:col-span-6 xl:col-span-4">
          <WidgetShell title="Racha (Streaks)" subtitle="Gamificación" tone="accent">
            <div className="flex items-center gap-3">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-2.5 shrink-0 text-center">
                <div className="text-[9px] font-bold text-[var(--ink-muted)] uppercase tracking-tight">Racha</div>
                <div className="text-2xl font-extrabold">{MOCK.streaks.days}</div>
                <div className="text-[8px] font-bold text-[var(--ink-faint)]">Récord: {MOCK.streaks.bestDays}</div>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold leading-tight">{MOCK.streaks.message}</p>
                <button
                  type="button"
                  disabled
                  className="mt-2 w-full min-h-[36px] rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1 text-[10px] font-bold opacity-70"
                >
                  Objetivo hoy (mock)
                </button>
              </div>
            </div>
          </WidgetShell>
        </div>

        <div className="md:col-span-2 lg:col-span-6 xl:col-span-8">
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
        </div>
      </div>

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

