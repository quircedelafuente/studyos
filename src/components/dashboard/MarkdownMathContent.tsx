"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

type Props = {
  content: string;
  /** Clases del contenedor (tipografía, color) */
  className?: string;
  /** Menos margen en párrafos (opciones de quiz, títulos cortos) */
  compact?: boolean;
};

/**
 * Markdown (GFM) + matemáticas LaTeX ($...$, $$...$$) con KaTeX.
 * Uso: chat NotebookLM, quizzes, flashcards y cualquier texto del dashboard con fórmulas.
 */
export function MarkdownMathContent({ content, className = "", compact = false }: Props) {
  const text = content ?? "";

  return (
    <div
      className={`markdown-math-root text-[var(--ink)] [&_.katex]:text-[0.95em] [&_.katex-display]:my-2 [&_.katex-display]:overflow-x-auto ${compact ? "[&_p]:mb-1 [&_p:last-child]:mb-0" : ""} ${className}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false, output: "html" }]]}
        components={{
          p: ({ children }) => (
            <p
              className={
                compact
                  ? "mb-1 last:mb-0 [&>code]:rounded [&>code]:bg-[var(--surface-muted)] [&>code]:px-1 [&>code]:text-[12px]"
                  : "mb-2 last:mb-0 [&>code]:rounded [&>code]:bg-[var(--surface-muted)] [&>code]:px-1 [&>code]:text-[12px]"
              }
            >
              {children}
            </p>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-[var(--ink)]">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => (
            <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
          ),
          li: ({ children }) => <li className="[&>p]:mb-0">{children}</li>,
          h1: ({ children }) => (
            <h3 className="mb-2 mt-3 text-base font-semibold first:mt-0">{children}</h3>
          ),
          h2: ({ children }) => (
            <h3 className="mb-2 mt-3 text-sm font-semibold first:mt-0">{children}</h3>
          ),
          h3: ({ children }) => (
            <h4 className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</h4>
          ),
          code: ({ className: codeClass, children, ...props }) => {
            const isBlock = codeClass?.includes("language-");
            if (isBlock) {
              return (
                <code
                  className="my-2 block overflow-x-auto rounded-lg bg-[var(--surface-muted)] p-2 text-[12px]"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code className="rounded bg-[var(--surface-muted)] px-1 text-[12px]" {...props}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => <pre className="my-2 overflow-x-auto">{children}</pre>,
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-[var(--border)] pl-3 text-[var(--ink-muted)]">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              className="font-medium text-[var(--ink)] underline underline-offset-2 hover:opacity-80"
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
