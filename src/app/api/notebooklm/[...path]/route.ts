export const runtime = "nodejs";

const BACKEND = process.env.NOTEBOOKLM_BACKEND_URL ?? "http://localhost:8000";

async function proxy(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const backendPath = url.pathname.replace(/^\/api\/notebooklm/, "") || "/";
  const target = `${BACKEND}${backendPath}${url.search}`;

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
  } catch {
    return Response.json(
      {
        error:
          "Backend not running. Start it with: cd backend && uvicorn main:app --port 8000",
        detail:
          "Backend not running. Start it with: cd backend && uvicorn main:app --port 8000",
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
