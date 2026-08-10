"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { GoogleCalendarEventItem } from "@/lib/google-calendar-types";
import { getGoogleEventColorStyle } from "@/lib/google-calendar-event-colors";
import {
  HOURS_IN_GRID,
  getGridMetrics,
  buildAllDayChipsByColumn,
  buildTimedSegmentsForWeek,
} from "@/lib/week-time-grid-layout";
import { DEADLINE_CALENDAR_EVENT_ID_PREFIX } from "@/lib/deadlines-to-calendar-events";
import {
  STUDY_PLAN_DAY_EVENT_ID_PREFIX,
  STUDY_PLAN_PREVIEW_CALENDAR_ID,
} from "@/lib/study-plans-calendar-events";

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

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

type WeekGoogleStyleGridProps = {
  weekDates: Date[];
  events: GoogleCalendarEventItem[];
  isTodayDate: (d: Date) => boolean;
  /** Si se omite, no se muestra borrar (solo lectura). */
  onDeleteEvent?: (p: { eventId: string; calendarId: string }) => void;
  deletingKey?: string | null;
  /** Callback para mover un evento local a una nueva hora (HH:mm). calendarId identifica el origen. */
  onMoveEvent?: (p: { calendarId: string; eventId: string; newTime: string }) => void;
};

