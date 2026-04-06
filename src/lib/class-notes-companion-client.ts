export const DEFAULT_COMPANION_ORIGIN = "http://127.0.0.1:16789";

export const COMPANION_URL_STORAGE_KEY = "iestudio-class-notes-companion-url";

export function getCompanionBaseUrl(): string {
  if (typeof window === "undefined") return DEFAULT_COMPANION_ORIGIN;
  const s = window.localStorage.getItem(COMPANION_URL_STORAGE_KEY)?.trim();
  return s || DEFAULT_COMPANION_ORIGIN;
}

export function setCompanionBaseUrl(url: string): void {
  window.localStorage.setItem(COMPANION_URL_STORAGE_KEY, url.trim());
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
