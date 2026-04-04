import type { DeadlineTag } from "@/types/dashboard";

export const DEADLINE_TAGS_STORAGE_KEY = "iestudio-deadline-tags";

export const DEADLINE_TAGS_CHANGED_EVENT = "iestudio-deadline-tags-changed";

function normalizeLabel(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, 48);
}

export function loadDeadlineTags(): DeadlineTag[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DEADLINE_TAGS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: DeadlineTag[] = [];
    for (const item of parsed) {
      if (item === null || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      if (typeof o.id !== "string" || typeof o.label !== "string") continue;
      const label = normalizeLabel(o.label);
      if (!label) continue;
      out.push({
        id: o.id,
        label,
        createdAt: typeof o.createdAt === "string" ? o.createdAt : new Date(0).toISOString(),
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function saveDeadlineTags(tags: DeadlineTag[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEADLINE_TAGS_STORAGE_KEY, JSON.stringify(tags));
    window.dispatchEvent(new CustomEvent(DEADLINE_TAGS_CHANGED_EVENT));
  } catch {
    // quota
  }
}

/** Busca por etiqueta igual ignorando mayúsculas; si no existe, crea y persiste. */
export function findOrCreateDeadlineTag(rawLabel: string): DeadlineTag | null {
  const label = normalizeLabel(rawLabel);
  if (!label) return null;
  const tags = loadDeadlineTags();
  const lower = label.toLowerCase();
  const existing = tags.find((t) => t.label.toLowerCase() === lower);
  if (existing) return existing;
  const next: DeadlineTag = {
    id: crypto.randomUUID(),
    label,
    createdAt: new Date().toISOString(),
  };
  saveDeadlineTags([...tags, next]);
  return next;
}

export function tagById(id: string): DeadlineTag | undefined {
  return loadDeadlineTags().find((t) => t.id === id);
}
