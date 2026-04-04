import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** OpenRouter — https://openrouter.ai/models/google/gemini-2.5-flash */
const DEFAULT_MODEL = "google/gemini-2.5-flash";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const STUDY_COACH_SYSTEM = `Rol y propósito:
Eres el coach de planificación de estudio de la app. Generas planes concretos, cuantificados y basados en ciencia cognitiva (repetición espaciada, evocación activa, intercalado, planificación inversa). Prioridad: adquisición acelerada del contenido nuevo y luego consolidación con práctica y simulacros.

POLÍTICA DE PREGUNTAS (OBLIGATORIA — no la incumplas):
- Lo ÚNICO que puedes preguntar al usuario si falta es: (A) cuántas horas en total quiere dedicar al estudio, o cuántas horas por día como máximo; (B) cuándo quiere empezar o con cuánta antelación respecto al examen (si no lo dijo y no basta el CONTEXTO FIJO).
- PROHIBIDO pedir: número de páginas, "volumen en páginas", dificultad del 1 al 5, confirmación para "proceder con suposiciones", o listas largas de datos administrativos.
- Si el usuario pega temario, sesiones (SESSION 19…), bullets del syllabus, capítulos o temas: eso YA cuenta como contenido y volumen. NO pidas páginas ni dificultad; infiere carga internamente (p. ej. dificultad moderada 3/5) sin preguntar.
- Si el usuario da horas totales (ej. "15 h") + fecha de inicio (ej. "6 de abril") + contenido pegado + el examen está en CONTEXTO FIJO: entrega el plan COMPLETO en esa misma respuesta. No pidas nada más. No digas "necesito páginas y dificultad".
- Si faltan horas y no hay pista: una sola pregunta corta sobre horas. Si faltan fechas de inicio y no se deducen: una sola pregunta corta. Nunca más de un turno de preguntas por cosas opcionales.

Reglas de lógica computacional:

REGLA 1 — Horas y calendario:
Reparte las horas totales que el usuario indicó entre los días desde su fecha de inicio hasta el día del examen (incluido el criterio del CONTEXTO FIJO). Tope razonable ~4–5 h/día de deep work salvo que el usuario diga otra cosa. Si las horas no alcanzan para todo el temario, prioriza lo más examinable y dilo en una frase; no pidas más datos para decidir.

REGLA 2 — Front-loading 60/40:
Primer ~60% del tiempo: adquisición + active recall. Último ~40%: consolidación, tests, simulacros, sin teoría nueva.

REGLA 3 — Prohibido estudio pasivo:
Tareas accionables (Feynman, flashcards, tests, ejercicios, case study activo), no "leer y subrayar" como única tarea.

REGLA 4 — Intercalado:
Bloques de ~90–120 min e intercalar temas cuando haya varios.

Estructura de la respuesta cuando entregues plan cerrado:

1) Veredicto logístico: inicio, días cubiertos, fases 60/40.
2) Estrategia: máximo 3 líneas.
3) Calendario día a día con cabeceras claras (ej. "Lunes, 07 de abril de 2026 (X horas)") y Bloques numerados por día.
4) Cuello de botella + qué recortar si se atrasa.

Tono: directo, ejecutable, en español. Sin bucles de "confírmame si procedo".

IMPORTANTE (app):
- La fecha límite del examen/entrega es la del CONTEXTO FIJO si existe; no pidas otra.
- Respeta fechas de inicio que el usuario diga explícitamente.
- Habla siempre en español.
`;

