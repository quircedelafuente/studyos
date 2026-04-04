/**
 * Comunicación con la extensión MV3 «IEStudio — puente Blackboard».
 * La página debe estar en `externally_connectable` del manifest de la extensión.
 */

import { loadBbConfig } from "@/lib/blackboard-config";

export function getBlackboardBridgeExtensionId(): string | undefined {
  const env =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_BB_BRIDGE_EXTENSION_ID?.trim()
      : undefined;
  if (env) return env;
  const stored = typeof window !== "undefined" ? loadBbConfig()?.extensionId?.trim() : undefined;
  if (stored) return stored;
  return undefined;
}

export function isBlackboardBridgeConfigured(): boolean {
  return Boolean(getBlackboardBridgeExtensionId());
}

type ChromeRuntimeSendMessage = {
  sendMessage: (
    extensionId: string,
    message: unknown,
    responseCallback?: (response: unknown) => void,
  ) => void;
  lastError?: { message?: string };
};

function getChromeRuntime(): ChromeRuntimeSendMessage | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as Window & {
    chrome?: { runtime?: ChromeRuntimeSendMessage };
  };
  return w.chrome?.runtime;
}

export function isBlackboardBridgeRuntimeAvailable(): boolean {
  return Boolean(
    getBlackboardBridgeExtensionId() && getChromeRuntime()?.sendMessage,
  );
}

export async function pingBlackboardBridge(): Promise<boolean> {
  const id = getBlackboardBridgeExtensionId();
  const rt = getChromeRuntime();
  if (!id || !rt?.sendMessage) return false;
  return new Promise((resolve) => {
    try {
      rt.sendMessage(id, { type: "BB_PING" }, (response: unknown) => {
        if (rt.lastError?.message) {
          resolve(false);
          return;
        }
        const r = response as { ok?: boolean } | undefined;
        resolve(r?.ok === true);
      });
    } catch {
      resolve(false);
    }
  });
}

/**
 * Ejecuta GET path (p. ej. /learn/api/public/v1/users/me/courses) vía extensión.
 */
export async function bridgeBlackboardFetch<T = unknown>(
  path: string,
  baseUrl: string,
): Promise<T> {
  const id = getBlackboardBridgeExtensionId();
  const rt = getChromeRuntime();
  if (!id || !rt?.sendMessage) {
    throw new Error(
      "Falta el ID de la extensión puente. En Ajustes de Blackboard pega el ID que ves en chrome://extensions (Modo desarrollador), o define NEXT_PUBLIC_BB_BRIDGE_EXTENSION_ID en .env.local y reinicia npm run dev. Carga la carpeta extensions/blackboard-bridge como extensión descomprimida.",
    );
  }

  return new Promise((resolve, reject) => {
    rt.sendMessage(
      id,
      { type: "BB_API", path, baseUrl: baseUrl.replace(/\/+$/, "") },
      (response: unknown) => {
        if (rt.lastError?.message) {
          reject(new Error(rt.lastError.message));
          return;
        }
        const r = response as {
          ok?: boolean;
          error?: string;
          message?: string;
          body?: T;
          status?: number;
        };
        if (!r || r.ok !== true) {
          const msg =
            r?.message ??
            (r?.error === "NO_TAB"
              ? "Abre Blackboard en una pestaña e inicia sesión, luego vuelve a sincronizar."
              : r?.error === "HTTP"
                ? `Error HTTP ${r.status ?? ""}`
                : r?.error ?? "Error del puente Blackboard");
          reject(new Error(msg));
          return;
        }
        resolve(r.body as T);
      },
    );
  });
}

export async function bridgeBlackboardAuthSnapshot(baseUrl: string): Promise<{
  cookieHeader: string;
  xsrfToken: string;
}> {
  const id = getBlackboardBridgeExtensionId();
  const rt = getChromeRuntime();
  if (!id || !rt?.sendMessage) {
    throw new Error("Puente Blackboard no disponible.");
  }

  return new Promise((resolve, reject) => {
    rt.sendMessage(
      id,
      { type: "BB_AUTH", baseUrl: baseUrl.replace(/\/+$/, "") },
      (response: unknown) => {
        if (rt.lastError?.message) {
          reject(new Error(rt.lastError.message));
          return;
        }
        const r = response as {
          ok?: boolean;
          error?: string;
          message?: string;
          cookieHeader?: string;
          xsrfToken?: string;
        };
        if (!r || r.ok !== true) {
          reject(new Error(r?.message ?? r?.error ?? "No se pudo leer auth de Blackboard."));
          return;
        }
        resolve({
          cookieHeader: typeof r.cookieHeader === "string" ? r.cookieHeader : "",
          xsrfToken: typeof r.xsrfToken === "string" ? r.xsrfToken : "",
        });
      },
    );
  });
}
