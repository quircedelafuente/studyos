"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getCompanionBaseUrl,
  setCompanionBaseUrl,
  transcribeWithCompanion,
} from "@/lib/class-notes-companion-client";
import {
  getSessionNotesEntry,
  SESSION_NOTES_CHANGED_EVENT,
  upsertSessionNotesEntry,
  type SessionNotesSourceSummary,
} from "@/lib/session-notes-storage";
import { MarkdownMathContent } from "./MarkdownMathContent";

export type ClassSessionDetailProps = {
  courseKey: string;
  sessionId: string;
  sessionLabel: string;
  courseName: string;
  /** Escritorio: muestra fuentes y botón generar. Móvil/tablet: solo lectura y vuelta. */
  allowGenerate: boolean;
  onBack: () => void;
};

export function ClassSessionDetailView({
  courseKey,
  sessionId,
  sessionLabel,
  courseName,
  allowGenerate,
  onBack,
}: ClassSessionDetailProps) {
  const [revision, setRevision] = useState(0);
  const [companionUrl, setCompanionUrlState] = useState(getCompanionBaseUrl);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [transcript, setTranscript] = useState("");
  const [boardFiles, setBoardFiles] = useState<File[]>([]);
  const [docFiles, setDocFiles] = useState<File[]>([]);
  const [busyTranscribe, setBusyTranscribe] = useState(false);
  /** Flujo unificado: transcribe (compañero) → generate (OpenRouter) */
  const [busyStep, setBusyStep] = useState<"none" | "transcribing" | "generating">("none");
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);

  useEffect(() => {
    const on = () => setRevision((r) => r + 1);
    window.addEventListener(SESSION_NOTES_CHANGED_EVENT, on);
    return () => window.removeEventListener(SESSION_NOTES_CHANGED_EVENT, on);
  }, []);

  const saved = useMemo(
    () => getSessionNotesEntry(courseKey, sessionId),
    [courseKey, sessionId, revision],
  );

  const persistCompanionUrl = useCallback((url: string) => {
    setCompanionUrlState(url);
    setCompanionBaseUrl(url);
  }, []);

  async function handleTranscribe() {
    if (!audioFile) {
      setError("Elige un archivo de audio.");
      return;
    }
    setError(null);
    setBusyTranscribe(true);
    try {
      const { text } = await transcribeWithCompanion(audioFile, companionUrl);
      setTranscript(text);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "No se pudo transcribir. ¿Está el compañero en ejecución?",
      );
    } finally {
      setBusyTranscribe(false);
    }
  }

  async function handleGenerate() {
    const manualTranscript = transcript.trim();
    const hasFiles = boardFiles.length > 0 || docFiles.length > 0;
    if (!audioFile && !manualTranscript && !hasFiles) {
      setError(
        "Añade audio (se transcribirá solo al generar), texto en la transcripción, fotos o un PDF.",
      );
      return;
    }
    setError(null);
    setWarn(null);

    let finalTranscript = manualTranscript;
    let usedCompanionAudio = false;

    setBusyStep("transcribing");
    try {
      if (audioFile) {
        try {
          const { text } = await transcribeWithCompanion(audioFile, companionUrl);
          usedCompanionAudio = true;
          finalTranscript = manualTranscript
            ? `${manualTranscript}\n\n---\n\n## Transcripción automática del audio\n\n${text}`
            : text;
          setTranscript(finalTranscript);
        } catch (e) {
          const msg =
            e instanceof Error ? e.message : "Error al transcribir el audio.";
          if (!manualTranscript && !hasFiles) {
            throw new Error(
              `${msg} Si el compañero (WhisperX) no está en marcha, inícialo o quita el audio y usa solo texto/fotos/PDF.`,
            );
          }
          setWarn(
            `No se pudo transcribir el audio (${msg}). Se continúa con el texto que hubiera y con fotos/PDF.`,
          );
        }
      }

      if (!finalTranscript.trim() && !hasFiles) {
        throw new Error(
          "Sin transcripción ni archivos visuales/documentos para generar apuntes.",
        );
      }

      setBusyStep("generating");
      const form = new FormData();
      form.set("courseKey", courseKey);
      form.set("sessionId", sessionId);
      form.set("sessionLabel", sessionLabel);
      if (finalTranscript.trim()) form.set("transcript", finalTranscript);
      for (const f of boardFiles) form.append("board", f);
      for (const f of docFiles) form.append("document", f);

      const res = await fetch("/api/class-notes/generate", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      const data = (await res.json().catch(() => ({}))) as {
        markdown?: string;
        error?: string;
        detail?: string;
        meta?: {
          hadAudio?: boolean;
          photoCount?: number;
          hadDocs?: boolean;
        };
      };
      if (!res.ok) {
        throw new Error(
          data.detail ?? data.error ?? `Error ${res.status}`,
        );
      }
      const md = data.markdown?.trim();
      if (!md) throw new Error("Respuesta sin apuntes");

      const generatedAt = new Date().toISOString();
      const sourceSummary: SessionNotesSourceSummary = {
        hadAudio:
          data.meta?.hadAudio ??
          (usedCompanionAudio || finalTranscript.trim().length > 0),
        photoCount: data.meta?.photoCount ?? boardFiles.length,
        hadDocs: data.meta?.hadDocs ?? docFiles.length > 0,
      };
      upsertSessionNotesEntry(courseKey, sessionId, {
        markdown: md,
        generatedAt,
        sourceSummary,
      });
      setRevision((r) => r + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al generar");
    } finally {
      setBusyStep("none");
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[44px] rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-muted)]"
        >
          ← Volver
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-black text-[var(--ink)]">
            {sessionLabel || "Sesión"}
          </h2>
          <p className="truncate text-xs text-[var(--ink-muted)]">{courseName}</p>
        </div>
      </div>

      {!allowGenerate ? (
        /* Vista móvil: solo apuntes, sin UI de generación */
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          {saved?.markdown?.trim() ? (
            <>
              <div className="max-h-[min(70vh,40rem)] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--canvas)] p-3">
                <MarkdownMathContent content={saved.markdown} />
              </div>
              {saved.generatedAt ? (
                <p className="mt-2 text-xs text-[var(--ink-faint)]">
                  Generados:{" "}
                  {new Date(saved.generatedAt).toLocaleString("es", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-[var(--ink-muted)]">
              Todavía no hay apuntes generados para esta sesión.
            </p>
          )}
        </section>
      ) : (
        <>
          {error ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </p>
          ) : null}
          {warn ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">
              {warn}
            </p>
          ) : null}

          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <h3 className="text-sm font-bold text-[var(--ink)]">Apuntes guardados</h3>
            {saved?.markdown?.trim() ? (
              <div className="mt-3 max-h-[min(50vh,28rem)] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--canvas)] p-3">
                <MarkdownMathContent content={saved.markdown} />
              </div>
            ) : (
              <p className="mt-2 text-sm text-[var(--ink-muted)]">
                Aún no hay apuntes para esta sesión.
              </p>
            )}
            {saved?.generatedAt ? (
              <p className="mt-2 text-xs text-[var(--ink-faint)]">
                Generados:{" "}
                {new Date(saved.generatedAt).toLocaleString("es", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </p>
            ) : null}
          </section>
        </>
      )}

      {allowGenerate ? (
        <section className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="text-sm font-bold text-[var(--ink)]">Fuentes para generar</h3>
          <p className="text-xs text-[var(--ink-muted)]">
            Con <strong>Generar apuntes con IA</strong> ocurre esto en orden: si hay
            audio, se envía primero al compañero local (WhisperX o el stub); con
            esa transcripción, las fotos y los PDF, OpenRouter redacta los apuntes.
          </p>

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-[var(--ink-muted)]">
              URL del compañero local (transcripción)
            </label>
            <input
              type="url"
              value={companionUrl}
              onChange={(e) => persistCompanionUrl(e.target.value)}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--ink)]"
              placeholder="http://127.0.0.1:16789"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-[var(--ink-muted)]">
              Clase en audio
            </label>
            <input
              type="file"
              accept="audio/*"
              className="max-w-full text-sm text-[var(--ink)]"
              onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              disabled={busyTranscribe || busyStep !== "none" || !audioFile}
              onClick={() => void handleTranscribe()}
              className="min-h-[44px] rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--ink)] enabled:hover:bg-[var(--surface-muted)] disabled:opacity-45"
            >
              {busyTranscribe ? "Transcribiendo…" : "Solo transcribir (vista previa)"}
            </button>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-[var(--ink-muted)]">
              Transcripción (editable; puedes pegar texto sin usar audio)
            </label>
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              rows={6}
              className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--ink)]"
              placeholder="Opcional: texto previo. Al generar, si hay audio se añadirá la transcripción automática debajo (o solo esa si este campo está vacío)."
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-[var(--ink-muted)]">
              Fotos de pizarra (varias)
            </label>
            <input
              type="file"
              accept="image/*"
              multiple
              className="max-w-full text-sm text-[var(--ink)]"
              onChange={(e) => {
                const list = e.target.files ? Array.from(e.target.files) : [];
                setBoardFiles(list);
              }}
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-[var(--ink-muted)]">
              Apuntes / PDF
            </label>
            <input
              type="file"
              accept=".pdf,application/pdf"
              multiple
              className="max-w-full text-sm text-[var(--ink)]"
              onChange={(e) => {
                const list = e.target.files ? Array.from(e.target.files) : [];
                setDocFiles(list);
              }}
            />
          </div>

          <button
            type="button"
            disabled={busyStep !== "none"}
            onClick={() => void handleGenerate()}
            className="min-h-[48px] w-full rounded-xl bg-[var(--ink)] px-4 py-3 text-sm font-bold text-white disabled:opacity-45"
          >
            {busyStep === "transcribing"
              ? "Transcribiendo audio (compañero local)…"
              : busyStep === "generating"
                ? "Generando apuntes (OpenRouter)…"
                : "Generar apuntes con IA"}
          </button>
        </section>
      ) : null}
    </div>
  );
}