export function WeekGoogleStyleGrid({
  weekDates,
  events,
  isTodayDate,
  onDeleteEvent,
  deletingKey,
  onMoveEvent,
}: WeekGoogleStyleGridProps) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const { pxPerHour, gridHeightPx } = useMemo(() => getGridMetrics(isMobile), [isMobile]);

  const timed = useMemo(
    () => buildTimedSegmentsForWeek(events, weekDates),
    [events, weekDates],
  );
  const allDayByCol = useMemo(
    () => buildAllDayChipsByColumn(events, weekDates),
    [events, weekDates],
  );

  const hours = useMemo(
    () => Array.from({ length: HOURS_IN_GRID }, (_, i) => i),
    [],
  );

  const [nowLinePx, setNowLinePx] = useState<number | null>(null);
  useEffect(() => {
    function tick() {
      const t = new Date();
      const mins = t.getHours() * 60 + t.getMinutes() + t.getSeconds() / 60;
      setNowLinePx((mins / (HOURS_IN_GRID * 60)) * gridHeightPx);
    }
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [gridHeightPx]);

  const todayCol = weekDates.findIndex((d) => isTodayDate(d));

  const maxAllDayRows = useMemo(() => {
    let m = 1;
    for (let c = 0; c < 7; c++) {
      m = Math.max(m, (allDayByCol.get(c) ?? []).length);
    }
    return m;
  }, [allDayByCol]);

  const allDayRowHeight = Math.min(40 + maxAllDayRows * 34, 260);

  const scrollBodyRef = useRef<HTMLDivElement>(null);
  const weekKey = weekDates[0]
    ? `${weekDates[0].getFullYear()}-${weekDates[0].getMonth()}-${weekDates[0].getDate()}`
    : "";

  const earliestTimedTopPx = useMemo(() => {
    if (timed.length === 0) return 0;
    // Escalamos el topPx original (basado en 76px/h) al nuevo gridHeightPx
    return Math.min(...timed.map((s) => (s.topPx / (24 * 76)) * gridHeightPx));
  }, [timed, gridHeightPx]);

  useLayoutEffect(() => {
    const el = scrollBodyRef.current;
    if (!el || !weekKey) return;
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    const target =
      timed.length === 0 ? 0 : Math.max(0, Math.min(earliestTimedTopPx, maxScroll));
    el.scrollTop = target;
  }, [weekKey, earliestTimedTopPx, timed.length, allDayRowHeight, gridHeightPx]);

  const dragRef = useRef<{
    eventId: string;
    calendarId: string;
    startY: number;
    origTopPx: number;
    heightPx: number;
  } | null>(null);
  const [dragDeltaPx, setDragDeltaPx] = useState(0);
  const [draggingEventId, setDraggingEventId] = useState<string | null>(null);

  const isDraggableEvent = useCallback(
    (eventId?: string) =>
      Boolean(
        onMoveEvent &&
          (eventId?.startsWith(DEADLINE_CALENDAR_EVENT_ID_PREFIX) ||
            eventId?.startsWith(STUDY_PLAN_DAY_EVENT_ID_PREFIX)),
      ),
    [onMoveEvent],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, seg: { eventId?: string; calendarId?: string; topPx: number; heightPx: number }) => {
      if (!seg.eventId || !isDraggableEvent(seg.eventId)) return;
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      // Escalamos el topPx/heightPx original al actual para el drag
      const currentTop = (seg.topPx / (24 * 76)) * gridHeightPx;
      const currentHeight = (seg.heightPx / (24 * 76)) * gridHeightPx;
      dragRef.current = {
        eventId: seg.eventId,
        calendarId: seg.calendarId ?? "",
        startY: e.clientY,
        origTopPx: currentTop,
        heightPx: currentHeight,
      };
      setDraggingEventId(seg.eventId);
      setDragDeltaPx(0);
    },
    [isDraggableEvent, gridHeightPx],
  );

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    e.preventDefault();
    setDragDeltaPx(e.clientY - dragRef.current.startY);
  }, []);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      e.preventDefault();
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      dragRef.current = null;
      setDraggingEventId(null);
      setDragDeltaPx(0);

      const newTopPx = Math.max(0, Math.min(gridHeightPx - drag.heightPx, drag.origTopPx + (e.clientY - drag.startY)));
      const SNAP_MINUTES = 15;
      const totalMinutes = (newTopPx / gridHeightPx) * HOURS_IN_GRID * 60;
      const snapped = Math.round(totalMinutes / SNAP_MINUTES) * SNAP_MINUTES;
      const h = Math.floor(snapped / 60);
      const m = snapped % 60;
      const newTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

      let rawId: string;
      if (drag.eventId.startsWith(DEADLINE_CALENDAR_EVENT_ID_PREFIX)) {
        rawId = drag.eventId.slice(DEADLINE_CALENDAR_EVENT_ID_PREFIX.length);
      } else if (drag.eventId.startsWith(STUDY_PLAN_DAY_EVENT_ID_PREFIX)) {
        rawId = drag.eventId.slice(STUDY_PLAN_DAY_EVENT_ID_PREFIX.length);
      } else {
        rawId = drag.eventId;
      }
      onMoveEvent?.({ calendarId: drag.calendarId, eventId: rawId, newTime });
    },
    [onMoveEvent, gridHeightPx],
  );

  return (
    <div
      data-calendar-dark
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-white via-zinc-50/95 to-zinc-100/50 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.14)] ring-1 ring-zinc-200/70"
    >
      <div
        ref={scrollBodyRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-auto scrollbar-hide"
      >
        <div
          className="sticky top-0 z-20 min-w-full border-b border-zinc-200/80 bg-gradient-to-b from-white/98 to-zinc-50/95 backdrop-blur-sm"
          style={{
            display: "grid",
            gridTemplateColumns: `${isMobile ? "3rem" : "4.75rem"} repeat(7, minmax(0, 1fr))`,
          }}
        >
          <div className="border-r border-zinc-200/60 bg-zinc-100/40" />
          {weekDates.map((d, col) => {
            const today = isTodayDate(d);
            return (
              <div
                key={d.toISOString()}
                className="border-r border-zinc-200/60 bg-gradient-to-b from-white/90 to-zinc-50/70 px-0.5 py-1 sm:px-1.5 last:border-r-0"
              >
                <div className="flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 leading-none">
                  <span className="shrink-0 text-[8px] sm:text-[10px] font-bold sm:font-medium uppercase tracking-tighter sm:tracking-wide text-zinc-500">
                    {WEEKDAYS[col]}
                  </span>
                  <span
                    className={`flex h-5 w-5 sm:h-6 sm:w-6 shrink-0 items-center justify-center rounded-full text-[10px] sm:text-[11px] font-bold tabular-nums shadow-sm ${
                      today
                        ? "bg-black text-white shadow-md ring-1 sm:ring-2 ring-black/25"
                        : "bg-white/90 text-zinc-800 ring-1 ring-zinc-200/80"
                    }`}
                  >
                    {d.getDate()}
                  </span>
                </div>
              </div>
            );
          })}

          <div className="flex items-center justify-center border-r border-t border-zinc-200/60 bg-zinc-50/50 px-1 py-1.5 text-[8px] font-bold uppercase tracking-widest text-zinc-400">
            {isMobile ? "T.D." : "Todo el día"}
          </div>
          {weekDates.map((d, col) => (
            <div
              key={`allday-${d.toISOString()}`}
              className="border-r border-t border-zinc-200/60 bg-zinc-50/30 p-1 sm:p-1.5 last:border-r-0"
              style={{ minHeight: isMobile ? 32 : allDayRowHeight }}
            >
              <div className="flex flex-col gap-0.5">
                {(allDayByCol.get(col) ?? []).map((chip) => {
                  const c = getGoogleEventColorStyle(chip.colorId);
                  const delKey =
                    chip.calendarId && chip.eventId
                      ? `${chip.calendarId}\u0000${chip.eventId}`
                      : "";
                  const showDelete = Boolean(
                    onDeleteEvent && chip.eventId && chip.calendarId,
                  );
                  const isDeleting = deletingKey === delKey;
                  return (
                    <div
                      key={chip.key}
                      className="flex min-w-0 items-start gap-1 rounded-md sm:rounded-lg border px-1 sm:px-1.5 py-0.5 sm:py-1 text-[9px] sm:text-xs font-bold sm:font-medium shadow-sm ring-1 ring-black/[0.04]"
                      style={{
                        backgroundColor: c.bg,
                        borderColor: c.border,
                        borderLeftWidth: isMobile ? 2 : 3,
                        borderLeftColor: c.borderLeft,
                        color: c.text,
                      }}
                      title={chip.title}
                    >
                      <span className="min-w-0 flex-1 truncate">{chip.title}</span>
                      {showDelete && !isMobile ? (
                        <button
                          type="button"
                          className="shrink-0 rounded p-0.5 opacity-80 hover:bg-black/10 hover:opacity-100 disabled:opacity-40"
                          aria-label="Eliminar evento"
                          disabled={isDeleting}
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteEvent!({
                              eventId: chip.eventId!,
                              calendarId: chip.calendarId!,
                            });
                          }}
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div
          className="flex min-w-full bg-zinc-50/20"
          style={{ minHeight: gridHeightPx }}
        >
          <div
            className="shrink-0 border-r border-zinc-200/60 bg-gradient-to-b from-zinc-50/80 to-white/40"
            style={{ width: isMobile ? "3rem" : "4.75rem" }}
          >
            {hours.map((h) => (
              <div
                key={h}
                className="relative box-border text-right"
                style={{ height: pxPerHour }}
              >
                <span className="absolute -top-2.5 right-1 sm:right-1.5 font-mono-cli text-[9px] sm:text-xs tabular-nums text-zinc-400 font-bold">
                  {h.toString().padStart(2, "0")}:00
                </span>
              </div>
            ))}
          </div>

          <div
            className="relative grid flex-1 grid-cols-7"
            style={{ height: gridHeightPx }}
          >
            {weekDates.map((d, col) => (
              <div
                key={`grid-${d.toISOString()}`}
                className="relative border-l border-zinc-100 bg-white/30"
              >
                {hours.map((h) => (
                  <div
                    key={h}
                    className="pointer-events-none absolute left-0 right-0 box-border border-t border-zinc-100/90"
                    style={{ top: h * pxPerHour }}
                  />
                ))}
                <div
                  className="pointer-events-none absolute bottom-0 left-0 right-0 border-t border-zinc-200/60"
                  style={{ top: gridHeightPx - 1 }}
                />

                {todayCol === col && nowLinePx !== null ? (
                  <div
                    className="pointer-events-none absolute left-0 right-0 z-30 border-t-[2px] sm:border-t-[3px] border-black shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_2px_12px_rgba(0,0,0,0.12)]"
                    style={{ top: nowLinePx }}
                    aria-hidden
                  />
                ) : null}

                {timed
                  .filter((s) => s.col === col)
                  .map((s) => {
                    const w = 100 / s.maxLanes;
                    const leftPct = w * s.lane;
                    const c = getGoogleEventColorStyle(s.colorId);
                    const delKey =
                      s.calendarId && s.eventId
                        ? `${s.calendarId}\u0000${s.eventId}`
                        : "";
                    const showDelete = Boolean(
                      onDeleteEvent && s.eventId && s.calendarId,
                    );
                    const isDeleting = deletingKey === delKey;
                    const canDrag = isDraggableEvent(s.eventId);
                    const isDragging = draggingEventId === s.eventId;

                    const scaledTopPx = (s.topPx / (24 * 76)) * gridHeightPx;
                    const scaledHeightPx = (s.heightPx / (24 * 76)) * gridHeightPx;

                    const effectiveTop = isDragging
                      ? Math.max(0, Math.min(gridHeightPx - scaledHeightPx, scaledTopPx + dragDeltaPx))
                      : scaledTopPx;

                    return (
                      <div
                        key={s.key}
                        className={`absolute z-10 overflow-hidden rounded-lg sm:rounded-xl border border-l-[2px] sm:border-l-[3px] px-1 sm:px-1.5 py-0.5 sm:py-1 text-left shadow-sm sm:shadow-md ring-1 ring-black/[0.05] ${canDrag ? "touch-none" : ""} ${isDragging ? "z-40 opacity-90 shadow-2xl ring-2 ring-black/20" : ""}`}
                        style={{
                          top: effectiveTop,
                          height: Math.max(scaledHeightPx, isMobile ? 18 : 22),
                          left: `calc(${leftPct}% + 1px)`,
                          width: `calc(${w}% - 2px)`,
                          backgroundColor: c.bg,
                          borderColor: c.border,
                          borderLeftColor: c.borderLeft,
                          boxShadow: isDragging
                            ? "0 8px 30px rgba(15,23,42,0.18)"
                            : "0 4px 14px rgba(15,23,42,0.08)",
                          cursor: canDrag ? (isDragging ? "grabbing" : "grab") : undefined,
                          transition: isDragging ? "none" : "top 0.15s ease",
                        }}
                        title={`${s.rangeLabel} · ${s.title}`}
                        onPointerDown={canDrag ? (e) => handlePointerDown(e, s) : undefined}
                        onPointerMove={canDrag ? handlePointerMove : undefined}
                        onPointerUp={canDrag ? handlePointerUp : undefined}
                      >
                        <div className="flex items-start gap-0.5 h-full">
                          <div className="min-w-0 flex-1 h-full overflow-hidden">
                            {canDrag && !isMobile ? (
                              <div
                                className="mx-auto mb-0.5 h-1 w-8 rounded-full opacity-40"
                                style={{ backgroundColor: c.text }}
                                aria-hidden
                              />
                            ) : null}
                            <div
                              className="font-mono-cli text-[8px] sm:text-[11px] leading-tight font-bold"
                              style={{ color: c.textMuted }}
                            >
                              {isDragging
                                ? (() => {
                                    const SNAP = 15;
                                    const totalMin = (effectiveTop / gridHeightPx) * HOURS_IN_GRID * 60;
                                    const snapped = Math.round(totalMin / SNAP) * SNAP;
                                    const hh = Math.floor(snapped / 60);
                                    const mm = snapped % 60;
                                    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
                                  })()
                                : s.rangeLabel}
                            </div>
                            <div
                              className="line-clamp-3 sm:line-clamp-[4] text-[10px] sm:text-sm font-black sm:font-semibold leading-tight sm:leading-snug"
                              style={{ color: c.text }}
                            >
                              {s.title}
                            </div>
                          </div>
                          {showDelete && !isMobile ? (
                            <button
                              type="button"
                              className="shrink-0 rounded p-0.5 opacity-80 hover:bg-black/10 hover:opacity-100 disabled:opacity-40"
                              style={{ color: c.text }}
                              aria-label="Eliminar evento"
                              disabled={isDeleting}
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteEvent!({
                                  eventId: s.eventId!,
                                  calendarId: s.calendarId!,
                                });
                              }}
                            >
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
