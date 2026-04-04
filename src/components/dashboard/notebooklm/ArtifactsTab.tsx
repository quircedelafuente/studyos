"use client";

import { useCallback, useEffect, useState } from "react";
import { MarkdownMathContent } from "@/components/dashboard/MarkdownMathContent";
import { apiJson, NotebookApiError } from "./api-client";

type Artifact = {
  id: string;
  title: string;
  kind: string | null;
  status: string;
  created_at: string | null;
};

type Props = { notebookId: string };
type SourceItem = { id: string; title: string | null; status: string };

type PreviewState = {
  artifactId: string;
  title: string;
  kind: string | null;
  url: string;
  mime: string;
  parsedQuiz: ParsedQuiz | null;
  parsedFlashcards: ParsedFlashcards | null;
} | null;

type ParsedQuizOption = {
  text?: string;
  isCorrect?: boolean;
  rationale?: string;
};

type ParsedQuizQuestion = {
  question?: string;
  answerOptions?: ParsedQuizOption[];
  hint?: string;
};

type ParsedQuiz = {
  title?: string;
  questions?: ParsedQuizQuestion[];
};

type ParsedFlashcard = {
  front?: string;
  back?: string;
};

type ParsedFlashcards = {
  title?: string;
  cards?: ParsedFlashcard[];
};

type FlashcardMark = "known" | "unknown";

type QuizAttempt = {
  at: string;
  score: number;
  total: number;
  elapsedMs: number;
};

type QuizSessionState = {
  answers: Record<number, number>;
  startedAt: number;
  currentIndex: number;
  graded: Record<number, boolean>;
};

function shuffleArray<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

function buildShuffledQuizQuestions(quiz: ParsedQuiz | null): ParsedQuizQuestion[] {
  if (!quiz?.questions) return [];
  return quiz.questions.map((q) => ({
    ...q,
    answerOptions: shuffleArray(q.answerOptions ?? []),
  }));
}

const ARTIFACT_TYPES = [
  { value: "audio", label: "Audio Overview" },
  { value: "report", label: "Report" },
  { value: "study_guide", label: "Study Guide" },
  { value: "quiz", label: "Quiz" },
  { value: "flashcards", label: "Flashcards" },
  { value: "mind_map", label: "Mind Map" },
] as const;

function artifactIcon(kind: string | null): string {
  switch (kind) {
    case "quiz":
      return "📝";
    case "video":
      return "🎬";
    case "audio":
      return "🎧";
    case "report":
      return "📄";
    case "flashcards":
      return "🗂️";
    case "mind_map":
      return "🧠";
    case "study_guide":
      return "📚";
    case "slide_deck":
      return "📊";
    case "data_table":
      return "📈";
    case "infographic":
      return "🖼️";
    default:
      return "📎";
  }
}

