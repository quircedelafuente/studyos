export const DEFAULT_COMPANION_ORIGIN = "http://127.0.0.1:16789";

/** Comando recomendado desde la raíz del repo para arrancar el companion WhisperX. */
export const WHISPERX_START_NPM_SCRIPT = "npm run class-notes:companion-whisperx";

export const COMPANION_URL_STORAGE_KEY = "iestudio-class-notes-companion-url";

export function getCompanionBaseUrl(): string {
  if (typeof window === "undefined") return DEFAULT_COMPANION_ORIGIN;
  const s = window.localStorage.getItem(COMPANION_URL_STORAGE_KEY)?.trim();
  return s || DEFAULT_COMPANION_ORIGIN;
}

export function setCompanionBaseUrl(url: string): void {
  window.localStorage.setItem(COMPANION_URL_STORAGE_KEY, url.trim());
}

const COMPANION_HEALTH_MS = 4500;

/**
 * Comprueba si el companion responde en /health (modelo listo).
 * Devuelve false ante fallo de red, timeout o respuesta no OK.
 */
export async function isCompanionReachable(baseUrl: string): Promise<boolean> {
  const origin = baseUrl.replace(/\/$/, "");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), COMPANION_HEALTH_MS);
  try {
    const res = await fetch(`${origin}/health`, {
      method: "GET",
      signal: ctrl.signal,
    });
    if (!res.ok) return false;
    const data: unknown = await res.json().catch(() => null);
    if (typeof data === "object" && data !== null && "ok" in data) {
      return Boolean((data as { ok: unknown }).ok);
    }
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export type CompanionTranscribeResult = {
  text: string;
  language?: string;
};

/**
 * POST multipart al compañero local: campo `audio` (fichero).
 * Respuesta JSON esperada: `{ "text": string, "language"?: string }`
 */
export async function transcribeWithCompanion(
  audioFile: File,
  baseUrl: string,
): Promise<CompanionTranscribeResult> {
  const origin = baseUrl.replace(/\/$/, "");
  const url = `${origin}/transcribe`;
  const form = new FormData();
  form.append("audio", audioFile);
  const res = await fetch(url, {
    method: "POST",
    body: form,
  });
  const raw = await res.text();
  let data: unknown;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(
      res.ok
        ? "El compañero devolvió texto que no es JSON."
        : `Compañero (${res.status}): ${raw.slice(0, 200)}`,
    );
  }
  if (!res.ok) {
    const msg =
      typeof data === "object" && data !== null && "error" in data
        ? String((data as { error: unknown }).error)
        : raw.slice(0, 300);
    throw new Error(msg || `Error ${res.status} del compañero`);
  }
  if (typeof data !== "object" || data === null) {
    throw new Error("Respuesta del compañero inválida");
  }
  const o = data as Record<string, unknown>;
  const text = typeof o.text === "string" ? o.text : "";
  if (!text.trim()) {
    throw new Error("El compañero devolvió transcripción vacía");
  }
  const language =
    typeof o.language === "string" ? o.language : undefined;
  return { text, language };
}
