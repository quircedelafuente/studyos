"use client";

import { useEffect, useRef, useState } from "react";
import { MarkdownMathContent } from "@/components/dashboard/MarkdownMathContent";
import { NotebookApiError, apiJson } from "./api-client";

type Message = {
  role: "user" | "assistant";
  content: string;
  references?: { source_id: string; citation_number?: number }[];
};

type Props = { notebookId: string };
type SourceItem = { id: string; title: string | null; status: string };
type ArtifactItem = {
  id: string;
  title: string;
  kind: string | null;
  status: string;
};

type ArtifactPreview = {
  id: string;
  title: string;
  kind: string | null;
  url: string;
  mime: string;
} | null;

type GeminiChatModelInfo = {
  id: string;
  label: string;
  description: string;
};

const GEMINI_MODEL_STORAGE_KEY = "iestudio-notebooklm-gemini-model";

/** Siempre 3 opciones desde el primer render (el fetch solo actualiza etiquetas). */
const GEMINI_MODELS_FALLBACK: GeminiChatModelInfo[] = [
  {
    id: "default",
    label: "Predeterminado",
    description: "Mismo comportamiento que notebooklm-py.",
  },
  { id: "fast", label: "Rápido", description: "Variante más ágil (experimental)." },
  { id: "pro", label: "Más capacidad", description: "Variante más elaborada (experimental)." },
];

const VALID_GEMINI_IDS = new Set(GEMINI_MODELS_FALLBACK.map((m) => m.id));

function stripReferencesBlock(raw: string): string {
  // Remove trailing "Referencias" section often appended by the model.
  const removed = raw.replace(/\n+Referencias\s*\n[\s\S]*$/i, "");
  return removed.trim();
}

