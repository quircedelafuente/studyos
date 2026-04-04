/**
 * Base URL del FastAPI NotebookLM (Railway en prod, localhost en dev).
 * Sin barra final.
 */
export function getNotebookLmBackendBase(): string {
  const fromEnv = process.env.NOTEBOOKLM_BACKEND_URL?.trim();
  if (fromEnv) {
    try {
      const u = new URL(fromEnv);
      return `${u.protocol}//${u.host}`;
    } catch {
      return fromEnv.replace(/\/+$/, "");
    }
  }
  return "http://127.0.0.1:8000";
}

export function isNotebookLmBackendConfigured(): boolean {
  return Boolean(process.env.NOTEBOOKLM_BACKEND_URL?.trim());
}
