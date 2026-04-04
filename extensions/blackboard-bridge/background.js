/**
 * Recibe mensajes desde IEStudio (externally_connectable) y delega al content script
 * de una pestaña de Blackboard con sesión activa.
 */

function originPattern(baseUrl) {
  try {
    const u = new URL(baseUrl);
    return `${u.origin}/*`;
  } catch {
    return "https://blackboard.ie.edu/*";
  }
}

async function ensureContentAndFetch(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "BB_PING" });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
    } catch (e) {
      return {
        ok: false,
        error: "INJECT_FAILED",
        message:
          "No se pudo inyectar el script en la pestaña de Blackboard. Recarga la página de Blackboard e inténtalo de nuevo.",
        detail: String(e && e.message ? e.message : e),
      };
    }
  }

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          error: "TAB_MESSAGE",
          message: chrome.runtime.lastError.message,
        });
        return;
      }
      resolve(resp);
    });
  });
}

async function handleBbFetch(path, baseUrl) {
  const pattern = originPattern(baseUrl);
  let tabs = await chrome.tabs.query({ url: pattern });

  if (!tabs.length) {
    const all = await chrome.tabs.query({});
    tabs = all.filter((t) => {
      try {
        if (!t.url) return false;
        const u = new URL(t.url);
        const b = new URL(baseUrl);
        return u.origin === b.origin;
      } catch {
        return false;
      }
    });
  }

  if (!tabs.length) {
    return {
      ok: false,
      error: "NO_TAB",
      message:
        "No hay ninguna pestaña abierta con Blackboard en este origen. Abre Blackboard, inicia sesión y vuelve a sincronizar.",
    };
  }

  const tabId = tabs[0].id;
  const fetchResult = await ensureContentAndFetch(tabId, {
    type: "BB_FETCH",
    path,
    baseUrl: baseUrl.replace(/\/+$/, ""),
  });

  if (!fetchResult || fetchResult.error) {
    return fetchResult;
  }

  if (!fetchResult.ok) {
    const hint =
      fetchResult.status === 401 || fetchResult.status === 403
        ? " Sesión caducada o falta token CSRF: recarga la pestaña de Blackboard e inicia sesión de nuevo."
        : "";
    return {
      ok: false,
      error: "HTTP",
      status: fetchResult.status,
      message: `Blackboard respondió ${fetchResult.status}.${hint}`,
      body: fetchResult.body,
    };
  }

  return { ok: true, body: fetchResult.body };
}

async function handleBbAuth(baseUrl) {
  const pattern = originPattern(baseUrl);
  let tabs = await chrome.tabs.query({ url: pattern });

  if (!tabs.length) {
    const all = await chrome.tabs.query({});
    tabs = all.filter((t) => {
      try {
        if (!t.url) return false;
        const u = new URL(t.url);
        const b = new URL(baseUrl);
        return u.origin === b.origin;
      } catch {
        return false;
      }
    });
  }

  if (!tabs.length) {
    return {
      ok: false,
      error: "NO_TAB",
      message:
        "No hay ninguna pestaña abierta con Blackboard en este origen. Abre Blackboard, inicia sesión y vuelve a intentarlo.",
    };
  }

  const tabId = tabs[0].id;
  const tabAuth = await ensureContentAndFetch(tabId, { type: "BB_AUTH" });
  if (!tabAuth || tabAuth.ok !== true) {
    return tabAuth;
  }

  let cookieHeader = "";
  try {
    const origin = new URL(baseUrl).origin;
    const jar = await chrome.cookies.getAll({ url: origin });
    cookieHeader = jar
      .filter((c) => c && c.name)
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  } catch {
    cookieHeader = "";
  }

  return {
    ok: true,
    cookieHeader: cookieHeader || tabAuth.cookieHeader || "",
    xsrfToken: tabAuth.xsrfToken || "",
  };
}

chrome.runtime.onMessageExternal.addListener((request, _sender, sendResponse) => {
  if (!request || typeof request !== "object") {
    sendResponse({ ok: false, error: "BAD_REQUEST" });
    return false;
  }

  if (request.type === "BB_PING") {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return false;
  }

  if (request.type === "BB_API") {
    const path = request.path;
    const baseUrl = request.baseUrl;
    if (typeof path !== "string" || !path.startsWith("/")) {
      sendResponse({ ok: false, error: "INVALID_PATH" });
      return false;
    }
    if (typeof baseUrl !== "string" || !baseUrl.startsWith("http")) {
      sendResponse({ ok: false, error: "INVALID_BASE" });
      return false;
    }

    handleBbFetch(path, baseUrl).then(sendResponse);
    return true;
  }

  if (request.type === "BB_AUTH") {
    const baseUrl = request.baseUrl;
    if (typeof baseUrl !== "string" || !baseUrl.startsWith("http")) {
      sendResponse({ ok: false, error: "INVALID_BASE" });
      return false;
    }
    handleBbAuth(baseUrl).then(sendResponse);
    return true;
  }

  sendResponse({ ok: false, error: "UNKNOWN_TYPE" });
  return false;
});
