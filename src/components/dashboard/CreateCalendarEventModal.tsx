"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  GOOGLE_CALENDAR_EVENT_COLOR_IDS,
  GOOGLE_EVENT_COLOR_LABELS,
  getGoogleEventColorStyle,
} from "@/lib/google-calendar-event-colors";
import { datetimeLocalToRfc3339WithOffset } from "@/lib/calendar-datetime-offset";

type CalendarListItem = {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: string;
};

function isWritableCalendar(c: CalendarListItem): boolean {
  if (c.primary) return true;
  const r = c.accessRole;
  if (!r) return true;
  return r === "owner" || r === "writer";
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** `YYYY-MM-DDTHH:mm` en hora local. */
function toDatetimeLocalValue(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function addMinutesToDatetimeLocal(dtLocal: string, minutes: number): string {
  const [datePart, timePart] = dtLocal.split("T");
  if (!datePart || !timePart) return dtLocal;
  const [y, mo, da] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.slice(0, 5).split(":").map(Number);
  const start = new Date(y!, mo! - 1, da!, hh!, mm!, 0, 0);
  start.setMinutes(start.getMinutes() + minutes);
  return `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}T${pad2(start.getHours())}:${pad2(start.getMinutes())}`;
}

/** Mensaje claro cuando Google devuelve 403 / insufficient permissions. */
function explainGoogleCalendarWriteError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("insufficient") || m.includes("insufficientpermission")) {
    return [
      "Google no permite crear el evento con los permisos de esta sesión (suele pasar si iniciaste sesión cuando la app solo podía leer el calendario).",
      "",
      "Solución:",
      "• Entra en https://myaccount.google.com/permissions y quita el acceso de esta app a tu cuenta.",
      "• En IEStudio, cierra sesión y vuelve a entrar con Google; acepta el acceso al calendario cuando te lo pida.",
      "• En Google Cloud Console, en tu proyecto: activa la API «Google Calendar» y revisa que la pantalla de consentimiento OAuth incluya el alcance del calendario.",
    ].join("\n");
  }
  return message;
}

const DURATION_PRESETS: { min: number; label: string }[] = [
  { min: 15, label: "15 minutos" },
  { min: 30, label: "30 minutos" },
  { min: 45, label: "45 minutos" },
  { min: 60, label: "1 hora" },
  { min: 90, label: "1 h 30 min" },
  { min: 120, label: "2 horas" },
  { min: 180, label: "3 horas" },
  { min: 240, label: "4 horas" },
  { min: 480, label: "8 horas (jornada)" },
];

type CreateCalendarEventModalProps = {
  open: boolean;
  onClose: () => void;
  /** Tras crear con éxito (para recargar eventos). */
  onCreated: () => void;
};

