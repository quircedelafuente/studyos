import type {
  StudyPlan,
  StudyPlanAISchedule,
  StudyPlanChatTurn,
} from "@/types/dashboard";

export const STUDY_PLANS_STORAGE_KEY = "iestudio-study-plans";

export const STUDY_PLANS_CHANGED_EVENT = "iestudio-study-plans-changed";

function normalizeChatMessages(raw: unknown): StudyPlanChatTurn[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: StudyPlanChatTurn[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const role = o.role === "user" || o.role === "model" ? o.role : null;
    if (!role || typeof o.content !== "string" || typeof o.at !== "string") continue;
    out.push({
      role,
      content: o.content.slice(0, 200_000),
      at: o.at,
    });
  }
  return out.length ? out : undefined;
}

function normalizeAiSchedule(raw: unknown): StudyPlanAISchedule | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const totalHoursEstimated =
    typeof o.totalHoursEstimated === "number"
      ? o.totalHoursEstimated
      : o.totalHoursEstimated === null
        ? null
        : null;
  const methodNote = typeof o.methodNote === "string" ? o.methodNote : "";
  const daysRaw = o.days;
  const days: StudyPlanAISchedule["days"] = [];
  if (Array.isArray(daysRaw)) {
    for (const row of daysRaw) {
      if (row === null || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      if (typeof r.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) continue;
      const h =
        typeof r.studyHours === "number"
          ? r.studyHours
          : typeof r.studyHours === "string"
            ? Number(r.studyHours)
            : Number(r.studyHours);
      const studyHours = Number.isFinite(h) ? Math.max(0.25, Math.min(24, h)) : 2;
      const st = r.sessionTitle;
      days.push({
        date: r.date,
        studyHours,
        focus: typeof r.focus === "string" ? r.focus : "",
        ...(typeof st === "string" && st.trim() ? { sessionTitle: st.trim() } : {}),
      });
    }
  }
  const savedAt = typeof o.savedAt === "string" ? o.savedAt : "";
  if (days.length === 0 && !methodNote.trim() && !savedAt) return undefined;
  return {
    totalHoursEstimated,
    methodNote,
    days,
    savedAt,
  };
}

function isStudyPlan(x: unknown): x is StudyPlan {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.title === "string" &&
    typeof o.createdAt === "string" &&
    typeof o.updatedAt === "string"
  );
}

function toStudyPlan(x: unknown): StudyPlan | null {
  if (!isStudyPlan(x)) return null;
  const o = x as Record<string, unknown>;
  const chatMessages = normalizeChatMessages(o.chatMessages);
  const aiSchedule = normalizeAiSchedule(o.aiSchedule);
  const base: StudyPlan = {
    id: o.id as string,
    title: (o.title as string).trim() || "(Sin título)",
    createdAt: o.createdAt as string,
    updatedAt: o.updatedAt as string,
  };
  if (typeof o.targetDeadlineId === "string") {
    const tid = o.targetDeadlineId.trim();
    base.targetDeadlineId = tid.length ? tid : null;
  } else if (o.targetDeadlineId === null) {
    base.targetDeadlineId = null;
  }
  if (chatMessages) base.chatMessages = chatMessages;
  if (aiSchedule) base.aiSchedule = aiSchedule;
  return base;
}

export function loadStudyPlans(): StudyPlan[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STUDY_PLANS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: StudyPlan[] = [];
    for (const item of parsed) {
      const p = toStudyPlan(item);
      if (p) out.push(p);
    }
    return out;
  } catch {
    return [];
  }
}

export function saveStudyPlans(plans: StudyPlan[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STUDY_PLANS_STORAGE_KEY, JSON.stringify(plans));
    window.dispatchEvent(new CustomEvent(STUDY_PLANS_CHANGED_EVENT));
  } catch {
    // quota
  }
}

/** Actualiza un plan por id; si no existe, no hace nada. */
export function patchStudyPlan(id: string, patch: Partial<StudyPlan>): void {
  const all = loadStudyPlans();
  const idx = all.findIndex((p) => p.id === id);
  if (idx === -1) return;
  const prev = all[idx]!;
  const next: StudyPlan = {
    ...prev,
    ...patch,
    id: prev.id,
    createdAt: prev.createdAt,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  };
  all[idx] = next;
  saveStudyPlans(all);
}
