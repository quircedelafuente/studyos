export const CLOUD_SYNC_PUSH_REQUEST_EVENT = "iestudio-cloud-sync-push-request";

const DEFAULT_DEBOUNCE_MS = 450;
/** En el navegador `setTimeout` devuelve `number`; evita choque con tipos Node. */
let debounceTimer: number | null = null;

function dispatchCloudSyncPushRequest(): void {
  window.dispatchEvent(new Event(CLOUD_SYNC_PUSH_REQUEST_EVENT));
}

/** Ordena a CloudSyncProvider un PUT inmediato a la nube (sin esperar al intervalo). */
export function requestCloudSyncPush(): void {
  if (typeof window === "undefined") return;
  if (debounceTimer != null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  dispatchCloudSyncPushRequest();
}

/**
 * Agrupa cambios rápidos (p. ej. varios toques en checklist en iOS) antes del PUT.
 * `requestCloudSyncPush` cancela el temporizador y fuerza subida inmediata.
 */
export function requestCloudSyncPushDebounced(
  delayMs: number = DEFAULT_DEBOUNCE_MS,
): void {
  if (typeof window === "undefined") return;
  if (debounceTimer != null) clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    debounceTimer = null;
    dispatchCloudSyncPushRequest();
  }, delayMs);
}
