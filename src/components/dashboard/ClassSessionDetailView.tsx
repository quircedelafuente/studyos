"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getCompanionBaseUrl,
  setCompanionBaseUrl,
  transcribeWithCompanion,
} from "@/lib/class-notes-companion-client";
import {
  deleteSessionNotesEntry,
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
  const [busyStep, setBusyStep] = useState<"none" | "transcribing" | "generating">("none");
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const notesRef = useRef<HTMLDivElement>(null);
  const notesContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const on = () => setRevision((r) => r + 1);
    window.addEventListener(SESSION_NOTES_CHANGED_EVENT, on);
    return () => window.removeEventListener(SESSION_NOTES_CHANGED_EVENT, on);
  }, []);

  const saved = useMemo(
    () => getSessionNotesEntry(courseKey, sessionId),
    [courseKey, sessionId, revision],
  );

  const hasNotes = Boolean(saved?.markdown?.trim());

  // Pre-fill transcript from saved entry when navigating to this session
  useEffect(() => {
    const entry = getSessionNotesEntry(courseKey, sessionId);
    if (entry?.transcript) setTranscript(entry.transcript);
    else setTranscript("");
  }, [courseKey, sessionId]);

  const persistCompanionUrl = useCallback((url: string) => {
    setCompanionUrlState(url);
    setCompanionBaseUrl(url);
  }, []);

  function handleDelete() {
    if (!confirm("¿Borrar los apuntes generados para esta sesión?")) return;
    deleteSessionNotesEntry(courseKey, sessionId);
    setRevision((r) => r + 1);
  }

  function handleDownloadPdf() {
    const content = notesContentRef.current?.innerHTML;
    if (!content) return;
    const title = `${sessionLabel} — ${courseName}`;
    // Limpiar clases de Tailwind/CSS-vars del innerHTML para que el PDF sea legible
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${content}</div>`, "text/html");
    doc.querySelectorAll("[class]").forEach((el) => el.removeAttribute("class"));
    doc.querySelectorAll("[style]").forEach((el) => el.removeAttribute("style"));
    const cleanContent = doc.body.firstElementChild?.innerHTML ?? content;

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${title}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:820px;margin:40px auto;padding:0 28px;color:#111;line-height:1.7;font-size:15px}
  h1{font-size:1.6em;margin:1.4em 0 .5em;border-bottom:1px solid #e5e5e5;padding-bottom:.3em}
  h2{font-size:1.35em;margin:1.3em 0 .4em}
  h3{font-size:1.15em;margin:1.1em 0 .3em}
  h4{font-size:1em;margin:1em 0 .3em}
  p{margin:.6em 0}
  ul,ol{padding-left:1.5em;margin:.5em 0}
  li{margin:.25em 0}
  code{background:#f4f4f4;padding:2px 6px;border-radius:4px;font-size:.88em;font-family:monospace}
  pre{background:#f4f4f4;padding:.9em 1.1em;border-radius:6px;overflow-x:auto;margin:.8em 0}
  pre code{background:none;padding:0}
  blockquote{border-left:3px solid #ccc;margin:.8em 0;padding:.2em 1em;color:#555}
  strong{font-weight:600}
  table{border-collapse:collapse;width:100%;margin:.8em 0}
  td,th{border:1px solid #ddd;padding:7px 12px;text-align:left}
  th{background:#f8f8f8;font-weight:600}
  hr{border:none;border-top:1px solid #e5e5e5;margin:1.2em 0}
  a{color:#0066cc}
  @media print{body{margin:0;padding:16px}}
</style>
</head>
<body>
<h1 style="font-size:1.4em;border-bottom:2px solid #111;padding-bottom:.4em;margin-bottom:1em">${title}</h1>
${cleanContent}
</body>
</html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (win) {
      win.addEventListener("load", () => {
        win.print();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      });
    }
  }

  async function handleTranscribe() {
    if (!audioFile) { setError("Elige un archivo de audio."); return; }
    setError(null);
    setBusyTranscribe(true);
    try {
      const { text } = await transcribeWithCompanion(audioFile, companionUrl);
      setTranscript(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo transcribir. ¿Está el compañero en ejecución?");
    } finally {
      setBusyTranscribe(false);
    }
  }

  async function handleGenerate() {
    const manualTranscript = transcript.trim();
    const hasFiles = boardFiles.length > 0 || docFiles.length > 0;
    if (!audioFile && !manualTranscript && !hasFiles) {
      setError("Añade audio, texto en la transcripción, fotos o un PDF.");
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
          const msg = e instanceof Error ? e.message : "Error al transcribir el audio.";
          if (!manualTranscript && !hasFiles) {
            throw new Error(`${msg} Si WhisperX no está en marcha, inícialo o usa solo texto/fotos/PDF.`);
          }
          setWarn(`No se pudo transcribir el audio (${msg}). Se continúa con el texto que hubiera y con fotos/PDF.`);
        }
      }
      if (!finalTranscript.trim() && !hasFiles) {
        throw new Error("Sin transcripción ni archivos para generar apuntes.");
      }
      setBusyStep("generating");
      const form = new FormData();
      form.set("courseKey", courseKey);
      form.set("sessionId", sessionId);
      form.set("sessionLabel", sessionLabel);
      if (finalTranscript.trim()) form.set("transcript", finalTranscript);
      for (const f of boardFiles) form.append("board", f);
      for (const f of docFiles) form.append("document", f);
      const res = await fetch("/api/class-notes/generate", { method: "POST", body: form, credentials: "include" });
      const data = (await res.json().catch(() => ({}))) as { markdown?: string; error?: string; detail?: string; meta?: { hadAudio?: boolean; photoCount?: number; hadDocs?: boolean } };
      if (!res.ok) throw new Error(data.detail ?? data.error ?? `Error ${res.status}`);
      const md = data.markdown?.trim();
      if (!md) throw new Error("Respuesta sin apuntes");
      const generatedAt = new Date().toISOString();
      const sourceSummary: SessionNotesSourceSummary = {
        hadAudio: data.meta?.hadAudio ?? (usedCompanionAudio || finalTranscript.trim().length > 0),
        photoCount: data.meta?.photoCount ?? boardFiles.length,
        hadDocs: data.meta?.hadDocs ?? docFiles.length > 0,
      };
      upsertSessionNotesEntry(courseKey, sessionId, {
        markdown: md,
        generatedAt,
        sourceSummary,
        transcript: finalTranscript.trim() || undefined,
      });
      setRevision((r) => r + 1);
      setTimeout(() => notesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al generar");
    } finally {
      setBusyStep("none");
    }
  }

  return (
    <>
      {/* Modal expandido */}
      {expanded && saved?.markdown ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-[var(--canvas)]">
          <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-[var(--ink)]">{sessionLabel}</p>
              <p className="truncate text-xs text-[var(--ink-muted)]">{courseName}</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={handleDownloadPdf}
                className="min-h-[36px] rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--surface-muted)]">
                Descargar PDF
              </button>
              <button type="button" onClick={() => setExpanded(false)}
                className="min-h-[36px] rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--surface-muted)]">
                ✕ Cerrar
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <div ref={notesContentRef}>
              <MarkdownMathContent content={saved.markdown} />
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onBack}
            className="min-h-[44px] rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-muted)]">
            ← Volver
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-black text-[var(--ink)]">{sessionLabel || "Sesión"}</h2>
            <p className="truncate text-xs text-[var(--ink-muted)]">{courseName}</p>
          </div>
        </div>

        {!allowGenerate ? (
          /* Vista móvil */
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            {hasNotes ? (
              <>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--canvas)] p-3">
                  <MarkdownMathContent content={saved!.markdown} />
                </div>
                {saved!.generatedAt ? (
                  <p className="mt-2 text-xs text-[var(--ink-faint)]">
                    Generados: {new Date(saved!.generatedAt).toLocaleString("es", { dateStyle: "short", timeStyle: "short" })}
                  </p>
                ) : null}
                {saved!.transcript ? (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => setTranscriptOpen((o) => !o)}
                      className="flex w-full items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-left text-xs font-semibold text-[var(--ink-muted)] hover:bg-[var(--surface-muted)]"
                    >
                      <span>{transcriptOpen ? "▼" : "▶"}</span>
                      <span>Transcripción del audio</span>
                    </button>
                    {transcriptOpen ? (
                      <pre className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap rounded-xl border border-[var(--border)] bg-[var(--canvas)] p-3 font-sans text-xs text-[var(--ink)]">
                        {saved!.transcript}
                      </pre>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-[var(--ink-muted)]">Todavía no hay apuntes generados para esta sesión.</p>
            )}
          </section>
        ) : (
          <>
            {error ? (
              <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">{error}</p>
            ) : null}
            {warn ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">{warn}</p>
            ) : null}

            {hasNotes ? (
              /* Apuntes existentes: mostrar con acciones */
              <section ref={notesRef} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-[var(--ink)]">Apuntes generados</h3>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setExpanded(true)}
                      className="min-h-[36px] rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--surface-muted)]">
                      ⤢ Expandir
                    </button>
                    <button type="button" onClick={handleDownloadPdf}
                      className="min-h-[36px] rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--surface-muted)]">
                      ↓ Descargar PDF
                    </button>
                    <button type="button" onClick={handleDelete}
                      className="min-h-[36px] rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                      Borrar apuntes
                    </button>
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--canvas)] p-3">
                  <div ref={notesContentRef}>
                    <MarkdownMathContent content={saved!.markdown} />
                  </div>
                </div>
                {saved!.generatedAt ? (
                  <p className="mt-2 text-xs text-[var(--ink-faint)]">
                    Generados: {new Date(saved!.generatedAt).toLocaleString("es", { dateStyle: "short", timeStyle: "short" })}
                  </p>
                ) : null}
                {saved!.transcript ? (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => setTranscriptOpen((o) => !o)}
                      className="flex w-full items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-left text-xs font-semibold text-[var(--ink-muted)] hover:bg-[var(--surface-muted)]"
                    >
                      <span>{transcriptOpen ? "▼" : "▶"}</span>
                      <span>Transcripción del audio</span>
                    </button>
                    {transcriptOpen ? (
                      <pre className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-xl border border-[var(--border)] bg-[var(--canvas)] p-3 font-sans text-xs text-[var(--ink)]">
                        {saved!.transcript}
                      </pre>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : (
              /* Sin apuntes: panel de generación */
              <section className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <h3 className="text-sm font-bold text-[var(--ink)]">Generar apuntes</h3>

                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-[var(--ink-muted)]">URL del compañero local (WhisperX)</label>
                  <input type="url" value={companionUrl} onChange={(e) => persistCompanionUrl(e.target.value)}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--ink)]"
                    placeholder="http://127.0.0.1:16789" />
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-[var(--ink-muted)]">Clase en audio</label>
                  <input type="file" accept="audio/*" className="max-w-full text-sm text-[var(--ink)]"
                    onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)} />
                  <button type="button" disabled={busyTranscribe || busyStep !== "none" || !audioFile}
                    onClick={() => void handleTranscribe()}
                    className="min-h-[44px] rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--ink)] enabled:hover:bg-[var(--surface-muted)] disabled:opacity-45">
                    {busyTranscribe ? "Transcribiendo…" : "Solo transcribir (vista previa)"}
                  </button>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-[var(--ink-muted)]">Transcripción (editable)</label>
                  <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={6}
                    className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--ink)]"
                    placeholder="Opcional: pega texto o déjalo vacío si solo usas audio/fotos/PDF." />
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-[var(--ink-muted)]">Fotos de pizarra</label>
                  <input type="file" accept="image/*" multiple className="max-w-full text-sm text-[var(--ink)]"
                    onChange={(e) => setBoardFiles(e.target.files ? Array.from(e.target.files) : [])} />
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-[var(--ink-muted)]">Apuntes / PDF</label>
                  <input type="file" accept=".pdf,application/pdf" multiple className="max-w-full text-sm text-[var(--ink)]"
                    onChange={(e) => setDocFiles(e.target.files ? Array.from(e.target.files) : [])} />
                </div>

                <button type="button" disabled={busyStep !== "none"} onClick={() => void handleGenerate()}
                  className="min-h-[48px] w-full rounded-xl bg-[var(--ink)] px-4 py-3 text-sm font-bold text-white disabled:opacity-45">
                  {busyStep === "transcribing" ? "Transcribiendo audio…" : busyStep === "generating" ? "Generando apuntes (OpenRouter)…" : "Generar apuntes con IA"}
                </button>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}
