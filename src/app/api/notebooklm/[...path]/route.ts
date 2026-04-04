export const runtime = "nodejs";

import {
  getNotebookLmBackendBase,
  isNotebookLmBackendConfigured,
} from "@/lib/notebooklm-backend-url";

async function proxy(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const backendPath = url.pathname.replace(/^\/api\/notebooklm/, "") || "/";
  const base = getNotebookLmBackendBase();
  const target = `${base}${backendPath}${url.search}`;

  const onVercel = Boolean(process.env.VERCEL);
  if (onVercel && !isNotebookLmBackendConfigured()) {
    return Response.json(
      {
        error:
          "NOTEBOOKLM_BACKEND_URL no está definida en Vercel (Settings → Environment Variables).",
        detail:
          "Añade NOTEBOOKLM_BACKEND_URL con la URL https de tu backend en Railway y vuelve a desplegar.",
        code: "BACKEND_NOT_CONFIGURED",
      },
      { status: 503 },
    );
  }

  try {
    const headers = new Headers();
    const contentType = req.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    const accept = req.headers.get("accept");
    if (accept) headers.set("accept", accept);
    const requestId = req.headers.get("x-request-id");
    if (requestId) headers.set("x-request-id", requestId);

    const res = await fetch(target, {
      method: req.method,
      headers,
      body:
        req.method !== "GET" && req.method !== "HEAD"
          ? await req.arrayBuffer()
          : undefined,
      redirect: "follow",
      cache: "no-store",
    });

    const responseHeaders = new Headers();
    const resContentType = res.headers.get("content-type");
    if (resContentType) responseHeaders.set("content-type", resContentType);
    const disposition = res.headers.get("content-disposition");
    if (disposition) responseHeaders.set("content-disposition", disposition);
    const cacheControl = res.headers.get("cache-control");
    if (cacheControl) responseHeaders.set("cache-control", cacheControl);
    const etag = res.headers.get("etag");
    if (etag) responseHeaders.set("etag", etag);

    return new Response(res.body, {
      status: res.status,
      headers: responseHeaders,
    });
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e);
    console.error("[notebooklm proxy] fetch failed:", cause, { target });
    const hint = onVercel
      ? "No se pudo conectar con el backend. Revisa NOTEBOOKLM_BACKEND_URL (https, sin barra final), que Railway tenga dominio público y redeploy en Vercel."
      : "Backend no responde. Arranca el API con npm run notebooklm:backend o define NOTEBOOKLM_BACKEND_URL.";
    return Response.json(
      {
        error: hint,
        detail: `${hint} (${cause})`,
        code: "BACKEND_UNAVAILABLE",
      },
      { status: 503 },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const DELETE = proxy;
export const PUT = proxy;
export const PATCH = proxy;
