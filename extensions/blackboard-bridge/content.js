/**
 * Ejecuta fetch en el origen de Blackboard → cookies de sesión y mismo sitio que el LMS.
 * Descubre cabeceras anti-CSRF comunes (Ultra / Learn).
 */
(function () {
  const XSRF_TTL_MS = 5 * 60 * 1000;
  let cachedXsrf = null;
  let cachedXsrfAt = 0;

  function parseCookieValue(raw) {
    try {
      return decodeURIComponent(raw.trim());
    } catch {
      return raw.trim();
    }
  }

  function extractXsrfFromDocument() {
    const meta =
      document.querySelector('meta[name="blackboard-csrf-token"]') ||
      document.querySelector('meta[name="csrf-token"]');
    if (meta && meta.getAttribute("content")) {
      return meta.getAttribute("content");
    }
    return null;
  }

  function extractXsrfFromCookieString() {
    const parts = document.cookie.split(";");
    for (const p of parts) {
      const eq = p.indexOf("=");
      if (eq < 0) continue;
      const name = p.slice(0, eq).trim();
      const value = parseCookieValue(p.slice(eq + 1));
      if (!value) continue;
      if (/xsrf|csrf/i.test(name) && value.length < 200) {
        return value;
      }
      if (name === "BbRouter" || /^Bb\w*Router$/i.test(name)) {
        try {
          const j = JSON.parse(value);
          if (typeof j === "object" && j) {
            if (j.xsrfToken) return j.xsrfToken;
            if (j.XSRFToken) return j.XSRFToken;
            if (j.token) return j.token;
          }
        } catch {
          /* not JSON */
        }
      }
    }
    return null;
  }

  async function discoverAuthHeaders() {
    if (cachedXsrf && Date.now() - cachedXsrfAt < XSRF_TTL_MS) {
      return { "X-Blackboard-xsrf-token": cachedXsrf };
    }
    let token = extractXsrfFromDocument() || extractXsrfFromCookieString();
    if (token) {
      cachedXsrf = token;
      cachedXsrfAt = Date.now();
      return { "X-Blackboard-xsrf-token": token };
    }
    return {};
  }

  function buildAuthSnapshot() {
    const token = extractXsrfFromDocument() || extractXsrfFromCookieString();
    return {
      cookieHeader: document.cookie || "",
      xsrfToken: token || "",
    };
  }

  async function doFetch(path, baseUrl) {
    const origin = (baseUrl || location.origin).replace(/\/+$/, "");
    const url = origin + path;
    const auth = await discoverAuthHeaders();
    const headers = {
      Accept: "application/json",
      ...auth,
    };

    let res = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers,
    });

    if ((res.status === 401 || res.status === 403) && !auth["X-Blackboard-xsrf-token"]) {
      cachedXsrf = null;
      const retryAuth = await discoverAuthHeaders();
      if (retryAuth["X-Blackboard-xsrf-token"]) {
        res = await fetch(url, {
          method: "GET",
          credentials: "include",
          headers: {
            Accept: "application/json",
            ...retryAuth,
          },
        });
      }
    }

    const ct = res.headers.get("content-type") || "";
    const text = await res.text();
    let body = text;
    if (ct.includes("json")) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { _parseError: true, raw: text.slice(0, 500) };
      }
    }

    return {
      ok: res.ok,
      status: res.status,
      contentType: ct,
      body,
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "BB_PING") {
      sendResponse({ ok: true, origin: location.origin });
      return false;
    }
    if (msg && msg.type === "BB_FETCH") {
      doFetch(msg.path, msg.baseUrl)
        .then(sendResponse)
        .catch((e) =>
          sendResponse({
            ok: false,
            status: 0,
            body: String(e && e.message ? e.message : e),
          }),
        );
      return true;
    }
    if (msg && msg.type === "BB_AUTH") {
      try {
        sendResponse({ ok: true, ...buildAuthSnapshot() });
      } catch (e) {
        sendResponse({
          ok: false,
          error: "AUTH_SNAPSHOT_FAILED",
          message: String(e && e.message ? e.message : e),
        });
      }
      return false;
    }
    return false;
  });
})();