const EXTRACT_SYSTEM = `Eres un extractor de datos. Analiza toda la conversación y devuelve ÚNICAMENTE un objeto JSON válido (sin markdown, sin comentarios, sin texto fuera del JSON) con esta forma exacta:
{"totalHoursEstimated": number | null, "methodNote": string, "days": [{"date": "YYYY-MM-DD", "studyHours": number, "focus": string}]}

La interfaz muestra UNA TARJETA POR CADA elemento de "days": fecha, duración (studyHours) y listado de tareas (focus). Por tanto:

- OBLIGATORIO: Siempre que el asistente haya propuesto un plan con reparto por días, semanas o bloques con horas, rellena "days" con una fila por cada día de estudio. NUNCA dejes "days": [] si ya hay un plan ejecutable con tareas por día.
- Si el asistente usa líneas tipo "Lunes, 07 de abril de 2026 (2.5 horas)" o "Domingo, 06 de abril de 2026 (2 horas)", hay EXACTAMENTE una fila en "days" por cada una de esas líneas (misma fecha ISO), con "studyHours" del paréntesis y "focus" con los Bloques de ese día separados por "; ".
- "focus" debe ser un listado conciso de qué estudiar ese día: varias tareas separadas por "; " (punto y coma). Sin párrafos largos; solo ítems accionables (Feynman, flashcards, tests, simulacros, intercalado).
- "studyHours": horas de estudio ese día (decimal permitido). Entre ~0.5 y ~5 salvo que el plan diga otra cosa.
- Fechas YYYY-MM-DD en calendario local. Si hay CONTEXTO FIJO con fecha de examen/entrega, ningún "date" posterior a esa fecha.
- PRIORIDAD de fechas para cada "date": (1) fechas explícitas en el mensaje del asistente; (2) FECHA_DE_INICIO_EN_CHAT si viene en el contexto (usuario acordó empezar ese día); (3) fecha de inicio que el usuario o el asistente hayan dicho en la conversación ("empiezo el…", "desde el…"); (4) si solo hay N días sin anclaje, fechas consecutivas desde la opción más coherente: si hay examen, puedes trabajar hacia atrás desde el examen SOLO si el usuario NO fijó otra fecha de inicio; si fijó inicio, N filas consecutivas desde ESA fecha; (5) último recurso: HOY_REFERENCIA.
- NUNCA uses HOY_REFERENCIA como primer día si FECHA_DE_INICIO_EN_CHAT o el chat fija una fecha de inicio posterior.
- Si solo cabe un único bloque de estudio (un día), devuelve un solo elemento en "days".
- "methodNote": como mucho 1–2 frases opcionales (p. ej. 60/40 o margen 15%); NO repitas aquí lo que ya va en "focus" de cada día.
- Solo si la conversación NO permite aún estimar ni un solo día de trabajo (falta contenido o fechas/horas imprescindibles), entonces "days": [] y "methodNote" explica brevemente qué falta (solo horas o inicio/examen, nunca páginas ni escala de dificultad).
`;

type ChatTurn = { role: "user" | "model"; content: string };

type TargetEventPayload = {
  title?: string;
  date?: string;
  time?: string | null;
  id?: string;
};

type Body = {
  action?: "chat" | "extract_schedule";
  planTitle?: string;
  messages: ChatTurn[];
  targetEvent?: TargetEventPayload | null;
  /** YYYY-MM-DD (local). Para inferir fechas en "days" cuando el chat no las detalla. */
  todayLocal?: string;
  /** YYYY-MM-DD inferido del chat (inicio de estudio acordado). */
  startDateHint?: string;
};

function parseTargetEvent(raw: unknown): TargetEventPayload | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const date = typeof o.date === "string" ? o.date.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const title =
    typeof o.title === "string" ? o.title.trim().slice(0, 200) : "";
  let time: string | null | undefined;
  if (o.time === null) time = null;
  else if (typeof o.time === "string" && /^\d{2}:\d{2}$/.test(o.time)) time = o.time;
  else time = undefined;
  const id = typeof o.id === "string" ? o.id.trim().slice(0, 120) : undefined;
  return {
    date,
    title,
    ...(time !== undefined ? { time } : {}),
    ...(id ? { id } : {}),
  };
}

