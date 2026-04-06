import { auth } from "@/auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.5-flash";

const MAX_TRANSCRIPT_CHARS = 400_000;
const MAX_BOARD_FILES = 8;
const MAX_DOC_FILES = 4;
const MAX_BOARD_BYTES = 6 * 1024 * 1024;
const MAX_DOC_BYTES = 14 * 1024 * 1024;

const NOTES_SYSTEM = `Eres un asistente académico. Tu tarea es redactar apuntes de estudio en español a partir de las fuentes que recibes (transcripción de clase, descripción de fotos de pizarra, texto extraído de PDF).

REGLAS DE FORMATO (OBLIGATORIAS):
- Salida ÚNICAMENTE en Markdown (GFM): títulos ## o ###, listas, negritas.
- Fórmulas matemáticas SOLO con LaTeX válido para KaTeX:
  - En línea: $...$ (una sola expresión por par; sin texto suelto entre $ y $).
  - Bloque en su propia línea: $$...$$
- PROHIBIDO: símbolos $ sueltos, mezclar texto y $ sin cerrar, pseudo-LaTeX roto.
- Si una fórmula no es segura en LaTeX, descríbela en palabras entre comillas en lugar de forzar notación.

CONTENIDO:
- Estructura clara: tema, definiciones clave, fórmulas o resultados importantes, ejemplos si aparecen en las fuentes.
- No inventes contenido que no esté apoyado en las fuentes; si falta información, dilo en una línea breve.
- No repitas literalmente párrafos largos de la transcripción; sintetiza y organiza.`;

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

function extractAssistantText(data: unknown): string | null {
  if (data === null || typeof data !== "object") return null;
  const c = data as Record<string, unknown>;
  const choices = c.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as Record<string, unknown>;
  const message = first.message as Record<string, unknown> | undefined;
  if (!message) return null;
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (typeof part === "object" && part !== null && "text" in part) {
        const t = (part as { text?: string }).text;
        if (typeof t === "string") parts.push(t);
      } else if (typeof part === "string") parts.push(part);
    }
    return parts.length ? parts.join("") : null;
  }
  return null;
}

async function pdfToText(file: File): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer());
  const pdfParseMod = await import("pdf-parse");
  const pdfParse = (
    pdfParseMod as unknown as {
      default?: (b: Buffer) => Promise<{ text?: string }>;
    }
  ).default;
  if (typeof pdfParse !== "function") {
    return "";
  }
  const res = await pdfParse(buf);
  return typeof res.text === "string" ? res.text.trim() : "";
}

function collectFiles(form: FormData, key: string, maxN: number, maxBytes: number): File[] {
  const out: File[] = [];
  for (const v of form.getAll(key)) {
    if (!(v instanceof File) || v.size === 0) continue;
    if (v.size > maxBytes) continue;
    out.push(v);
    if (out.length >= maxN) break;
  }
  return out;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Falta OPENROUTER_API_KEY en el servidor. Configura .env.local y reinicia.",
      },
      { status: 503 },
    );
  }

  const model =
    process.env.OPENROUTER_MODEL?.trim() ||
    process.env.OPENROUTER_STUDY_PLAN_MODEL?.trim() ||
    DEFAULT_MODEL;

  const referer =
    process.env.OPENROUTER_HTTP_REFERER?.trim() ||
    process.env.AUTH_URL?.trim() ||
    "http://localhost:3000";

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "FormData inválido" }, { status: 400 });
  }

  const courseKey = String(form.get("courseKey") ?? "").trim().slice(0, 200);
  const sessionId = String(form.get("sessionId") ?? "").trim().slice(0, 120);
  const sessionLabel = String(form.get("sessionLabel") ?? "").trim().slice(0, 500);
  let transcript = String(form.get("transcript") ?? "").trim();
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    transcript = transcript.slice(0, MAX_TRANSCRIPT_CHARS);
  }

  if (!courseKey || !sessionId) {
    return NextResponse.json(
      { error: "courseKey y sessionId son obligatorios" },
      { status: 400 },
    );
  }

  const boards = collectFiles(form, "board", MAX_BOARD_FILES, MAX_BOARD_BYTES);
  const docs = collectFiles(form, "document", MAX_DOC_FILES, MAX_DOC_BYTES);

  if (!transcript && boards.length === 0 && docs.length === 0) {
    return NextResponse.json(
      {
        error:
          "Añade al menos una fuente: transcripción, fotos de pizarra o documento PDF.",
      },
      { status: 400 },
    );
  }

  const pdfTexts: string[] = [];
  for (const f of docs) {
    const mime = f.type || "application/pdf";
    if (!mime.includes("pdf") && !f.name.toLowerCase().endsWith(".pdf")) {
      continue;
    }
    try {
      const t = await pdfToText(f);
      if (t.length > 0) {
        pdfTexts.push(`### Texto extraído del PDF «${f.name}»\n\n${t.slice(0, 120_000)}`);
      }
    } catch {
      pdfTexts.push(`(No se pudo extraer texto del PDF «${f.name}»)`);
    }
  }

  const intro = [
    `Sesión (etiqueta): ${sessionLabel || "(sin título)"}`,
    `Curso/clave interna: ${courseKey}`,
    transcript
      ? `### Transcripción de clase\n\n${transcript}`
      : "### Transcripción de clase\n\n(no proporcionada)",
    pdfTexts.length
      ? pdfTexts.join("\n\n---\n\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const userParts: ContentPart[] = [{ type: "text", text: intro }];

  for (let i = 0; i < boards.length; i++) {
    const f = boards[i]!;
    const buf = Buffer.from(await f.arrayBuffer());
    const mime = f.type && f.type.startsWith("image/") ? f.type : "image/jpeg";
    const b64 = buf.toString("base64");
    userParts.push({
      type: "image_url",
      image_url: { url: `data:${mime};base64,${b64}` },
    });
    userParts.push({
      type: "text",
      text: `Imagen de pizarra ${i + 1} (${f.name}). Describe con precisión todo el contenido legible (fórmulas, diagramas, palabras clave) y usa esa información en los apuntes.`,
    });
  }

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": referer,
      "X-Title": "IEStudio Class Notes",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: NOTES_SYSTEM },
        { role: "user", content: userParts },
      ],
      temperature: 0.35,
      max_tokens: 12_288,
    }),
  });

  const rawText = await res.text();
  let data: unknown;
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    return NextResponse.json(
      { error: "Respuesta no JSON del proveedor", detail: rawText.slice(0, 400) },
      { status: 502 },
    );
  }

  if (!res.ok) {
    const detail =
      typeof data === "object" && data !== null && "error" in data
        ? JSON.stringify((data as { error: unknown }).error)
        : rawText.slice(0, 800);
    return NextResponse.json(
      { error: "Error al generar apuntes", detail },
      { status: res.status >= 400 && res.status < 600 ? res.status : 502 },
    );
  }

  const markdown = extractAssistantText(data)?.trim();
  if (!markdown) {
    return NextResponse.json(
      { error: "El modelo no devolvió texto" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    markdown,
    meta: {
      hadAudio: transcript.length > 0,
      photoCount: boards.length,
      hadDocs: pdfTexts.some((t) => !t.startsWith("(No se pudo")),
    },
  });
}
