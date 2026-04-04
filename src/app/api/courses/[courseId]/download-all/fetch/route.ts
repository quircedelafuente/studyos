export const runtime = "nodejs";

/**
 * Descarga un binario de Blackboard usando la sesión del usuario (evita CORS).
 * Solo se permiten URLs del mismo origen que baseUrl (mitigación SSRF).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  await params; // reservado por si en el futuro acotamos por curso
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const o = body as Record<string, unknown>;
  const target =
    typeof o.url === "string" ? o.url.trim() : "";
  const baseUrl = (
    typeof o.baseUrl === "string" ? o.baseUrl : ""
  )
    .trim()
    .replace(/\/+$/, "");
  const cookieHeader =
    typeof o.cookieHeader === "string" ? o.cookieHeader : "";
  const xsrfToken =
    typeof o.xsrfToken === "string" ? o.xsrfToken : "";

  if (!target || !baseUrl) {
    return Response.json(
      { error: "url y baseUrl son obligatorios" },
      { status: 400 },
    );
  }

  let parsed: URL;
  let baseParsed: URL;
  try {
    parsed = new URL(target);
    baseParsed = new URL(baseUrl);
  } catch {
    return Response.json({ error: "URL inválida" }, { status: 400 });
  }

  if (parsed.origin !== baseParsed.origin) {
    return Response.json(
      { error: "La URL no pertenece al dominio de Blackboard indicado" },
      { status: 403 },
    );
  }

  const headers: HeadersInit = {};
  if (cookieHeader) headers["Cookie"] = cookieHeader;
  if (xsrfToken) headers["X-Blackboard-xsrf-token"] = xsrfToken;

  try {
    const upstream = await fetch(target, {
      method: "GET",
      headers,
      redirect: "follow",
    });
    if (!upstream.ok) {
      const text = await upstream.text();
      return Response.json(
        {
          error: `Blackboard ${upstream.status}`,
          detail: text.slice(0, 500),
        },
        { status: upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502 },
      );
    }
    const ct =
      upstream.headers.get("content-type") ?? "application/octet-stream";
    return new Response(upstream.body, {
      status: 200,
      headers: { "Content-Type": ct },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "fetch falló";
    return Response.json({ error: "Error al descargar", detail }, { status: 502 });
  }
}