function parseLocalYmd(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

function startOfLocalToday(): Date {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
}

function buildTargetEventSystemBlock(ev: TargetEventPayload | undefined): string {
  if (!ev?.date || !/^\d{4}-\d{2}-\d{2}$/.test(ev.date)) return "";
  const title = ev.title?.trim() || "(sin título)";
  const eventDate = parseLocalYmd(ev.date);
  const today = startOfLocalToday();
  const timeLine =
    ev.time !== undefined && ev.time !== null && /^\d{2}:\d{2}$/.test(ev.time)
      ? `\n- Hora del examen o entrega: ${ev.time} (hora local)`
      : `\n- Hora: no indicada (tratar como día completo o preguntar solo si es necesario para el plan).`;

  const dateStrEs = eventDate
    ? eventDate.toLocaleDateString("es", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : ev.date;

  let timingLine = "";
  if (eventDate) {
    const diffDays = Math.floor(
      (eventDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
    );
    const todayStr = today.toLocaleDateString("es", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    if (diffDays < 0) {
      timingLine = `\n- Plazo: la fecha del evento (${ev.date}) ya pasó respecto a hoy (${todayStr}). Ajusta el plan con realismo o confirma con el usuario si hubo cambio de fecha.`;
    } else if (diffDays === 0) {
      timingLine = `\n- Plazo: hoy (${todayStr}) es el día del examen o entrega. No quedan días anteriores para estudiar; solo repaso exprés si aplica.`;
    } else {
      timingLine = `\n- Plazo: faltan ${diffDays} día(s) calendario hasta el día del evento (hoy es ${todayStr}; el evento es el ${dateStrEs}). Incluye ese número de días en tu planificación (desde mañana hasta el día del evento, según convenga).`;
    }
  }

  return `\n\nCONTEXTO FIJO — EXAMEN O ENTREGA (definido en «Exámenes y fechas» de la app):\n- Título del evento: ${title}\n- Fecha límite (ISO): ${ev.date}\n- Fecha en español: ${dateStrEs}${timeLine}${timingLine}\n- Reglas: esta es la fecha/hora oficial del examen o de la entrega de la tarea. NO pidas otra fecha de examen o entrega salvo que el usuario diga explícitamente que la cambia.\n- El plan de estudio debe repartir el trabajo hasta llegar preparado a esa fecha; el calendario día a día debe terminar en o antes del ${ev.date}.\n`;
}

function toOpenRouterMessages(
  messages: ChatTurn[],
  systemText: string,
): { role: "system" | "user" | "assistant"; content: string }[] {
  const out: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemText },
  ];
  for (const m of messages) {
    out.push({
      role: m.role === "model" ? "assistant" : "user",
      content: m.content,
    });
  }
  return out;
}

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

function parseScheduleJson(raw: string): {
  totalHoursEstimated: number | null;
  methodNote: string;
  days: { date: string; studyHours: number; focus: string }[];
} | null {
  let t = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)```/m.exec(t);
  if (fenced?.[1]) t = fenced[1].trim();
  try {
    const o = JSON.parse(t) as Record<string, unknown>;
    const total =
      typeof o.totalHoursEstimated === "number"
        ? o.totalHoursEstimated
        : o.totalHoursEstimated === null
          ? null
          : null;
    const methodNote = typeof o.methodNote === "string" ? o.methodNote : "";
    const daysRaw = o.days;
    const days: { date: string; studyHours: number; focus: string }[] = [];
    if (Array.isArray(daysRaw)) {
      for (const row of daysRaw) {
        if (row === null || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        if (typeof r.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) continue;
        const h = Number(r.studyHours);
        const focus = typeof r.focus === "string" ? r.focus : "";
        if (!Number.isFinite(h)) continue;
        days.push({ date: r.date, studyHours: h, focus });
      }
    }
    return { totalHoursEstimated: total, methodNote, days };
  } catch {
    return null;
  }
}

function parseRetrySecondsFromMessage(message: string): number | undefined {
  const m = /Please retry in ([\d.]+)s/i.exec(message);
  if (m?.[1]) {
    const s = Math.ceil(parseFloat(m[1]));
    if (Number.isFinite(s) && s > 0 && s <= 3600) return s;
  }
  const m2 = /retry after (\d+)/i.exec(message);
  if (m2?.[1]) {
    const s = parseInt(m2[1], 10);
    if (Number.isFinite(s) && s > 0 && s <= 3600) return s;
  }
  return undefined;
}

function extractApiErrorMessage(data: unknown, rawText: string): string {
  if (data === null || typeof data !== "object") return rawText.slice(0, 800);
  const root = data as Record<string, unknown>;
  const inner = root.error;
  if (inner !== null && typeof inner === "object") {
    const m = (inner as Record<string, unknown>).message;
    if (typeof m === "string" && m.length > 0) return m;
  }
  if (typeof root.message === "string" && root.message.length > 0) return root.message;
  return rawText.slice(0, 800);
}

function openRouterFailureResponse(status: number, data: unknown, rawText: string) {
  const technical = extractApiErrorMessage(data, rawText);

  if (status === 429) {
    const retrySec = parseRetrySecondsFromMessage(technical) ?? 60;
    const detail =
      "Límite de uso o cuota de OpenRouter (o del proveedor). Espera un poco y vuelve a intentar; " +
      "revisa créditos y límites en https://openrouter.ai/ . " +
      `Opcional: cambia el modelo en .env.local (OPENROUTER_MODEL). ` +
      `Detalle: ${technical.slice(0, 400)}`;

    return NextResponse.json(
      { error: "Límite de uso (cuota agotada)", detail },
      {
        status: 429,
        headers: { "Retry-After": String(Math.min(retrySec, 300)) },
      },
    );
  }

  const short =
    status === 403 || status === 401
      ? "Clave de API de OpenRouter inválida o sin permiso."
      : "Error al llamar al modelo vía OpenRouter.";
  return NextResponse.json(
    { error: short, detail: technical.slice(0, 2000) },
    { status: status >= 400 && status < 600 ? status : 502 },
  );
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "No hay clave de OpenRouter. Añade OPENROUTER_API_KEY en .env.local y reinicia el servidor.",
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

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON inválido" }, { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const planTitle =
    typeof body.planTitle === "string" ? body.planTitle.slice(0, 200).trim() : "";

  if (messages.length === 0) {
    return NextResponse.json({ error: "La conversación está vacía" }, { status: 400 });
  }

  for (const m of messages) {
    if (
      (m.role !== "user" && m.role !== "model") ||
      typeof m.content !== "string" ||
      m.content.length > 120_000
    ) {
      return NextResponse.json({ error: "Mensaje inválido" }, { status: 400 });
    }
  }

  const action = body.action === "extract_schedule" ? "extract_schedule" : "chat";
  const targetEvent = parseTargetEvent(body.targetEvent);
  const targetBlock = buildTargetEventSystemBlock(targetEvent);

  const todayLocal =
    typeof body.todayLocal === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.todayLocal.trim())
      ? body.todayLocal.trim()
      : undefined;
  const todayBlock =
    action === "extract_schedule" && todayLocal
      ? `\n\nHOY_REFERENCIA (fecha local del alumno, ISO): ${todayLocal}. Solo como último recurso si no hay fecha de inicio acordada ni fechas explícitas en el plan.`
      : "";

  const startDateHint =
    typeof body.startDateHint === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(body.startDateHint.trim())
      ? body.startDateHint.trim()
      : undefined;
  const startHintBlock =
    action === "extract_schedule" && startDateHint
      ? `\n\nFECHA_DE_INICIO_EN_CHAT (ISO, inferida por la app desde lo que dijo el usuario o el asistente): ${startDateHint}. Si el plan es una secuencia de días consecutivos desde el comienzo, el primer "date" en "days" debe ser esta fecha (salvo que el propio texto del asistente liste ya otras fechas concretas día a día). No sustituyas esto por HOY_REFERENCIA ni por un reparto hacia atrás desde el examen si contradice la intención de inicio.`
      : "";

  const systemText =
    action === "extract_schedule"
      ? `${EXTRACT_SYSTEM}${todayBlock}${startHintBlock}${targetBlock}`
      : `${STUDY_COACH_SYSTEM}\n\nNombre del plan del estudiante: «${planTitle || "Sin título"}».${targetBlock}`;

  const openRouterMessages = toOpenRouterMessages(messages, systemText);

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": referer,
      "X-Title": "IEStudio Study Planner",
    },
    body: JSON.stringify({
      model,
      messages: openRouterMessages,
      temperature: action === "extract_schedule" ? 0.2 : 0.7,
      max_tokens: 8192,
    }),
  });

  const rawText = await res.text();
  let data: unknown;
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    return NextResponse.json(
      { error: "Respuesta no JSON del proveedor", detail: rawText.slice(0, 500) },
      { status: 502 },
    );
  }

  if (!res.ok) {
    return openRouterFailureResponse(res.status, data, rawText);
  }

  const text = extractAssistantText(data);
  if (!text?.trim()) {
    return NextResponse.json({ error: "El modelo no devolvió texto" }, { status: 502 });
  }

  if (action === "extract_schedule") {
    const schedule = parseScheduleJson(text);
    if (!schedule) {
      return NextResponse.json(
        { error: "No se pudo interpretar el JSON del plan", raw: text.slice(0, 2000) },
        { status: 422 },
      );
    }
    return NextResponse.json({ schedule });
  }

  return NextResponse.json({ text });
}
