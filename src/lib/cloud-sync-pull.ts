export const CLOUD_SYNC_PULL_REQUEST_EVENT = "iestudio-cloud-sync-pull-request";

/** Ordena a CloudSyncProvider un GET inmediato desde la nube (sin esperar al intervalo). */
export function requestCloudSyncPull(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CLOUD_SYNC_PULL_REQUEST_EVENT));
}
