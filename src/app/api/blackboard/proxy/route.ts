export const runtime = "nodejs";

/**
 * Server-side proxy for Blackboard Learn REST API.
 * The browser sends: { baseUrl, path, cookieHeader }
 * This route fetches the Blackboard endpoint with the user's cookie/token
 * and returns the JSON response (avoids CORS issues with cross-origin cookies).
 */
export async function POST(req: Request) {
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
  const baseUrl =
    typeof o.baseUrl === "string" ? o.baseUrl.trim().replace(/\/+$/, "") : "";
  const path = typeof o.path === "string" ? o.path.trim() : "";
  const cookieHeader =
    typeof o.cookieHeader === "string" ? o.cookieHeader : "";

  if (!baseUrl || !path) {
    return Response.json(
      { error: "baseUrl y path son obligatorios" },
      { status: 400 },
    );
  }

  try {
    new URL(baseUrl);
  } catch {
    return Response.json({ error: "baseUrl no es una URL válida" }, { status: 400 });
  }

  if (!path.startsWith("/")) {
    return Response.json(
      { error: "path debe empezar con /" },
      { status: 400 },
    );
  }

  const targetUrl = `${baseUrl}${path}`;

  const headers: HeadersInit = {
    Accept: "application/json",
  };
  if (cookieHeader) {
    headers["Cookie"] = cookieHeader;
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: "GET",
      headers,
      redirect: "follow",
    });

    const contentType = upstream.headers.get("content-type") ?? "";

    if (!upstream.ok) {
      const text = await upstream.text();
      return Response.json(
        {
          error: `Blackboard respondió ${upstream.status}`,
          detail: text.slice(0, 1000),
        },
        { status: upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502 },
      );
    }

    if (contentType.includes("json")) {
      const data = await upstream.json();
      return Response.json(data);
    }

    const text = await upstream.text();
    return new Response(text, {
      status: 200,
      headers: { "Content-Type": contentType || "text/plain" },
    });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Error al conectar con Blackboard";
    return Response.json(
      { error: "Error de conexión con Blackboard", detail: message },
      { status: 502 },
    );
  }
}