function ChevronDownIcon({ className }: { className?: string }) {
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

export function ChatTab({ notebookId }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [sourceMode, setSourceMode] = useState<"url" | "text" | null>(null);
  const [url, setUrl] = useState("");
  const [textTitle, setTextTitle] = useState("");
  const [textContent, setTextContent] = useState("");
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
  const [artifactsLoading, setArtifactsLoading] = useState(true);
  const [artifactsError, setArtifactsError] = useState<string | null>(null);
  const [artifactPreview, setArtifactPreview] = useState<ArtifactPreview>(null);
  const [openingArtifactId, setOpeningArtifactId] = useState<string | null>(null);
  const [sourcesMinimized, setSourcesMinimized] = useState(false);
  const [artifactsMinimized, setArtifactsMinimized] = useState(false);
  const [geminiModels, setGeminiModels] = useState<GeminiChatModelInfo[]>(GEMINI_MODELS_FALLBACK);
  const [geminiModel, setGeminiModel] = useState<string>("default");
  const [geminiMenuOpen, setGeminiMenuOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const geminiMenuRef = useRef<HTMLDivElement>(null);
  const chatStorageKey = `iestudio-notebooklm-chat-${notebookId}`;
  /**
   * Evita que el primer guardado tras montar/cambiar notebook borre localStorage
   * con estado vacío o con mensajes del notebook anterior.
   */
  const skipNextPersistRef = useRef(true);

  useEffect(() => {
    skipNextPersistRef.current = true;
  }, [notebookId]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(GEMINI_MODEL_STORAGE_KEY)?.trim();
      if (raw && VALID_GEMINI_IDS.has(raw)) setGeminiModel(raw);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiJson<{ models: GeminiChatModelInfo[] }>(
          "/api/notebooklm/gemini-chat-models",
        );
        const fromApi = Array.isArray(data.models) ? data.models : [];
        const list =
          fromApi.length > 0 && fromApi.every((m) => m?.id && VALID_GEMINI_IDS.has(m.id))
            ? fromApi
            : GEMINI_MODELS_FALLBACK;
        setGeminiModels(list);
        setGeminiModel((prev) => (list.some((m) => m.id === prev) ? prev : "default"));
      } catch {
        setGeminiModels(GEMINI_MODELS_FALLBACK);
      }
    })();
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(GEMINI_MODEL_STORAGE_KEY, geminiModel);
    } catch {
      // ignore
    }
  }, [geminiModel]);

  useEffect(() => {
    if (!geminiMenuOpen) return;
    function handlePointerDown(e: PointerEvent) {
      if (geminiMenuRef.current?.contains(e.target as Node)) return;
      setGeminiMenuOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [geminiMenuOpen]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(chatStorageKey);
      if (!raw) {
        setMessages([]);
        setConversationId(null);
        return;
      }
      const parsed = JSON.parse(raw) as {
        messages?: Message[];
        conversationId?: string | null;
      };
      setMessages(Array.isArray(parsed.messages) ? parsed.messages : []);
      setConversationId(
        typeof parsed.conversationId === "string" || parsed.conversationId === null
          ? parsed.conversationId
          : null,
      );
    } catch {
      setMessages([]);
      setConversationId(null);
    }
  }, [chatStorageKey]);

  useEffect(() => {
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }
    try {
      window.localStorage.setItem(
        chatStorageKey,
        JSON.stringify({ messages, conversationId }),
      );
    } catch {
      // Ignore storage quota/availability errors.
    }
  }, [chatStorageKey, messages, conversationId]);

  // Guardar al cerrar pestaña / salir de la página (por si el batch de React no ha persistido aún).
  useEffect(() => {
    function flush() {
      try {
        window.localStorage.setItem(
          chatStorageKey,
          JSON.stringify({ messages, conversationId }),
        );
      } catch {
        // ignore
      }
    }
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
    };
  }, [chatStorageKey, messages, conversationId]);

  async function refreshSources() {
    setSourcesLoading(true);
    setSourceError(null);
    try {
      const data = await apiJson<SourceItem[]>(
        `/api/notebooklm/notebooks/${notebookId}/sources`,
      );
      setSources(data);
      setSelectedSourceIds((prev) => {
        const prevSet = new Set(prev);
        const stillValid = data.filter((s) => prevSet.has(s.id)).map((s) => s.id);
        if (stillValid.length > 0) return stillValid;
        return data.filter((s) => s.status === "ready").map((s) => s.id);
      });
    } catch (err) {
      setSources([]);
      setSourceError(
        err instanceof NotebookApiError ? err.detail : "No se pudieron cargar las fuentes.",
      );
    } finally {
      setSourcesLoading(false);
    }
  }

  async function refreshArtifacts() {
    setArtifactsLoading(true);
    setArtifactsError(null);
    try {
      const data = await apiJson<ArtifactItem[]>(
        `/api/notebooklm/notebooks/${notebookId}/artifacts`,
      );
      setArtifacts(data);
    } catch (err) {
      setArtifacts([]);
      setArtifactsError(
        err instanceof NotebookApiError
          ? err.detail
          : "No se pudieron cargar los artefactos.",
      );
    } finally {
      setArtifactsLoading(false);
    }
  }

  useEffect(() => {
    void refreshSources();
    void refreshArtifacts();
  }, [notebookId]);

  // Keep source status fresh while there are pending items.
  useEffect(() => {
    const hasPending = sources.some((s) => s.status === "processing");
    if (!hasPending) return;
    const timer = window.setInterval(() => {
      void refreshSources();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [sources]);

  // Keep artifacts list fresh while generation is running.
  useEffect(() => {
    const hasPending = artifacts.some(
      (a) => a.status === "processing" || a.status === "pending" || a.status === "in_progress",
    );
    if (!hasPending) return;
    const timer = window.setInterval(() => {
      void refreshArtifacts();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [artifacts]);

  useEffect(() => {
    return () => {
      if (artifactPreview?.url) URL.revokeObjectURL(artifactPreview.url);
    };
  }, [artifactPreview]);

  async function openArtifactPreview(a: ArtifactItem) {
    setOpeningArtifactId(a.id);
    setArtifactsError(null);
    try {
      const res = await fetch(
        `/api/notebooklm/notebooks/${notebookId}/artifacts/${a.id}/download`,
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setArtifactsError(String(err?.detail ?? err?.error ?? "No se pudo abrir el artefacto."));
        return;
      }
      const blob = await res.blob();
      const mime = res.headers.get("content-type") ?? blob.type ?? "";
      const url = URL.createObjectURL(blob);
      setArtifactPreview((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return { id: a.id, title: a.title, kind: a.kind, url, mime };
      });
    } finally {
      setOpeningArtifactId(null);
    }
  }

  async function addUrlSource() {
    if (!url.trim()) return;
    setSourceBusy(true);
    setSourceError(null);
    try {
      await apiJson(`/api/notebooklm/notebooks/${notebookId}/sources/url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      setUrl("");
      setSourceMode(null);
      await refreshSources();
    } catch (err) {
      setSourceError(
        err instanceof NotebookApiError ? err.detail : "No se pudo anadir la URL.",
      );
    } finally {
      setSourceBusy(false);
    }
  }

  async function addTextSource() {
    if (!textTitle.trim() || !textContent.trim()) return;
    setSourceBusy(true);
    setSourceError(null);
    try {
      await apiJson(`/api/notebooklm/notebooks/${notebookId}/sources/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: textTitle.trim(),
          content: textContent.trim(),
        }),
      });
      setTextTitle("");
      setTextContent("");
      setSourceMode(null);
      await refreshSources();
    } catch (err) {
      setSourceError(
        err instanceof NotebookApiError ? err.detail : "No se pudo anadir el texto.",
      );
    } finally {
      setSourceBusy(false);
    }
  }

  async function addFileSources(files: File[]) {
    if (files.length === 0) return;
    setSourceBusy(true);
    setSourceError(null);
    try {
      const failed: string[] = [];

      // Upload one-by-one (stable) instead of one big batch.
      for (const file of files) {
        let uploaded = false;
        for (let attempt = 0; attempt < 3 && !uploaded; attempt += 1) {
          const form = new FormData();
          form.append("file", file);
          const res = await fetch(`/api/notebooklm/notebooks/${notebookId}/sources/file`, {
            method: "POST",
            body: form,
          });
          if (res.ok) {
            uploaded = true;
            break;
          }
          if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
          }
        }
        if (!uploaded) failed.push(file.name);
      }

      if (failed.length > 0) {
        const names = failed.slice(0, 3).join(", ");
        setSourceError(`No se pudieron subir ${failed.length} archivo(s): ${names}`);
      }
      if (fileRef.current) fileRef.current.value = "";
      await refreshSources();
    } catch (err) {
      setSourceError(
        err instanceof NotebookApiError ? err.detail : "No se pudieron subir archivos.",
      );
    } finally {
      setSourceBusy(false);
    }
  }

  async function deleteSource(id: string) {
    setSourceBusy(true);
    setSourceError(null);
    try {
      await apiJson(`/api/notebooklm/notebooks/${notebookId}/sources/${id}`, {
        method: "DELETE",
      });
      setSelectedSourceIds((prev) => prev.filter((s) => s !== id));
      await refreshSources();
    } catch (err) {
      setSourceError(
        err instanceof NotebookApiError ? err.detail : "No se pudo eliminar la fuente.",
      );
    } finally {
      setSourceBusy(false);
    }
  }

  async function send() {
    const question = input.trim();
    if (!question || sending) return;

    setInput("");
    setChatError(null);
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setSending(true);

    try {
      const data = await apiJson<{
        answer: string;
        conversation_id: string | null;
        references?: { source_id: string; citation_number?: number }[];
      }>(
        `/api/notebooklm/notebooks/${notebookId}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question,
            conversation_id: conversationId,
            source_ids: selectedSourceIds.length > 0 ? selectedSourceIds : undefined,
            gemini_model: geminiModel || undefined,
          }),
        },
      );

      setConversationId(data.conversation_id);
      const cleanAnswer = stripReferencesBlock(String(data.answer ?? ""));
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: cleanAnswer,
          references: data.references ?? [],
        },
      ]);
    } catch (err) {
      const msg =
        err instanceof NotebookApiError ? err.detail : "No se pudo enviar la pregunta.";
      setChatError(msg);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${msg}` },
      ]);
    } finally {
      setSending(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          className={`${sourcesMinimized ? "w-12" : "w-72"} flex min-h-0 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] p-3 transition-all`}
        >
          <div className="mb-2 shrink-0 flex items-center justify-between">
            {!sourcesMinimized ? (
              <>
                <p className="text-xs font-semibold text-[var(--ink-muted)]">Fuentes del chat</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedSourceIds((prev) =>
                        prev.length === sources.length ? [] : sources.map((s) => s.id),
                      )
                    }
                    className="text-[11px] font-semibold text-[var(--ink)] hover:underline"
                  >
                    {selectedSourceIds.length === sources.length ? "Ninguna" : "Todas"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSourcesMinimized(true)}
                    className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ink)]"
                    title="Minimizar fuentes"
                  >
                    −
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setSourcesMinimized(false)}
                className="mx-auto rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ink)]"
                title="Expandir fuentes"
              >
                +
              </button>
            )}
          </div>
          {!sourcesMinimized ? (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
          <div className="mb-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setSourceMode(sourceMode === "url" ? null : "url")}
              className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px] font-semibold text-[var(--ink)]"
            >
              + URL
            </button>
            <button
              type="button"
              onClick={() => setSourceMode(sourceMode === "text" ? null : "text")}
              className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px] font-semibold text-[var(--ink)]"
            >
              + Texto
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={sourceBusy}
              className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px] font-semibold text-[var(--ink)] disabled:opacity-50"
            >
              {sourceBusy ? "Subiendo..." : "+ Archivo"}
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".pdf,.txt,.md,.csv,.docx,.epub"
              className="hidden"
              onChange={(e) => void addFileSources(Array.from(e.target.files ?? []))}
            />
          </div>
          {sourceMode === "url" ? (
            <div className="mb-2 flex gap-1">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://..."
                className="min-w-0 flex-1 rounded-md border border-[var(--border)] px-2 py-1 text-[11px]"
              />
              <button
                type="button"
                onClick={addUrlSource}
                disabled={sourceBusy}
                className="rounded-md bg-[var(--ink)] px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
              >
                OK
              </button>
            </div>
          ) : null}
          {sourceMode === "text" ? (
            <div className="mb-2 space-y-1">
              <input
                type="text"
                value={textTitle}
                onChange={(e) => setTextTitle(e.target.value)}
                placeholder="Titulo"
                className="w-full rounded-md border border-[var(--border)] px-2 py-1 text-[11px]"
              />
              <textarea
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                rows={3}
                placeholder="Contenido..."
                className="w-full rounded-md border border-[var(--border)] px-2 py-1 text-[11px]"
              />
              <button
                type="button"
                onClick={addTextSource}
                disabled={sourceBusy}
                className="rounded-md bg-[var(--ink)] px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
              >
                Anadir
              </button>
            </div>
          ) : null}
          {sourceError ? (
            <p className="mb-2 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
              {sourceError}
            </p>
          ) : null}
          {sourcesLoading ? (
            <p className="text-xs text-[var(--ink-faint)]">Cargando fuentes...</p>
          ) : sources.length === 0 ? (
            <p className="text-xs text-[var(--ink-faint)]">No hay fuentes.</p>
          ) : (
            <ul className="space-y-1 pb-1">
              {sources.map((s) => {
                const checked = selectedSourceIds.includes(s.id);
                return (
                  <li key={s.id}>
                    <div className="flex items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-[var(--surface-muted)]">
                      <input
                        type="checkbox"
                        disabled={s.status !== "ready"}
                        checked={checked}
                        onChange={() =>
                          setSelectedSourceIds((prev) =>
                            checked ? prev.filter((id) => id !== s.id) : [...prev, s.id],
                          )
                        }
                      />
                      <span className="min-w-0 flex-1 truncate text-xs text-[var(--ink)]">
                        {s.title ?? "Sin título"}
                      </span>
                      <span className="text-[10px] text-[var(--ink-faint)]">{s.status}</span>
                      <button
                        type="button"
                        onClick={() => void deleteSource(s.id)}
                        className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-red-600 hover:bg-red-50"
                        title="Eliminar fuente"
                      >
                        x
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
            </div>
          ) : null}
        </aside>

        {/* Messages */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto p-4">
            {chatError ? (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {chatError}
              </div>
            ) : null}
            {messages.length === 0 ? (
              <p className="py-12 text-center text-xs text-[var(--ink-faint)]">
                Pregunta algo sobre las fuentes de este notebook.
              </p>
            ) : (
              <div className="space-y-4">
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                        msg.role === "user"
                          ? "bg-[var(--ink)] text-white"
                          : "border border-[var(--border)] bg-[var(--canvas)] text-[var(--ink)] shadow-sm"
                      }`}
                    >
                      {msg.role === "assistant" ? (
                        <MarkdownMathContent
                          content={msg.content}
                          className="text-[13px] leading-relaxed"
                        />
                      ) : (
                        <MarkdownMathContent
                          content={msg.content}
                          className="text-sm text-white [&_.katex]:text-white [&_a]:text-white [&_a]:underline"
                          compact
                        />
                      )}
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {/* Input (center chat column only) */}
          <div className="shrink-0 border-t border-[var(--border)] p-3">
            <div className="flex items-stretch gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
                placeholder="Escribe una pregunta..."
                disabled={sending}
                className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--ink)] focus:outline-none disabled:opacity-50"
              />
              <button
                type="button"
                onClick={send}
                disabled={sending || !input.trim()}
                className="shrink-0 rounded-xl bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-80 disabled:opacity-40"
              >
                {sending ? "..." : "Enviar"}
              </button>
              <div className="relative shrink-0" ref={geminiMenuRef}>
                <button
                  type="button"
                  onClick={() => setGeminiMenuOpen((o) => !o)}
                  disabled={sending}
                  title={`${
                    geminiModels.find((m) => m.id === geminiModel)?.description ??
                    "Modelo para la siguiente respuesta"
                  }. Al cambiar el modelo se inicia una conversación nueva en el servidor.`}
                  aria-expanded={geminiMenuOpen}
                  aria-haspopup="listbox"
                  className="flex h-full min-h-[2.5rem] max-w-[11rem] items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-2.5 py-2 text-left text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:border-[var(--ink)] focus:outline-none disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {geminiModels.find((m) => m.id === geminiModel)?.label ?? "Modelo"}
                  </span>
                  <ChevronDownIcon className="h-4 w-4 shrink-0 opacity-70" />
                </button>
                {geminiMenuOpen ? (
                  <ul
                    role="listbox"
                    className="absolute bottom-full right-0 z-40 mb-1.5 min-w-[14rem] max-w-[min(100vw-2rem,18rem)] rounded-xl border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg ring-1 ring-black/5"
                  >
                    {geminiModels.map((m) => (
                      <li key={m.id} role="presentation">
                        <button
                          type="button"
                          role="option"
                          aria-selected={geminiModel === m.id}
                          className={`w-full px-3 py-2 text-left text-xs transition hover:bg-[var(--surface-muted)] ${
                            geminiModel === m.id ? "bg-[var(--surface-muted)] font-semibold" : ""
                          }`}
                          onClick={() => {
                            setGeminiModel(m.id);
                            setConversationId(null);
                            setGeminiMenuOpen(false);
                          }}
                        >
                          <span className="block text-[var(--ink)]">{m.label}</span>
                          {m.description ? (
                            <span className="mt-0.5 block text-[10px] leading-snug text-[var(--ink-faint)]">
                              {m.description}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <aside
          className={`${artifactsMinimized ? "w-12" : "w-72"} flex min-h-0 shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface)] p-3 transition-all`}
        >
          <div className="mb-2 shrink-0 flex items-center justify-between">
            {!artifactsMinimized ? (
              <>
                <p className="text-xs font-semibold text-[var(--ink-muted)]">Artefactos</p>
                <button
                  type="button"
                  onClick={() => setArtifactsMinimized(true)}
                  className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ink)]"
                  title="Minimizar artefactos"
                >
                  −
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setArtifactsMinimized(false)}
                className="mx-auto rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ink)]"
                title="Expandir artefactos"
              >
                +
              </button>
            )}
          </div>
          {!artifactsMinimized ? (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
            {artifactsLoading ? (
              <p className="text-xs text-[var(--ink-faint)]">Cargando artefactos...</p>
            ) : artifactsError ? (
              <p className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
                {artifactsError}
              </p>
            ) : artifacts.length === 0 ? (
              <p className="text-xs text-[var(--ink-faint)]">Sin artefactos.</p>
            ) : (
              <ul className="space-y-1">
                {artifacts.map((a) => (
                  <li
                    key={a.id}
                    className="rounded-lg border border-[var(--border)] bg-[var(--canvas)] px-2 py-1.5"
                  >
                    <p className="truncate text-[11px] font-semibold text-[var(--ink)]">
                      {a.title}
                    </p>
                    <p className="text-[10px] text-[var(--ink-faint)]">
                      {a.kind ?? "unknown"} · {a.status}
                    </p>
                    {a.status === "completed" ? (
                      <button
                        type="button"
                        onClick={() => void openArtifactPreview(a)}
                        disabled={openingArtifactId === a.id}
                        className="mt-1 rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ink)] disabled:opacity-50"
                      >
                        {openingArtifactId === a.id ? "Abriendo..." : "Ver"}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            </div>
          ) : null}
        </aside>
      </div>

      {artifactPreview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-[var(--border)] bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
              <p className="truncate text-sm font-semibold text-[var(--ink)]">
                {artifactPreview.title}
              </p>
              <button
                type="button"
                onClick={() =>
                  setArtifactPreview((prev) => {
                    if (prev?.url) URL.revokeObjectURL(prev.url);
                    return null;
                  })
                }
                className="rounded-md border border-[var(--border)] px-2 py-1 text-xs font-semibold text-[var(--ink)]"
              >
                Cerrar
              </button>
            </div>
            <div className="min-h-0 overflow-auto p-4">
              {artifactPreview.kind === "audio" ? (
                <audio controls className="w-full" src={artifactPreview.url} />
              ) : artifactPreview.kind === "video" ? (
                <video controls className="max-h-[70vh] w-full rounded-lg bg-black" src={artifactPreview.url} />
              ) : (
                <iframe
                  src={artifactPreview.url}
                  title={`artifact-preview-${artifactPreview.id}`}
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
