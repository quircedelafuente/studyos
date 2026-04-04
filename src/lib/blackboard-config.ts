import type { BbConfig } from "@/types/blackboard";

const STORAGE_KEY = "iestudio-bb-config";

export const BB_CONFIG_CHANGED = "iestudio-bb-config-changed";

export function loadBbConfig(): BbConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const o = parsed as Record<string, unknown>;
    if (typeof o.baseUrl !== "string" || !o.baseUrl.trim()) return null;
    const extensionId =
      typeof o.extensionId === "string" ? o.extensionId.trim() : "";
    return {
      baseUrl: o.baseUrl.trim().replace(/\/+$/, ""),
      ...(extensionId ? { extensionId } : {}),
    };
  } catch {
    return null;
  }
}

export function saveBbConfig(cfg: BbConfig): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      baseUrl: cfg.baseUrl.trim().replace(/\/+$/, ""),
      ...(cfg.extensionId?.trim()
        ? { extensionId: cfg.extensionId.trim() }
        : {}),
    }),
  );
  window.dispatchEvent(new Event(BB_CONFIG_CHANGED));
}

export function clearBbConfig(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(BB_CONFIG_CHANGED));
}