export function ArtifactsTab({ notebookId }: Props) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedType, setSelectedType] = useState("audio");
  const [instructions, setInstructions] = useState("");
  const [preview, setPreview] = useState<PreviewState>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [quizSession, setQuizSession] = useState<QuizSessionState | null>(null);
  const [quizAttempts, setQuizAttempts] = useState<QuizAttempt[]>([]);
  const [quizQuestions, setQuizQuestions] = useState<ParsedQuizQuestion[]>([]);
  const [flashcardIndex, setFlashcardIndex] = useState(0);
  const [flashcardFlipped, setFlashcardFlipped] = useState(false);
  const [flashcardMarks, setFlashcardMarks] = useState<Record<number, FlashcardMark>>({});
  const [flashcardMode, setFlashcardMode] = useState<"all" | "unknown">("all");
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);

  const quizStatsKey = preview
    ? `iestudio-quiz-attempts-${notebookId}-${preview.artifactId}`
    : null;

  // Cleanup ObjectURL on unmount / preview replacement.
  useEffect(() => {
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  const fetchArtifacts = useCallback(async () => {
    setLoading(true);
    setArtifactError(null);
    try {
      const data = await apiJson<Artifact[]>(
        `/api/notebooklm/notebooks/${notebookId}/artifacts`,
      );
      setArtifacts(data);
    } catch (err) {
      setArtifactError(
        err instanceof NotebookApiError
          ? err.detail
          : "No se pudieron cargar los artefactos.",
      );
    } finally {
      setLoading(false);
    }
  }, [notebookId]);

  useEffect(() => {
    fetchArtifacts();
  }, [fetchArtifacts]);

  useEffect(() => {
    void (async () => {
      setSourcesLoading(true);
      try {
        const data = await apiJson<SourceItem[]>(
          `/api/notebooklm/notebooks/${notebookId}/sources`,
        );
        const ready = data.filter((s) => s.status === "ready");
        setSources(ready);
        setSelectedSourceIds((prev) =>
          prev.length > 0 ? prev.filter((id) => ready.some((s) => s.id === id)) : ready.map((s) => s.id),
        );
      } catch {
        setSources([]);
      } finally {
        setSourcesLoading(false);
      }
    })();
  }, [notebookId]);

  // Poll for in-progress artifacts
  useEffect(() => {
    const pending = artifacts.some(
      (a) => a.status === "in_progress" || a.status === "pending",
    );
    if (!pending) return;

    const interval = setInterval(fetchArtifacts, 5000);
    return () => clearInterval(interval);
  }, [artifacts, fetchArtifacts]);

  async function generate() {
    setGenerating(true);
    setArtifactError(null);
    try {
      await apiJson(
        `/api/notebooklm/notebooks/${notebookId}/artifacts/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            artifact_type: selectedType,
            instructions: instructions.trim() || null,
            source_ids: selectedSourceIds.length > 0 ? selectedSourceIds : null,
          }),
        },
      );
      setInstructions("");
      await fetchArtifacts();
    } catch (err) {
      setArtifactError(
        err instanceof NotebookApiError
          ? err.detail
          : "No se pudo generar el artefacto.",
      );
    } finally {
      setGenerating(false);
    }
  }

  async function downloadArtifact(artifactId: string, title: string) {
    setArtifactError(null);
    const res = await fetch(
      `/api/notebooklm/notebooks/${notebookId}/artifacts/${artifactId}/download`,
    );
    if (!res.ok) {
      try {
        const data = await res.json();
        setArtifactError(String(data?.detail ?? data?.error ?? "Error descargando artefacto."));
      } catch {
        setArtifactError("Error descargando artefacto.");
      }
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = title;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function previewArtifact(artifact: Artifact) {
    setPreviewError(null);
    setPreviewingId(artifact.id);
    try {
      const res = await fetch(
        `/api/notebooklm/notebooks/${notebookId}/artifacts/${artifact.id}/download`,
      );
      if (!res.ok) {
        let detail = "";
        try {
          const data = await res.json();
          detail = data?.detail || data?.error || "";
        } catch {
          // Ignore parse errors; keep generic message.
        }
        setPreviewError(
          detail
            ? `No se pudo cargar la vista previa: ${detail}`
            : "No se pudo cargar la vista previa.",
        );
        return;
      }
      const blob = await res.blob();
      const mime = res.headers.get("content-type") ?? blob.type ?? "";
      const url = URL.createObjectURL(blob);
      let parsedQuiz: ParsedQuiz | null = null;
      let parsedFlashcards: ParsedFlashcards | null = null;
      if (artifact.kind === "quiz") {
        try {
          parsedQuiz = (await blob.text()
            .then((txt) => JSON.parse(txt))
            .catch(() => null)) as ParsedQuiz | null;
        } catch {
          parsedQuiz = null;
        }
      } else if (artifact.kind === "flashcards") {
        try {
          parsedFlashcards = (await blob.text()
            .then((txt) => JSON.parse(txt))
            .catch(() => null)) as ParsedFlashcards | null;
        } catch {
          parsedFlashcards = null;
        }
      }
      setPreview((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return {
          artifactId: artifact.id,
          title: artifact.title,
          kind: artifact.kind,
          url,
          mime,
          parsedQuiz,
          parsedFlashcards,
        };
      });
      setFlashcardIndex(0);
      setFlashcardFlipped(false);
      setFlashcardMarks({});
      setFlashcardMode("all");
      if (artifact.kind === "quiz") {
        const shuffled = buildShuffledQuizQuestions(parsedQuiz);
        setQuizQuestions(shuffled);
        setQuizSession({
          answers: {},
          startedAt: Date.now(),
          currentIndex: 0,
          graded: {},
        });
      } else {
        setQuizSession(null);
        setQuizAttempts([]);
        setQuizQuestions([]);
      }
    } catch {
      setPreviewError("Error de red al abrir la vista previa.");
    } finally {
      setPreviewingId(null);
    }
  }

  function closePreview() {
    setPreview((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
    setQuizSession(null);
    setQuizAttempts([]);
    setQuizQuestions([]);
  }

  useEffect(() => {
    if (!preview || preview.kind !== "quiz" || !quizStatsKey) {
      setQuizAttempts([]);
      return;
    }
    try {
      const raw = window.localStorage.getItem(quizStatsKey);
      if (!raw) {
        setQuizAttempts([]);
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setQuizAttempts([]);
        return;
      }
      const normalized = parsed
        .filter(
          (x): x is QuizAttempt =>
            x &&
            typeof x.at === "string" &&
            typeof x.score === "number" &&
            typeof x.total === "number" &&
            typeof x.elapsedMs === "number",
        )
        .slice(-20);
      setQuizAttempts(normalized);
    } catch {
      setQuizAttempts([]);
    }
  }, [preview, quizStatsKey]);

  function updateQuizAnswer(questionIdx: number, optionIdx: number) {
    setQuizSession((prev) => {
      if (!prev || prev.graded[questionIdx]) return prev;
      return {
        ...prev,
        answers: { ...prev.answers, [questionIdx]: optionIdx },
        graded: { ...prev.graded, [questionIdx]: true },
      };
    });
  }

  function finishQuiz() {
    if (!quizSession || quizQuestions.length === 0) return;
    const total = quizQuestions.length;
    const score = quizQuestions.reduce((acc, q, qIdx) => {
      const picked = quizSession.answers[qIdx];
      if (picked == null) return acc;
      return q.answerOptions?.[picked]?.isCorrect ? acc + 1 : acc;
    }, 0);
    const attempt: QuizAttempt = {
      at: new Date().toISOString(),
      score,
      total,
      elapsedMs: Date.now() - quizSession.startedAt,
    };
    const nextAttempts = [...quizAttempts, attempt].slice(-20);
    setQuizAttempts(nextAttempts);
    if (quizStatsKey) {
      window.localStorage.setItem(quizStatsKey, JSON.stringify(nextAttempts));
    }
  }

  function restartQuiz() {
    if (preview?.kind === "quiz") {
      setQuizQuestions(buildShuffledQuizQuestions(preview.parsedQuiz));
    }
    setQuizSession({
      answers: {},
      startedAt: Date.now(),
      currentIndex: 0,
      graded: {},
    });
  }

  async function deleteArtifact(artifactId: string) {
    setArtifactError(null);
    try {
      await apiJson(
      `/api/notebooklm/notebooks/${notebookId}/artifacts/${artifactId}`,
      { method: "DELETE" },
    );
    setArtifacts((prev) => prev.filter((a) => a.id !== artifactId));
    } catch (err) {
      setArtifactError(
        err instanceof NotebookApiError
          ? err.detail
          : "No se pudo eliminar el artefacto.",
      );
    }
  }

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      completed: "bg-emerald-100 text-emerald-800",
      in_progress: "bg-blue-100 text-blue-800",
      pending: "bg-amber-100 text-amber-800",
      failed: "bg-red-100 text-red-800",
    };
    return (
      <span
        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${colors[status] ?? "bg-zinc-100 text-zinc-600"}`}
      >
        {status}
      </span>
    );
  };

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      {/* Generate section */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--canvas)] p-3">
        <p className="mb-2 text-xs font-semibold text-[var(--ink-muted)]">
          Generar artefacto
        </p>
        <div className="mb-3 rounded-lg border border-[var(--border)] bg-white p-2">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold text-[var(--ink-muted)]">
              Fuentes para generar
            </p>
            <button
              type="button"
              onClick={() =>
                setSelectedSourceIds((prev) =>
                  prev.length === sources.length ? [] : sources.map((s) => s.id),
                )
              }
              className="text-[11px] font-semibold text-[var(--ink)] hover:underline"
              disabled={sources.length === 0}
            >
              {selectedSourceIds.length === sources.length ? "Ninguna" : "Todas"}
            </button>
          </div>
          {sourcesLoading ? (
            <p className="text-[11px] text-[var(--ink-faint)]">Cargando fuentes...</p>
          ) : sources.length === 0 ? (
            <p className="text-[11px] text-[var(--ink-faint)]">
              No hay fuentes listas para usar.
            </p>
          ) : (
            <ul className="max-h-32 space-y-1 overflow-y-auto pr-1">
              {sources.map((s) => {
                const checked = selectedSourceIds.includes(s.id);
                return (
                  <li key={s.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 hover:bg-[var(--surface-muted)]">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedSourceIds((prev) =>
                            checked ? prev.filter((id) => id !== s.id) : [...prev, s.id],
                          )
                        }
                      />
                      <span className="truncate text-[11px] text-[var(--ink)]">
                        {s.title ?? "Sin título"}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="rounded-lg border border-[var(--border)] bg-white px-2.5 py-1.5 text-xs focus:border-[var(--ink)] focus:outline-none"
          >
            {ARTIFACT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Instrucciones (opcional)..."
            className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-white px-2.5 py-1.5 text-xs focus:border-[var(--ink)] focus:outline-none"
          />
          <button
            type="button"
            onClick={generate}
            disabled={generating}
            className="rounded-lg bg-[var(--ink)] px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-80 disabled:opacity-40"
          >
            {generating ? "Generando..." : "Generar"}
          </button>
        </div>
      </div>

      {/* Artifacts list */}
      {loading ? (
        <p className="py-8 text-center text-xs text-[var(--ink-faint)]">
          Cargando artefactos...
        </p>
      ) : artifacts.length === 0 ? (
        <p className="py-8 text-center text-xs text-[var(--ink-faint)]">
          Sin artefactos. Genera un audio overview, quiz, o reporte.
        </p>
      ) : (
        <>
          {artifactError ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {artifactError}
            </p>
          ) : null}
          {previewError ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {previewError}
            </p>
          ) : null}
        <ul className="space-y-2">
          {artifacts.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-4 py-3"
            >
                <span
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-muted)] text-sm"
                  aria-hidden="true"
                  title={a.kind ?? "artifact"}
                >
                  {artifactIcon(a.kind)}
                </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[var(--ink)]">
                  {a.title}
                </p>
                <p className="text-[11px] text-[var(--ink-faint)]">
                  {a.kind ?? "unknown"}
                </p>
              </div>
              {statusBadge(a.status)}
                {a.status === "completed" && (
                  <button
                    type="button"
                    onClick={() => previewArtifact(a)}
                    disabled={previewingId === a.id}
                    className="shrink-0 rounded-lg border border-[var(--border)] px-2 py-1 text-[11px] font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] disabled:opacity-50"
                  >
                    {previewingId === a.id ? "Abriendo..." : "Ver"}
                  </button>
                )}
              {a.status === "completed" && (
                <button
                  type="button"
                  onClick={() => downloadArtifact(a.id, a.title)}
                  className="shrink-0 rounded-lg border border-[var(--border)] px-2 py-1 text-[11px] font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                >
                  Descargar
                </button>
              )}
              <button
                type="button"
                onClick={() => deleteArtifact(a.id)}
                className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-red-600 transition hover:bg-red-50"
              >
                Eliminar
              </button>
            </li>
          ))}
        </ul>
        </>
      )}

      {preview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-[var(--border)] bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
              <p className="truncate text-sm font-semibold text-[var(--ink)]">
                Vista previa: {preview.title}
              </p>
              <button
                type="button"
                onClick={closePreview}
                className="shrink-0 rounded-lg border border-[var(--border)] px-2 py-1 text-[11px] font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
              >
                Cerrar
              </button>
            </div>
            <div className="min-h-0 overflow-auto p-4">
              {preview.kind === "audio" ? (
                <audio className="w-full" controls src={preview.url} />
              ) : preview.kind === "video" ? (
                <video
                  className="max-h-[70vh] w-full rounded-lg bg-black"
                  controls
                  src={preview.url}
                />
              ) : preview.kind === "quiz" && preview.parsedQuiz ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 flex-1 text-sm font-semibold text-[var(--ink)]">
                      <MarkdownMathContent
                        content={preview.parsedQuiz.title ?? "Quiz"}
                        className="text-sm font-semibold"
                        compact
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={restartQuiz}
                        className="rounded-lg border border-[var(--border)] px-2 py-1 text-[11px] font-semibold text-[var(--ink)] hover:bg-[var(--surface-muted)]"
                      >
                        Reintentar
                      </button>
                      <button
                        type="button"
                        onClick={finishQuiz}
                        disabled={
                          !quizSession ||
                          Object.keys(quizSession.graded).length <
                            quizQuestions.length
                        }
                        className="rounded-lg bg-[var(--ink)] px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
                      >
                        Finalizar quiz
                      </button>
                    </div>
                  </div>

                  {quizAttempts.length > 0 ? (
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--canvas)] px-3 py-2">
                      <p className="text-xs font-semibold text-[var(--ink)]">
                        Estadisticas del quiz
                      </p>
                      <p className="mt-1 text-[11px] text-[var(--ink-faint)]">
                        Intentos: {quizAttempts.length} · Mejor:{" "}
                        {Math.max(...quizAttempts.map((a) => (100 * a.score) / Math.max(1, a.total))).toFixed(0)}% ·
                        Promedio:{" "}
                        {(
                          quizAttempts.reduce(
                            (acc, a) => acc + (100 * a.score) / Math.max(1, a.total),
                            0,
                          ) / Math.max(1, quizAttempts.length)
                        ).toFixed(0)}
                        %
                      </p>
                      <ul className="mt-2 space-y-1 text-[11px] text-[var(--ink-muted)]">
                        {[...quizAttempts]
                          .reverse()
                          .slice(0, 5)
                          .map((a, idx) => (
                            <li key={`${a.at}-${idx}`}>
                              {new Date(a.at).toLocaleString()} · {a.score}/{a.total} ·{" "}
                              {Math.round((100 * a.score) / Math.max(1, a.total))}% ·{" "}
                              {Math.round(a.elapsedMs / 1000)}s
                            </li>
                          ))}
                      </ul>
                    </div>
                  ) : null}

                  {(() => {
                    const questions = quizQuestions;
                    const total = questions.length;
                    const currentIndex = Math.min(
                      Math.max(quizSession?.currentIndex ?? 0, 0),
                      Math.max(0, total - 1),
                    );
                    const current = questions[currentIndex];
                    if (!current) return null;
                    const selected = quizSession?.answers[currentIndex];
                    const isGraded = Boolean(quizSession?.graded[currentIndex]);
                    const isCorrect = selected != null
                      ? Boolean(current.answerOptions?.[selected]?.isCorrect)
                      : false;
                    return (
                      <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--canvas)] p-4 md:p-6">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-[var(--ink-muted)]">
                            Pregunta {currentIndex + 1} de {total}
                          </p>
                          <p className="text-xs text-[var(--ink-faint)]">
                            Respondidas: {Object.keys(quizSession?.graded ?? {}).length}/{total}
                          </p>
                        </div>
                        <div className="text-base font-semibold text-[var(--ink)] md:text-lg">
                          <MarkdownMathContent
                            content={current.question ?? "Pregunta"}
                            className="text-base font-semibold md:text-lg"
                          />
                        </div>
                        <ul className="space-y-2">
                          {(current.answerOptions ?? []).map((opt, optIdx) => {
                            const isPicked = selected === optIdx;
                            const correctOpt = Boolean(opt.isCorrect);
                            const cls = isGraded
                              ? correctOpt
                                ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                                : isPicked
                                  ? "border-red-300 bg-red-50 text-red-900"
                                  : "border-[var(--border)] bg-white text-[var(--ink-muted)]"
                              : isPicked
                                ? "border-blue-300 bg-blue-50 text-blue-900"
                                : "border-[var(--border)] bg-white text-[var(--ink-muted)]";
                            return (
                              <li key={`${preview.artifactId}-q-${currentIndex}-opt-${optIdx}`}>
                                <button
                                  type="button"
                                  disabled={isGraded}
                                  onClick={() => updateQuizAnswer(currentIndex, optIdx)}
                                  className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${cls}`}
                                >
                                  <span className="shrink-0 font-semibold tabular-nums">
                                    {String.fromCharCode(65 + optIdx)}.
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <MarkdownMathContent
                                      content={opt.text ?? "Opción"}
                                      className="text-sm"
                                      compact
                                    />
                                  </div>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                        {isGraded ? (
                          <div
                            className={`rounded-lg border px-3 py-2 text-xs ${
                              isCorrect
                                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                                : "border-red-200 bg-red-50 text-red-900"
                            }`}
                          >
                            {isCorrect ? "Correcta" : "Incorrecta"}
                            {selected != null &&
                            current.answerOptions?.[selected]?.rationale ? (
                              <div className="mt-1 opacity-90">
                                <MarkdownMathContent
                                  content={String(
                                    current.answerOptions[selected]?.rationale ?? "",
                                  )}
                                  className="text-xs"
                                  compact
                                />
                              </div>
                            ) : null}
                          </div>
                        ) : current.hint ? (
                          <div className="text-xs text-[var(--ink-faint)]">
                            <span className="mr-1 font-medium">Pista:</span>
                            <MarkdownMathContent
                              content={current.hint}
                              className="inline text-xs text-[var(--ink-faint)]"
                              compact
                            />
                          </div>
                        ) : null}
                        <div className="flex items-center justify-between gap-2 pt-2">
                          <button
                            type="button"
                            disabled={currentIndex === 0}
                            onClick={() =>
                              setQuizSession((prev) =>
                                prev
                                  ? { ...prev, currentIndex: Math.max(0, prev.currentIndex - 1) }
                                  : prev,
                              )
                            }
                            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] disabled:opacity-40"
                          >
                            Anterior
                          </button>
                          <button
                            type="button"
                            disabled={currentIndex >= total - 1}
                            onClick={() =>
                              setQuizSession((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      currentIndex: Math.min(total - 1, prev.currentIndex + 1),
                                    }
                                  : prev,
                              )
                            }
                            className="rounded-lg bg-[var(--ink)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                          >
                            Siguiente
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ) : preview.kind === "flashcards" && preview.parsedFlashcards ? (
                (() => {
                  const cards = preview.parsedFlashcards.cards ?? [];
                  const reviewIndices =
                    flashcardMode === "unknown"
                      ? cards
                          .map((_, idx) => idx)
                          .filter((idx) => flashcardMarks[idx] !== "known")
                      : cards.map((_, idx) => idx);
                  const total = reviewIndices.length;
                  const idx = Math.min(Math.max(flashcardIndex, 0), Math.max(0, total - 1));
                  const realIdx = reviewIndices[idx];
                  const card = realIdx != null ? cards[realIdx] : null;
                  const knownCount = Object.values(flashcardMarks).filter(
                    (v) => v === "known",
                  ).length;
                  const unknownCount = Object.values(flashcardMarks).filter(
                    (v) => v === "unknown",
                  ).length;
                  if (!card) {
                    return (
                      <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--canvas)] p-4">
                        <p className="text-sm text-[var(--ink-faint)]">
                          {cards.length === 0
                            ? "No hay flashcards en este artefacto."
                            : "No quedan tarjetas en este modo de repaso."}
                        </p>
                        {cards.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => {
                              setFlashcardMode("all");
                              setFlashcardIndex(0);
                            }}
                            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)]"
                          >
                            Volver a todas
                          </button>
                        ) : null}
                      </div>
                    );
                  }
                  return (
                    <div className="space-y-3">
                      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold text-[var(--ink-muted)]">
                            {preview.parsedFlashcards.title ?? "Flashcards"}
                          </p>
                          <p className="text-xs text-[var(--ink-faint)]">
                            {idx + 1}/{total}
                          </p>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">
                            Me sé: {knownCount}
                          </span>
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
                            No me sé: {unknownCount}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setFlashcardMode("all");
                              setFlashcardIndex(0);
                            }}
                            className={`rounded-full px-2 py-0.5 font-semibold ${
                              flashcardMode === "all"
                                ? "bg-[var(--ink)] text-white"
                                : "border border-[var(--border)] text-[var(--ink)]"
                            }`}
                          >
                            Todas
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setFlashcardMode("unknown");
                              setFlashcardIndex(0);
                            }}
                            className={`rounded-full px-2 py-0.5 font-semibold ${
                              flashcardMode === "unknown"
                                ? "bg-[var(--ink)] text-white"
                                : "border border-[var(--border)] text-[var(--ink)]"
                            }`}
                          >
                            Repasar no sabidas
                          </button>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFlashcardFlipped((v) => !v)}
                        className="relative flex min-h-[280px] w-full items-center justify-center overflow-hidden rounded-2xl border border-[var(--border)] bg-gradient-to-br from-zinc-50 via-white to-zinc-100 p-6 text-center shadow-sm transition hover:shadow-md"
                      >
                        <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-zinc-200/50 blur-2xl" />
                        <div className="pointer-events-none absolute -bottom-8 -left-8 h-28 w-28 rounded-full bg-zinc-300/40 blur-2xl" />
                        <div>
                          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                            {flashcardFlipped ? "Reverso" : "Anverso"}
                          </p>
                          <div className="text-base font-semibold leading-relaxed text-[var(--ink)] md:text-xl">
                            <MarkdownMathContent
                              content={
                                flashcardFlipped
                                  ? (card.back ?? "Sin contenido")
                                  : (card.front ?? "Sin contenido")
                              }
                              className="text-base font-semibold leading-relaxed md:text-xl"
                            />
                          </div>
                          <p className="mt-4 text-[11px] text-[var(--ink-faint)]">
                            Pulsa para girar
                          </p>
                        </div>
                      </button>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => {
                            setFlashcardIndex((v) => Math.max(0, v - 1));
                            setFlashcardFlipped(false);
                          }}
                          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] disabled:opacity-40"
                        >
                          Anterior
                        </button>
                        <button
                          type="button"
                          onClick={() => setFlashcardFlipped((v) => !v)}
                          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)]"
                        >
                          Girar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setFlashcardMarks((prev) => ({ ...prev, [realIdx]: "known" }));
                            if (idx < total - 1) {
                              setFlashcardIndex((v) => Math.min(total - 1, v + 1));
                            }
                            setFlashcardFlipped(false);
                          }}
                          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800"
                        >
                          Me la sé
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setFlashcardMarks((prev) => ({ ...prev, [realIdx]: "unknown" }));
                            if (idx < total - 1) {
                              setFlashcardIndex((v) => Math.min(total - 1, v + 1));
                            }
                            setFlashcardFlipped(false);
                          }}
                          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800"
                        >
                          No me la sé
                        </button>
                        <button
                          type="button"
                          disabled={idx >= total - 1}
                          onClick={() => {
                            setFlashcardIndex((v) => Math.min(total - 1, v + 1));
                            setFlashcardFlipped(false);
                          }}
                          className="rounded-lg bg-[var(--ink)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                        >
                          Siguiente
                        </button>
                      </div>
                    </div>
                  );
                })()
              ) : preview.mime.startsWith("text/") ||
                preview.mime.includes("json") ||
                preview.mime.includes("markdown") ? (
                <iframe
                  src={preview.url}
                  title={`preview-${preview.artifactId}`}
                  className="h-[60vh] w-full rounded-lg border border-[var(--border)] bg-white"
                />
              ) : (
                <iframe
                  src={preview.url}
                  title={`preview-${preview.artifactId}`}
                  className="h-[70vh] w-full rounded-lg border border-[var(--border)] bg-white"
                />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