export function CreateCalendarEventModal({
  open,
  onClose,
  onCreated,
}: CreateCalendarEventModalProps) {
  const [calendars, setCalendars] = useState<CalendarListItem[]>([]);
  const [calLoading, setCalLoading] = useState(false);
  const [calendarId, setCalendarId] = useState("primary");

  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startLocal, setStartLocal] = useState(() =>
    toDatetimeLocalValue(new Date()),
  );
  const [durationMode, setDurationMode] = useState<"preset" | "until">(
    "preset",
  );
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [endLocal, setEndLocal] = useState(() =>
    addMinutesToDatetimeLocal(toDatetimeLocalValue(new Date()), 60),
  );
  /** Paleta Google Calendar 1…11 */
  const [eventColorId, setEventColorId] = useState("6");

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const writableCalendars = useMemo(
    () => calendars.filter(isWritableCalendar),
    [calendars],
  );

  const loadCalendars = useCallback(async () => {
    setCalLoading(true);
    try {
      const res = await fetch("/api/calendar/sources", { credentials: "include" });
      const data = (await res.json()) as {
        calendars?: CalendarListItem[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "No se pudieron cargar los calendarios");
      const list = data.calendars ?? [];
      setCalendars(list);
      const primary = list.find((c) => c.primary);
      setCalendarId(primary?.id ?? list[0]?.id ?? "primary");
    } catch {
      setCalendars([]);
      setCalendarId("primary");
    } finally {
      setCalLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setDurationMode("preset");
    setDurationMinutes(60);
    setEventColorId("6");
    void loadCalendars();
    const now = new Date();
    const start = toDatetimeLocalValue(now);
    setStartLocal(start);
    setEndLocal(addMinutesToDatetimeLocal(start, 60));
  }, [open, loadCalendars]);

  useEffect(() => {
    if (durationMode === "preset") {
      setEndLocal((prev) => addMinutesToDatetimeLocal(startLocal, durationMinutes));
    }
  }, [startLocal, durationMinutes, durationMode]);

  function validateClient(): string | null {
    if (!summary.trim()) return "Escribe un título para el evento.";
    const endStr =
      durationMode === "preset"
        ? addMinutesToDatetimeLocal(startLocal, durationMinutes)
        : endLocal;
    try {
      const startMs = Date.parse(datetimeLocalToRfc3339WithOffset(startLocal));
      const endMs = Date.parse(datetimeLocalToRfc3339WithOffset(endStr));
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
        return "Revisa las fechas y horas.";
      }
      if (endMs <= startMs) {
        return "La hora de fin debe ser posterior al inicio.";
      }
    } catch {
      return "Revisa las fechas y horas.";
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validateClient();
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    setSubmitting(true);
    const endStr =
      durationMode === "preset"
        ? addMinutesToDatetimeLocal(startLocal, durationMinutes)
        : endLocal;
    let startRfc: string;
    let endRfc: string;
    try {
      startRfc = datetimeLocalToRfc3339WithOffset(startLocal);
      endRfc = datetimeLocalToRfc3339WithOffset(endStr);
    } catch {
      setFormError("Revisa las fechas y horas.");
      setSubmitting(false);
      return;
    }
    try {
      const res = await fetch("/api/calendar/events", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          calendarId,
          summary: summary.trim(),
          description: description.trim() || undefined,
          location: location.trim() || undefined,
          startDateTime: startRfc,
          endDateTime: endRfc,
          colorId: eventColorId,
        }),
      });
      const raw = await res.text();
      let data: { error?: string; detail?: string; event?: unknown } = {};
      if (raw) {
        try {
          data = JSON.parse(raw) as typeof data;
        } catch {
          setFormError(
            `Error del servidor (${res.status}). Comprueba la consola del terminal o que AUTH_URL coincida con la URL del navegador.`,
          );
          return;
        }
      }
      if (!res.ok) {
        throw new Error(
          data.detail ?? data.error ?? `No se pudo crear el evento (${res.status})`,
        );
      }
      setSummary("");
      setDescription("");
      setLocation("");
      onCreated();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error de red";
      setFormError(explainGoogleCalendarWriteError(msg));
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center">
      <button
        type="button"
        aria-label="Cerrar"
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-event-title"
        className="relative z-10 flex max-h-[min(90vh,40rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xl"
      >
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h2
            id="create-event-title"
            className="text-lg font-bold text-[var(--ink)]"
          >
            Nuevo evento
          </h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            Se guarda en Google Calendar. Si ves «Insufficient Permission», tu sesión
            no tiene permiso de escritura: revoca la app en tu cuenta de Google,
            cierra sesión aquí y vuelve a entrar para aceptar el nuevo acceso al
            calendario.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        >
          <div className="space-y-4 px-5 py-4">
            {formError ? (
              <p className="whitespace-pre-line rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm leading-relaxed text-red-800">
                {formError}
              </p>
            ) : null}

            <div>
              <label
                htmlFor="evt-cal"
                className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]"
              >
                Calendario
              </label>
              <select
                id="evt-cal"
                value={calendarId}
                onChange={(e) => setCalendarId(e.target.value)}
                disabled={calLoading || writableCalendars.length === 0}
                className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--ink-muted)]"
              >
                {writableCalendars.length === 0 ? (
                  <option value="primary">Principal (primary)</option>
                ) : (
                  writableCalendars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.summary}
                      {c.primary ? " (principal)" : ""}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label
                htmlFor="evt-title"
                className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]"
              >
                Título
              </label>
              <input
                id="evt-title"
                type="text"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                required
                maxLength={500}
                placeholder="Reunión, examen, entrega…"
                className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--ink-muted)]"
              />
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                Color del evento
              </p>
              <div
                className="mt-2 flex flex-wrap gap-2"
                role="listbox"
                aria-label="Color del evento en Google Calendar"
              >
                {GOOGLE_CALENDAR_EVENT_COLOR_IDS.map((id) => {
                  const c = getGoogleEventColorStyle(id);
                  const selected = eventColorId === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      title={GOOGLE_EVENT_COLOR_LABELS[id] ?? `Color ${id}`}
                      onClick={() => setEventColorId(id)}
                      className={`h-9 w-9 shrink-0 rounded-full border-2 border-white shadow-sm transition ${
                        selected
                          ? "ring-2 ring-[var(--ink)] ring-offset-2 ring-offset-[var(--surface)]"
                          : "hover:opacity-90"
                      }`}
                      style={{ backgroundColor: c.borderLeft }}
                    />
                  );
                })}
              </div>
            </div>

            <div>
              <label
                htmlFor="evt-desc"
                className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]"
              >
                Descripción (opcional)
              </label>
              <textarea
                id="evt-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={8000}
                placeholder="Detalles, enlaces, notas…"
                className="mt-1 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--ink-muted)]"
              />
            </div>

            <div>
              <label
                htmlFor="evt-loc"
                className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]"
              >
                Ubicación (opcional)
              </label>
              <input
                id="evt-loc"
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                maxLength={500}
                placeholder="Aula, enlace Meet, dirección…"
                className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--ink-muted)]"
              />
            </div>

            <div>
              <label
                htmlFor="evt-start"
                className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]"
              >
                Inicio
              </label>
              <input
                id="evt-start"
                type="datetime-local"
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
                required
                className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--ink-muted)]"
              />
            </div>

            <fieldset className="space-y-2">
              <legend className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                Duración
              </legend>
              <div className="flex flex-wrap gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="dur"
                    checked={durationMode === "preset"}
                    onChange={() => setDurationMode("preset")}
                    className="accent-[var(--ink)]"
                  />
                  Preset
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="dur"
                    checked={durationMode === "until"}
                    onChange={() => {
                      setDurationMode("until");
                      setEndLocal(
                        addMinutesToDatetimeLocal(
                          startLocal,
                          durationMinutes,
                        ),
                      );
                    }}
                    className="accent-[var(--ink)]"
                  />
                  Hasta fecha y hora
                </label>
              </div>
              {durationMode === "preset" ? (
                <select
                  value={durationMinutes}
                  onChange={(e) =>
                    setDurationMinutes(Number(e.target.value))
                  }
                  className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--ink-muted)]"
                >
                  {DURATION_PRESETS.map((p) => (
                    <option key={p.min} value={p.min}>
                      {p.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="datetime-local"
                  value={endLocal}
                  onChange={(e) => setEndLocal(e.target.value)}
                  required={durationMode === "until"}
                  className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--ink-muted)]"
                />
              )}
            </fieldset>
          </div>

          <div className="mt-auto flex justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "Creando…" : "Crear evento"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
