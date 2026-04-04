export const CLOUD_SYNC_PUSH_REQUEST_EVENT = "iestudio-cloud-sync-push-request";

/** Ordena a CloudSyncProvider un PUT inmediato a la nube (sin esperar al intervalo). */
export function requestCloudSyncPush(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CLOUD_SYNC_PUSH_REQUEST_EVENT));
}
