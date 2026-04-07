"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCloudSyncStatus } from "@/components/providers/CloudSyncProvider";
import type { DeadlineTag, ImportantDeadline } from "@/types/dashboard";
import type { BbCourseItem } from "@/types/blackboard";
import {
  DEADLINE_TAGS_CHANGED_EVENT,
  findOrCreateDeadlineTag,
  loadDeadlineTags,
  DEADLINE_TAGS_STORAGE_KEY,
} from "@/lib/deadline-tags-storage";
import {
  DEADLINES_CHANGED_EVENT,
  loadImportantDeadlines,
  saveImportantDeadlines,
} from "@/lib/deadlines-storage";
import { loadManualCourses } from "@/lib/manual-courses-storage";
import { readBbDisplayedCoursesSnapshot } from "@/lib/bb-displayed-courses";
import { BB_COURSES_STORAGE_CHANGED } from "@/lib/blackboard-storage";
import { BB_COURSE_CURATION_CHANGED } from "@/lib/bb-course-curation";
import { BB_COURSE_FILTER_CHANGED } from "@/lib/bb-course-filter-prefs";
import {
  GOOGLE_CALENDAR_EVENT_COLOR_IDS,
  GOOGLE_EVENT_COLOR_LABELS,
  getGoogleEventColorStyle,
  normalizeGoogleEventColorId,
} from "@/lib/google-calendar-event-colors";
import { IconPlus } from "@/components/dashboard/icons";

function formatDateEs(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("es", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** HH:mm → texto local en español (ej. 14:30 o 2:30 p. m.). */
function formatTimeEs(hm: string): string {
  const [h, min] = hm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(min)) return hm;
  const dt = new Date();
  dt.setHours(h, min, 0, 0);
  return dt.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

function todayYmd(): string {
  const t = new Date();
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function bbCourseDisplayLine(c: BbCourseItem): string {
  return c.name;
}

function bbCourseMatchesQuery(c: BbCourseItem, q: string): boolean {
  const n = q.trim().toLowerCase();
  if (!n) return true;
  const hay = `${c.name} ${c.learnCourseId} ${c.category ?? ""}`.toLowerCase();
  return hay.includes(n);
}

/** Solo muestra el color actual; al pulsar se abre el desplegable con la paleta. */
function DeadlineCalendarColorCompact({
  value,
  onChange,
  variant = "default",
}: {
  value: string;
  onChange: (colorId: string) => void;
  /** `square`: mismo tamaño que el botón «+» (40×40). */
  variant?: "default" | "square";
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const v = normalizeGoogleEventColorId(value);
  const current = getGoogleEventColorStyle(v);
  const isSquare = variant === "square";

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div className="relative shrink-0" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={`Color: ${GOOGLE_EVENT_COLOR_LABELS[v] ?? v}. Clic para cambiar.`}
        aria-label={`Color en calendario: ${GOOGLE_EVENT_COLOR_LABELS[v] ?? v}`}
        className={
          isSquare
            ? `flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--canvas)] transition hover:bg-[var(--surface-muted)] focus:border-[var(--ink)] focus:outline-none ${
                open ? "border-[var(--ink)]" : ""
              }`
            : "flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--canvas)] transition hover:bg-[var(--surface-muted)]"
        }
      >
        <span
          className="h-5 w-5 shrink-0 rounded-full ring-2 ring-[var(--ink)]/15 ring-offset-1 ring-offset-[var(--canvas)]"
          style={{ backgroundColor: current.borderLeft }}
        />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-[100] mt-1 w-[11.5rem] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-lg ring-1 ring-black/5">
          <p className="mb-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
            Color en calendario
          </p>
          <div className="flex flex-wrap gap-1.5" role="listbox" aria-label="Elegir color">
            {GOOGLE_CALENDAR_EVENT_COLOR_IDS.map((id) => {
              const c = getGoogleEventColorStyle(id);
              const sel = v === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="option"
                  aria-selected={sel}
                  title={GOOGLE_EVENT_COLOR_LABELS[id] ?? id}
                  onClick={() => {
                    onChange(id);
                    setOpen(false);
                  }}
                  className={`h-7 w-7 rounded-full ring-2 ring-offset-1 ring-offset-[var(--surface)] transition ${
                    sel ? "ring-[var(--ink)]" : "ring-transparent hover:ring-[var(--border)]"
                  }`}
                  style={{ backgroundColor: c.borderLeft }}
                />
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DeadlineTagPicker({
  selectedIds,
  onChange,
  allTags,
  compact,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  allTags: DeadlineTag[];
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

  const sortedTags = useMemo(() => {
    return [...allTags].sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [allTags]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (open) queueMicrotask(() => createInputRef.current?.focus());
  }, [open]);

  function toggle(id: string) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  function commitCreate() {
    const t = findOrCreateDeadlineTag(createDraft);
    setCreateDraft("");
    if (!t) return;
    if (!selectedIds.includes(t.id)) onChange([...selectedIds, t.id]);
  }

  const triggerLabel = useMemo(() => {
    if (selectedIds.length === 0) return "Añadir etiquetas";
    const labels = selectedIds
      .map((id) => allTags.find((t) => t.id === id)?.label)
      .filter(Boolean) as string[];
    if (labels.length === 0) return "Añadir etiquetas";
    if (labels.length === 1) return labels[0];
    if (labels.length === 2) return `${labels[0]}, ${labels[1]}`;
    return `${labels[0]}, ${labels[1]} +${labels.length - 2}`;
  }, [selectedIds, allTags]);

  return (
    <div className="relative w-full min-w-0" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`flex w-full items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--canvas)] text-left text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:border-[var(--ink)] focus:outline-none ${
          compact
            ? "min-h-8 px-2 py-1.5 text-xs"
            : "min-h-[2.5rem] px-3 py-2 text-sm"
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{triggerLabel}</span>
        <ChevronDownMini
          className={`shrink-0 opacity-70 transition ${compact ? "h-3 w-3" : "h-4 w-4"} ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div
          className={`absolute z-50 mt-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-lg ring-1 ring-black/5 ${
            compact ? "right-0 min-w-[14rem] max-w-[min(18rem,100vw)]" : "left-0 right-0"
          }`}
        >
          <input
            ref={createInputRef}
            type="text"
            value={createDraft}
            onChange={(e) => setCreateDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitCreate();
              }
            }}
            placeholder="Crear nueva etiqueta… (Enter)"
            autoComplete="off"
            className="mb-2 w-full rounded-lg border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--ink)] focus:outline-none"
            aria-label="Crear nueva etiqueta"
            onClick={(e) => e.stopPropagation()}
          />
          <div
            className="max-h-40 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--canvas)] p-1"
            role="listbox"
            aria-label="Etiquetas existentes"
            aria-multiselectable
          >
            {sortedTags.length === 0 ? (
              <p className="px-3 py-2 text-xs text-[var(--ink-faint)]">
                Aún no hay etiquetas. Escribe arriba y pulsa Enter para crear la primera.
              </p>
            ) : (
              sortedTags.map((t) => {
                const on = selectedIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => toggle(t.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-[var(--surface-muted)] ${
                      on
                        ? "bg-[var(--surface-muted)] font-semibold text-[var(--ink)]"
                        : "text-[var(--ink)]"
                    }`}
                  >
                    <span className="min-w-0 truncate">{t.label}</span>
                    {on ? (
                      <span className="shrink-0 text-xs text-[var(--ink-muted)]" aria-hidden>
                        ✓
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ChevronDownMini({ className }: { className?: string }) {
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
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function EditDeadlineDialog({
  deadline,
  onClose,
  displayedCourses,
  tagRegistry,
}: {
  deadline: ImportantDeadline;
  onClose: () => void;
  displayedCourses: BbCourseItem[];
  tagRegistry: DeadlineTag[];
}) {
  const [title, setTitle] = useState(deadline.title);
  const [date, setDate] = useState(deadline.date);
  const [time, setTime] = useState(deadline.time ?? "");
  const [courseId, setCourseId] = useState(deadline.courseId ?? "");
  const [courseChoiceTouched, setCourseChoiceTouched] = useState(true);
  const [courseSearch, setCourseSearch] = useState("");
  const [coursePickerOpen, setCoursePickerOpen] = useState(false);
  const coursePickerRef = useRef<HTMLDivElement>(null);
  const courseSearchInputRef = useRef<HTMLInputElement>(null);
  const [formTagIds, setFormTagIds] = useState<string[]>([...deadline.tagIds]);
  const [formColorId, setFormColorId] = useState(deadline.calendarColorId);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!coursePickerOpen) return;
    function handlePointerDown(e: PointerEvent) {
      if (coursePickerRef.current?.contains(e.target as Node)) return;
      setCoursePickerOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [coursePickerOpen]);

  useEffect(() => {
    if (coursePickerOpen) {
      queueMicrotask(() => courseSearchInputRef.current?.focus());
    }
  }, [coursePickerOpen]);

  const filteredCourses = useMemo(() => {
    return displayedCourses.filter((c) => bbCourseMatchesQuery(c, courseSearch));
  }, [displayedCourses, courseSearch]);

  function selectCourseFromPicker(id: string) {
    setCourseId(id);
    setCourseChoiceTouched(true);
    setCourseSearch("");
    setCoursePickerOpen(false);
  }

  const courseTriggerLabel = (() => {
    if (courseId) {
      const row = displayedCourses.find((c) => c.learnCourseId === courseId);
      if (row) return bbCourseDisplayLine(row);
      return "Asignatura eliminada";
    }
    if (courseChoiceTouched && courseId === "") return "Sin asignatura";
    return "Seleccionar asignatura";
  })();

  function save() {
    const t = title.trim();
    if (!t || !date) return;
    const known = new Set(loadDeadlineTags().map((x) => x.id));
    const tagIds = formTagIds.filter((id) => known.has(id));
    const next: ImportantDeadline = {
      ...deadline,
      title: t,
      date,
      time: time.trim() === "" ? null : time.trim(),
      courseId: courseId === "" ? null : courseId,
      tagIds,
      calendarColorId: normalizeGoogleEventColorId(formColorId),
    };
    saveImportantDeadlines(
      loadImportantDeadlines().map((d) => (d.id === deadline.id ? next : d)),
    );
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Cerrar"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-deadline-title"
        className="relative z-10 max-h-[min(92dvh,100%)] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl sm:rounded-2xl sm:p-5"
      >
        <h2 id="edit-deadline-title" className="text-lg font-extrabold text-[var(--ink)]">
          Editar fecha o examen
        </h2>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">
          Los cambios se reflejan al instante en el calendario de la app.
        </p>
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Título
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-base text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--ink)] focus:outline-none sm:text-sm"
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="min-w-[10rem] flex-1">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                Fecha
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-base text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none sm:text-sm"
              />
            </div>
            <div className="min-w-[9rem] flex-1">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                Hora <span className="font-normal normal-case text-[var(--ink-faint)]">(opcional)</span>
              </label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-base text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none sm:text-sm"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Asignatura
            </label>
            <div className="relative" ref={coursePickerRef}>
              <button
                type="button"
                onClick={() => setCoursePickerOpen((o) => !o)}
                aria-expanded={coursePickerOpen}
                aria-haspopup="listbox"
                className="flex w-full min-h-[2.5rem] items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-left text-base text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:border-[var(--ink)] focus:outline-none sm:text-sm"
              >
                <span className="min-w-0 flex-1 truncate">{courseTriggerLabel}</span>
                <ChevronDownMini
                  className={`h-4 w-4 shrink-0 opacity-70 transition ${coursePickerOpen ? "rotate-180" : ""}`}
                />
              </button>
              {coursePickerOpen ? (
                <div className="absolute left-0 right-0 z-50 mt-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-lg ring-1 ring-black/5">
                  <input
                    ref={courseSearchInputRef}
                    type="search"
                    value={courseSearch}
                    onChange={(e) => setCourseSearch(e.target.value)}
                    placeholder="Buscar asignatura…"
                    disabled={displayedCourses.length === 0}
                    autoComplete="off"
                    className="mb-2 w-full rounded-lg border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-base text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--ink)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
                    aria-label="Buscar asignatura"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div
                    className="max-h-40 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--canvas)] p-1"
                    role="listbox"
                    aria-label="Lista de asignaturas"
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={courseId === "" && courseChoiceTouched}
                      onClick={() => selectCourseFromPicker("")}
                      className={`flex w-full rounded-lg px-3 py-2 text-left text-base transition hover:bg-[var(--surface-muted)] sm:text-sm ${
                        courseId === "" && courseChoiceTouched
                          ? "bg-[var(--surface-muted)] font-semibold text-[var(--ink)]"
                          : "text-[var(--ink-muted)]"
                      }`}
                    >
                      Sin asignatura
                    </button>
                    {displayedCourses.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-[var(--ink-faint)]">
                        No hay cursos en Courses. Configura la lista allí primero.
                      </p>
                    ) : filteredCourses.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-[var(--ink-faint)]">
                        Ninguna asignatura coincide con la búsqueda.
                      </p>
                    ) : (
                      filteredCourses.map((c) => (
                        <button
                          key={c.learnCourseId}
                          type="button"
                          role="option"
                          aria-selected={courseId === c.learnCourseId}
                          onClick={() => selectCourseFromPicker(c.learnCourseId)}
                          className={`flex w-full rounded-lg px-3 py-2 text-left text-base transition hover:bg-[var(--surface-muted)] sm:text-sm ${
                            courseId === c.learnCourseId
                              ? "bg-[var(--surface-muted)] font-semibold text-[var(--ink)]"
                              : "text-[var(--ink)]"
                          }`}
                        >
                          {bbCourseDisplayLine(c)}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Etiquetas
            </label>
            <DeadlineTagPicker selectedIds={formTagIds} onChange={setFormTagIds} allTags={tagRegistry} />
          </div>
          <div className="flex items-end gap-2">
            <div className="shrink-0">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                Color
              </label>
              <DeadlineCalendarColorCompact variant="square" value={formColorId} onChange={setFormColorId} />
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
            disabled={!title.trim() || !date}
            className="min-h-[44px] rounded-xl bg-[var(--ink)] px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

export function DeadlinesPanel() {
  const cloudSync = useCloudSyncStatus();
  const [deadlines, setDeadlines] = useState<ImportantDeadline[]>([]);
  const [tagRegistry, setTagRegistry] = useState<DeadlineTag[]>([]);
  /** Misma lista que el panel Courses (Blackboard + curación + filtro). */
  const [displayedCourses, setDisplayedCourses] = useState<BbCourseItem[]>([]);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => todayYmd());
  /** Vacío = sin hora; si no, HH:mm del input type="time". */
  const [time, setTime] = useState("");
  const [courseId, setCourseId] = useState<string>("");
  /** true tras elegir algo en el panel (incl. «Sin asignatura»); distingue de «aún no elegí». */
  const [courseChoiceTouched, setCourseChoiceTouched] = useState(false);
  const [courseSearch, setCourseSearch] = useState("");
  const [coursePickerOpen, setCoursePickerOpen] = useState(false);
  const coursePickerRef = useRef<HTMLDivElement>(null);
  const courseSearchInputRef = useRef<HTMLInputElement>(null);
  const [formTagIds, setFormTagIds] = useState<string[]>([]);
  const [formColorId, setFormColorId] = useState("6");
  const [editingDeadline, setEditingDeadline] = useState<ImportantDeadline | null>(null);

  const refresh = useCallback(() => {
    /** Excluir sesiones del Study Planner (id: "study-<planId>-<date>"); son eventos de calendario
     * pero no son exámenes/fechas manuales y no deben aparecer aquí. */
    const list = loadImportantDeadlines().filter((d) => !d.id.startsWith("study-"));
    setDeadlines(list);
    setTagRegistry(loadDeadlineTags());
    const snap = readBbDisplayedCoursesSnapshot();
    setDisplayedCourses(snap.hasConfig ? snap.displayedCourses : []);
    setEditingDeadline((cur) => {
      if (!cur) return cur;
      return list.some((d) => d.id === cur.id) ? cur : null;
    });
  }, []);

  useEffect(() => {
    refresh();
    function onStorage(e: StorageEvent) {
      if (
        e.key === "iestudio-important-deadlines" ||
        e.key === "iestudio-manual-courses" ||
        e.key === DEADLINE_TAGS_STORAGE_KEY
      ) {
        refresh();
      }
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener(DEADLINES_CHANGED_EVENT, refresh);
    window.addEventListener(DEADLINE_TAGS_CHANGED_EVENT, refresh);
    window.addEventListener(BB_COURSES_STORAGE_CHANGED, refresh);
    window.addEventListener(BB_COURSE_CURATION_CHANGED, refresh);
    window.addEventListener(BB_COURSE_FILTER_CHANGED, refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(DEADLINES_CHANGED_EVENT, refresh);
      window.removeEventListener(DEADLINE_TAGS_CHANGED_EVENT, refresh);
      window.removeEventListener(BB_COURSES_STORAGE_CHANGED, refresh);
      window.removeEventListener(BB_COURSE_CURATION_CHANGED, refresh);
      window.removeEventListener(BB_COURSE_FILTER_CHANGED, refresh);
    };
  }, [refresh, cloudSync?.initialSyncDone]);

  /** Si el curso elegido deja de estar en la lista de Courses, se anula la selección. */
  useEffect(() => {
    if (!courseId) return;
    if (!displayedCourses.some((c) => c.learnCourseId === courseId)) {
      setCourseId("");
      setCourseChoiceTouched(false);
    }
  }, [displayedCourses, courseId]);

  useEffect(() => {
    if (!coursePickerOpen) return;
    function handlePointerDown(e: PointerEvent) {
      if (coursePickerRef.current?.contains(e.target as Node)) return;
      setCoursePickerOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [coursePickerOpen]);

  useEffect(() => {
    if (coursePickerOpen) {
      queueMicrotask(() => courseSearchInputRef.current?.focus());
    }
  }, [coursePickerOpen]);

  const filteredCourses = useMemo(() => {
    return displayedCourses.filter((c) => bbCourseMatchesQuery(c, courseSearch));
  }, [displayedCourses, courseSearch]);

  const sorted = useMemo(() => {
    return [...deadlines].sort((a, b) => {
      const cmp = a.date.localeCompare(b.date);
      if (cmp !== 0) return cmp;
      const ta = a.time ?? "";
      const tb = b.time ?? "";
      if (ta !== tb) return ta.localeCompare(tb);
      return a.title.localeCompare(b.title, "es");
    });
  }, [deadlines]);

  function addDeadline() {
    const t = title.trim();
    if (!t || !date) return;
    const known = new Set(loadDeadlineTags().map((x) => x.id));
    const tagIds = formTagIds.filter((id) => known.has(id));
    const next: ImportantDeadline = {
      id: crypto.randomUUID(),
      title: t,
      date,
      time: time.trim() === "" ? null : time.trim(),
      courseId: courseId === "" ? null : courseId,
      tagIds,
      calendarColorId: normalizeGoogleEventColorId(formColorId),
      createdAt: new Date().toISOString(),
    };
    saveImportantDeadlines([...loadImportantDeadlines(), next]);
    setTitle("");
    setDate(todayYmd());
    setTime("");
    setCourseId("");
    setCourseChoiceTouched(false);
    setCourseSearch("");
    setCoursePickerOpen(false);
    setFormTagIds([]);
    setFormColorId("6");
  }

  function updateDeadlineCalendarColor(id: string, calendarColorId: string) {
    const c = normalizeGoogleEventColorId(calendarColorId);
    saveImportantDeadlines(
      loadImportantDeadlines().map((d) => (d.id === id ? { ...d, calendarColorId: c } : d)),
    );
  }

  function updateDeadlineTagIds(id: string, tagIds: string[]) {
    const known = new Set(loadDeadlineTags().map((x) => x.id));
    const cleaned = tagIds.filter((tid) => known.has(tid));
    saveImportantDeadlines(
      loadImportantDeadlines().map((d) => (d.id === id ? { ...d, tagIds: cleaned } : d)),
    );
  }

  function selectCourseFromPicker(id: string) {
    setCourseId(id);
    setCourseChoiceTouched(true);
    setCourseSearch("");
    setCoursePickerOpen(false);
  }

  const courseTriggerLabel = (() => {
    if (courseId) {
      const row = displayedCourses.find((c) => c.learnCourseId === courseId);
      if (row) return bbCourseDisplayLine(row);
      return "Asignatura eliminada";
    }
    if (courseChoiceTouched && courseId === "") return "Sin asignatura";
    return "Seleccionar asignatura";
  })();

  function removeDeadline(id: string) {
    saveImportantDeadlines(loadImportantDeadlines().filter((d) => d.id !== id));
    setEditingDeadline((cur) => (cur?.id === id ? null : cur));
  }

  function courseLabel(courseIdVal: string | null): string {
    if (!courseIdVal) return "Sin asignatura";
    const bb = displayedCourses.find((c) => c.learnCourseId === courseIdVal);
    if (bb) return bbCourseDisplayLine(bb);
    const manual = loadManualCourses().find((c) => c.id === courseIdVal);
    if (manual) return manual.short ? `${manual.name} (${manual.short})` : manual.name;
    return "Asignatura eliminada";
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 px-3 py-4 md:px-6 md:py-5">
      <header className="shrink-0 space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-[var(--ink)] md:text-2xl">
          Exámenes y fechas importantes
        </h1>
        <p className="max-w-2xl text-sm text-[var(--ink-muted)]">
          Añade manualmente exámenes, entregas y otros deadlines. Puedes usar{" "}
          <strong className="text-[var(--ink)]">etiquetas</strong> reutilizables para clasificar (examen,
          oral, entrega…). Cada uno puede ir asociado a una asignatura del panel{" "}
          <strong className="text-[var(--ink)]">Courses</strong>.
        </p>
      </header>

      <section className="shrink-0 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-[var(--ink)]">Nuevo deadline</h2>
        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
          <div className="min-w-0 flex-1 md:max-w-md">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Título
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej. Examen parcial, Entrega TPC…"
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--ink)] focus:outline-none"
            />
          </div>
          <div className="flex w-full flex-wrap gap-3 md:w-auto md:items-end">
            <div className="min-w-[10rem] flex-1 md:w-44 md:flex-initial">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                Fecha
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none"
              />
            </div>
            <div className="min-w-[9rem] flex-1 md:w-36 md:flex-initial">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                Hora <span className="font-normal normal-case text-[var(--ink-faint)]">(opcional)</span>
              </label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none"
              />
            </div>
          </div>
          <div className="relative w-full min-w-[12rem] md:max-w-md md:flex-1">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Asignatura
            </label>
            <div className="relative" ref={coursePickerRef}>
              <button
                type="button"
                onClick={() => setCoursePickerOpen((o) => !o)}
                aria-expanded={coursePickerOpen}
                aria-haspopup="listbox"
                className="flex w-full min-h-[2.5rem] items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-left text-sm text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:border-[var(--ink)] focus:outline-none"
              >
                <span className="min-w-0 flex-1 truncate">{courseTriggerLabel}</span>
                <ChevronDownMini
                  className={`h-4 w-4 shrink-0 opacity-70 transition ${coursePickerOpen ? "rotate-180" : ""}`}
                />
              </button>
              {coursePickerOpen ? (
                <div className="absolute left-0 right-0 z-50 mt-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-lg ring-1 ring-black/5">
                  <input
                    ref={courseSearchInputRef}
                    type="search"
                    value={courseSearch}
                    onChange={(e) => setCourseSearch(e.target.value)}
                    placeholder="Buscar asignatura…"
                    disabled={displayedCourses.length === 0}
                    autoComplete="off"
                    className="mb-2 w-full rounded-lg border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--ink)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Buscar asignatura"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div
                    className="max-h-40 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--canvas)] p-1"
                    role="listbox"
                    aria-label="Lista de asignaturas"
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={courseId === "" && courseChoiceTouched}
                      onClick={() => selectCourseFromPicker("")}
                      className={`flex w-full rounded-lg px-3 py-2 text-left text-sm transition hover:bg-[var(--surface-muted)] ${
                        courseId === "" && courseChoiceTouched
                          ? "bg-[var(--surface-muted)] font-semibold text-[var(--ink)]"
                          : "text-[var(--ink-muted)]"
                      }`}
                    >
                      Sin asignatura
                    </button>
                    {displayedCourses.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-[var(--ink-faint)]">
                        No hay cursos en la sección Courses. Conecta Blackboard en Assignments, carga
                        cursos y añádelos a tu lista en Courses.
                      </p>
                    ) : filteredCourses.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-[var(--ink-faint)]">
                        Ninguna asignatura coincide con la búsqueda.
                      </p>
                    ) : (
                      filteredCourses.map((c) => (
                        <button
                          key={c.learnCourseId}
                          type="button"
                          role="option"
                          aria-selected={courseId === c.learnCourseId}
                          onClick={() => selectCourseFromPicker(c.learnCourseId)}
                          className={`flex w-full rounded-lg px-3 py-2 text-left text-sm transition hover:bg-[var(--surface-muted)] ${
                            courseId === c.learnCourseId
                              ? "bg-[var(--surface-muted)] font-semibold text-[var(--ink)]"
                              : "text-[var(--ink)]"
                          }`}
                        >
                          {bbCourseDisplayLine(c)}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-3 flex w-full flex-col gap-3 sm:flex-row sm:items-end">
          <div className="relative min-w-0 w-full flex-1 sm:min-w-[12rem]">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Etiquetas
            </label>
            <DeadlineTagPicker
              selectedIds={formTagIds}
              onChange={setFormTagIds}
              allTags={tagRegistry}
            />
          </div>
          <div className="flex shrink-0 items-end gap-2 sm:justify-end">
            <div className="shrink-0">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                Color
              </label>
              <DeadlineCalendarColorCompact
                variant="square"
                value={formColorId}
                onChange={setFormColorId}
              />
            </div>
            <button
              type="button"
              onClick={addDeadline}
              disabled={!title.trim() || !date}
              title="Añadir deadline"
              aria-label="Añadir deadline"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--ink)] text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <IconPlus className="h-5 w-5" />
            </button>
          </div>
        </div>
        {displayedCourses.length === 0 ? (
          <p className="mt-3 text-xs text-[var(--ink-faint)]">
            Solo puedes asociar deadlines a cursos que aparezcan en la pestaña Courses. Si la lista
            está vacía, configura la caché de Blackboard y añade cursos allí primero.
          </p>
        ) : null}
      </section>

      <section className="min-h-0 flex-1 overflow-y-auto">
        <h2 className="mb-3 text-sm font-semibold text-[var(--ink)]">Tu lista</h2>
        {sorted.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--ink-faint)]">
            No hay fechas guardadas. Usa el formulario de arriba para añadir la primera.
          </p>
        ) : (
          <ul className="space-y-2">
            {sorted.map((d) => (
              <li
                key={d.id}
                className="flex min-w-0 items-stretch gap-2 rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 shadow-sm"
              >
                {/* Scroll solo en el contenido; si no, overflow recorta los desplegables (color) */}
                <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:thin]">
                  <div className="flex min-w-0 flex-nowrap items-center gap-x-2 gap-y-0 text-sm">
                    <span className="shrink-0 font-semibold text-[var(--ink)]">{d.title}</span>
                    <span className="shrink-0 text-[var(--ink-faint)]">·</span>
                    <span className="min-w-0 shrink truncate text-[var(--ink-muted)]">
                      {formatDateEs(d.date)}
                      {d.time ? (
                        <>
                          <span className="text-[var(--ink-faint)]"> · </span>
                          {formatTimeEs(d.time)}
                        </>
                      ) : null}
                      <span className="text-[var(--ink-faint)]"> · </span>
                      {courseLabel(d.courseId)}
                    </span>
                    <span className="shrink-0 text-[var(--ink-faint)]">·</span>
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                      Etiquetas
                    </span>
                    <div className="w-36 min-w-[9rem] shrink-0">
                      <DeadlineTagPicker
                        compact
                        selectedIds={d.tagIds}
                        onChange={(ids) => updateDeadlineTagIds(d.id, ids)}
                        allTags={tagRegistry}
                      />
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 self-center">
                  <DeadlineCalendarColorCompact
                    variant="square"
                    value={d.calendarColorId}
                    onChange={(c) => updateDeadlineCalendarColor(d.id, c)}
                  />
                  <button
                    type="button"
                    onClick={() => setEditingDeadline(d)}
                    className="shrink-0 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => removeDeadline(d.id)}
                    className="shrink-0 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50"
                  >
                    Eliminar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editingDeadline ? (
        <EditDeadlineDialog
          key={editingDeadline.id}
          deadline={editingDeadline}
          onClose={() => setEditingDeadline(null)}
          displayedCourses={displayedCourses}
          tagRegistry={tagRegistry}
        />
      ) : null}
    </div>
  );
}
