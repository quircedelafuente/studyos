"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  loadStudyArenaState,
  saveStudyArenaState,
  STUDY_ARENA_CHANGED_EVENT,
  STUDY_ARENA_STORAGE_KEY,
} from "@/lib/study-arena-storage";

export type StudyArenaSessionOption = {
  key: string;
  planId: string;
  planTitle: string;
  date: string; // YYYY-MM-DD (local)
  studyHours: number;
  focus: string;
  sessionTitle?: string;
};

type StudyArenaActiveSession = StudyArenaSessionOption & {
  /** Identificador único por cada vez que se inicia una sesión (Parking Lot / resumen al terminar). */
  arenaRunId: string;
  totalDurationMs: number;
  startedAtMs: number;
  /**
   * Tiempo activo ya acumulado (excluye pausas).
   * Se complementa con (now - segmentStartMs) cuando está corriendo.
   */
  elapsedActiveMs: number;
  /** Inicio del segmento actual activo (null si está pausado). */
  segmentStartMs: number | null;
  paused: boolean;
  distractionCount: number;
  focusScore: number; // 0..100
  lastInteractionMs: number;
};

type FalseSessionPrompt = {
  reason: "too_short" | "too_long";
  mode: "active" | "ended";
};

type StudyArenaContextValue = {
  activeSession: StudyArenaActiveSession | null;
  timeRemainingMs: number;
  progressPct: number;

  paused: boolean;
  distractionCount: number;
  focusScore: number;

  falseSessionPrompt: FalseSessionPrompt | null;

  startSession: (opt: StudyArenaSessionOption) => void;
  togglePause: () => void;
  addDistraction: () => void;
  finalizeSession: () => void;

  /** Cierra el prompt y reanuda (solo si era un prompt en sesión activa). */
  confirmFalseSession: () => void;
  /** Reinicia la sesión con el mismo objetivo. */
  restartFalseSession: () => void;

  /** Oculta el widget flotante (p. ej. en la propia pantalla Study Arena). */
  suppressFloatingWidget: boolean;
  setSuppressFloatingWidget: (value: boolean) => void;
};

const StudyArenaContext = createContext<StudyArenaContextValue | null>(null);

const SESSION_STORAGE_FOCUS_SCORE_START = 100;
const SESSION_FOCUS_SCORE_DECREMENT_PER_DISTRACTION = 10;

const FALSE_SESSION_NO_INTERACTION_MS = 2 * 60 * 60 * 1000; // 2h
const FALSE_SESSION_TOO_SHORT_MS = 5 * 60 * 1000; // 5 min

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function toActiveSession(raw: unknown): StudyArenaActiveSession | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const key = typeof o.key === "string" ? o.key : null;
  const planId = typeof o.planId === "string" ? o.planId : null;
  const planTitle = typeof o.planTitle === "string" ? o.planTitle : null;
  const date = typeof o.date === "string" ? o.date : null;
  const studyHours =
    typeof o.studyHours === "number" && Number.isFinite(o.studyHours) ? o.studyHours : null;
  const focus = typeof o.focus === "string" ? o.focus : "";
  const arenaRunId = typeof o.arenaRunId === "string" ? o.arenaRunId : null;
  const totalDurationMs =
    typeof o.totalDurationMs === "number" && Number.isFinite(o.totalDurationMs)
      ? o.totalDurationMs
      : null;
  const startedAtMs =
    typeof o.startedAtMs === "number" && Number.isFinite(o.startedAtMs) ? o.startedAtMs : null;
  const elapsedActiveMs =
    typeof o.elapsedActiveMs === "number" && Number.isFinite(o.elapsedActiveMs)
      ? o.elapsedActiveMs
      : null;
  const segmentStartMs =
    o.segmentStartMs === null
      ? null
      : typeof o.segmentStartMs === "number" && Number.isFinite(o.segmentStartMs)
        ? o.segmentStartMs
        : null;
  const paused = typeof o.paused === "boolean" ? o.paused : false;
  const distractionCount =
    typeof o.distractionCount === "number" && Number.isFinite(o.distractionCount)
      ? Math.max(0, Math.floor(o.distractionCount))
      : 0;
  const focusScore =
    typeof o.focusScore === "number" && Number.isFinite(o.focusScore)
      ? clamp(o.focusScore, 0, 100)
      : SESSION_STORAGE_FOCUS_SCORE_START;
  const lastInteractionMs =
    typeof o.lastInteractionMs === "number" && Number.isFinite(o.lastInteractionMs)
      ? o.lastInteractionMs
      : Date.now();

  if (
    key == null ||
    planId == null ||
    planTitle == null ||
    date == null ||
    studyHours == null ||
    arenaRunId == null ||
    totalDurationMs == null ||
    startedAtMs == null ||
    elapsedActiveMs == null
  ) {
    return null;
  }

  return {
    key,
    planId,
    planTitle,
    date,
    studyHours,
    focus,
    sessionTitle: typeof o.sessionTitle === "string" ? o.sessionTitle : undefined,
    arenaRunId,
    totalDurationMs,
    startedAtMs,
    elapsedActiveMs,
    segmentStartMs,
    paused,
    distractionCount,
    focusScore,
    lastInteractionMs,
  };
}

function toFalsePrompt(raw: unknown): FalseSessionPrompt | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const reason = o.reason;
  const mode = o.mode;
  if (
    (reason !== "too_short" && reason !== "too_long") ||
    (mode !== "active" && mode !== "ended")
  ) {
    return null;
  }
  return { reason, mode };
}

function computeElapsedActiveMs(s: StudyArenaActiveSession, nowMs: number): number {
  if (s.paused || s.segmentStartMs == null) return s.elapsedActiveMs;
  return s.elapsedActiveMs + (nowMs - s.segmentStartMs);
}

function computeTimeRemainingMs(s: StudyArenaActiveSession, nowMs: number): number {
  const elapsed = computeElapsedActiveMs(s, nowMs);
  const rem = s.totalDurationMs - elapsed;
  return rem > 0 ? rem : 0;
}

function computeProgressPct(s: StudyArenaActiveSession, nowMs: number): number {
  const elapsed = computeElapsedActiveMs(s, nowMs);
  const pct = (elapsed / Math.max(1, s.totalDurationMs)) * 100;
  return clamp(pct, 0, 100);
}

function pauseSessionState(s: StudyArenaActiveSession, nowMs: number, bumpInteraction: boolean) {
  const elapsedActiveMs = computeElapsedActiveMs(s, nowMs);
  return {
    ...s,
    paused: true,
    segmentStartMs: null,
    elapsedActiveMs,
    lastInteractionMs: bumpInteraction ? nowMs : s.lastInteractionMs,
  };
}

function resumeSessionState(s: StudyArenaActiveSession, nowMs: number) {
  return {
    ...s,
    paused: false,
    segmentStartMs: nowMs,
    lastInteractionMs: nowMs,
  };
}

function restartSessionState(s: StudyArenaActiveSession, nowMs: number) {
  return {
    ...s,
    arenaRunId: crypto.randomUUID(),
    paused: false,
    segmentStartMs: nowMs,
    startedAtMs: nowMs,
    elapsedActiveMs: 0,
    distractionCount: 0,
    focusScore: SESSION_STORAGE_FOCUS_SCORE_START,
    lastInteractionMs: nowMs,
  };
}

export function StudyArenaProvider({ children }: { children: React.ReactNode }) {
  const [activeSession, setActiveSession] = useState<StudyArenaActiveSession | null>(() => {
    const saved = loadStudyArenaState();
    return toActiveSession(saved?.activeSession ?? null);
  });
  const [falseSessionPrompt, setFalseSessionPrompt] = useState<FalseSessionPrompt | null>(() => {
    const saved = loadStudyArenaState();
    return toFalsePrompt(saved?.falseSessionPrompt ?? null);
  });
  const [suppressFloatingWidget, setSuppressFloatingWidget] = useState(() => {
    const saved = loadStudyArenaState();
    return Boolean(saved?.suppressFloatingWidget);
  });
  const [tickNowMs, setTickNowMs] = useState(() => Date.now());

  const activeSessionRef = useRef<StudyArenaActiveSession | null>(null);
  const promptRef = useRef(falseSessionPrompt);

  const activeSessionKey = activeSession?.key ?? null;

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  useEffect(() => {
    promptRef.current = falseSessionPrompt;
  }, [falseSessionPrompt]);

  useEffect(() => {
    saveStudyArenaState({
      activeSession,
      falseSessionPrompt,
      suppressFloatingWidget,
    });
  }, [activeSession, falseSessionPrompt, suppressFloatingWidget]);

  useEffect(() => {
    const reloadFromStorage = () => {
      const saved = loadStudyArenaState();
      if (!saved) {
        setActiveSession(null);
        setFalseSessionPrompt(null);
        setSuppressFloatingWidget(false);
        return;
      }
      setActiveSession(toActiveSession(saved.activeSession));
      setFalseSessionPrompt(toFalsePrompt(saved.falseSessionPrompt));
      setSuppressFloatingWidget(Boolean(saved.suppressFloatingWidget));
    };
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === null || ev.key === STUDY_ARENA_STORAGE_KEY) {
        reloadFromStorage();
      }
    };
    window.addEventListener(STUDY_ARENA_CHANGED_EVENT, reloadFromStorage);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(STUDY_ARENA_CHANGED_EVENT, reloadFromStorage);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const derived = useMemo(() => {
    if (!activeSession) {
      return {
        timeRemainingMs: 0,
        progressPct: 0,
        paused: false,
        distractionCount: 0,
        focusScore: SESSION_STORAGE_FOCUS_SCORE_START,
      };
    }
    return {
      timeRemainingMs: computeTimeRemainingMs(activeSession, tickNowMs),
      progressPct: computeProgressPct(activeSession, tickNowMs),
      paused: activeSession.paused,
      distractionCount: activeSession.distractionCount,
      focusScore: activeSession.focusScore,
    };
  }, [activeSession, tickNowMs]);

  // Mantiene los cálculos actualizados (reloj + progreso + detección automática).
  useEffect(() => {
    if (!activeSessionKey) return;

    let cancelled = false;
    const id = window.setInterval(() => {
      if (cancelled) return;
      setTickNowMs(Date.now());
    }, 500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [activeSessionKey]);

  const endInProgressRef = useRef(false);

  // Detección automática de "falsa sesión" por inactividad (2h).
  useEffect(() => {
    const s = activeSession;
    if (!s) return;
    if (falseSessionPrompt) return;

    const nowMs = tickNowMs;
    const sinceLastInteraction = nowMs - s.lastInteractionMs;
    if (sinceLastInteraction < FALSE_SESSION_NO_INTERACTION_MS) return;
    // Pausamos para que el usuario pueda responder.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveSession((prev) => {
      if (!prev) return prev;
      return pauseSessionState(prev, nowMs, false);
    });
    setFalseSessionPrompt({ reason: "too_long", mode: "active" });
  }, [activeSession, falseSessionPrompt, tickNowMs]);

  // Detectar fin por tiempo (cuando el contador llega a 0).
  useEffect(() => {
    const s = activeSession;
    if (!s) return;
    if (falseSessionPrompt) return;

    const nowMs = tickNowMs;
    const elapsed = computeElapsedActiveMs(s, nowMs);
    if (elapsed < s.totalDurationMs) return;

    if (endInProgressRef.current) return;
    endInProgressRef.current = true;

    const shouldPrompt = elapsed < FALSE_SESSION_TOO_SHORT_MS;

    if (!shouldPrompt) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveSession(null);
      setFalseSessionPrompt(null);
      endInProgressRef.current = false;
      return;
    }

    setActiveSession((prev) => {
      if (!prev) return prev;
      return {
        ...pauseSessionState(prev, nowMs, false),
        elapsedActiveMs: prev.totalDurationMs,
      };
    });
    setFalseSessionPrompt({ reason: "too_short", mode: "ended" });
    endInProgressRef.current = false;
  }, [activeSession, falseSessionPrompt, tickNowMs]);

  const startSession = useCallback((opt: StudyArenaSessionOption) => {
    const nowMs = Date.now();
    setFalseSessionPrompt(null);
    setActiveSession({
      ...opt,
      arenaRunId: crypto.randomUUID(),
      totalDurationMs: Math.max(1, Math.round(opt.studyHours * 60 * 60 * 1000)),
      startedAtMs: nowMs,
      elapsedActiveMs: 0,
      segmentStartMs: nowMs,
      paused: false,
      distractionCount: 0,
      focusScore: SESSION_STORAGE_FOCUS_SCORE_START,
      lastInteractionMs: nowMs,
    });
  }, []);

  const togglePause = useCallback(() => {
    const nowMs = Date.now();
    setActiveSession((prev) => {
      if (!prev) return prev;
      if (promptRef.current) return prev;
      if (prev.paused) return resumeSessionState(prev, nowMs);
      return pauseSessionState(prev, nowMs, true);
    });
  }, []);

  const addDistraction = useCallback(() => {
    const nowMs = Date.now();
    setActiveSession((prev) => {
      if (!prev) return prev;
      if (promptRef.current) return prev;
      const nextCount = prev.distractionCount + 1;
      const nextFocus = clamp(
        prev.focusScore - SESSION_FOCUS_SCORE_DECREMENT_PER_DISTRACTION,
        0,
        100,
      );
      return {
        ...prev,
        distractionCount: nextCount,
        focusScore: nextFocus,
        lastInteractionMs: nowMs,
      };
    });
  }, []);

  const finalizeSession = useCallback(() => {
    const nowMs = Date.now();
    if (promptRef.current) return;
    const cur = activeSessionRef.current;
    if (!cur) return;
    const elapsed = computeElapsedActiveMs(cur, nowMs);
    const shortSession = elapsed < FALSE_SESSION_TOO_SHORT_MS;
    setFalseSessionPrompt(null);
    setActiveSession((prev) => {
      if (!prev) return prev;
      if (!shortSession) return null;
      const pausedState = pauseSessionState(prev, nowMs, false);
      return {
        ...pausedState,
        elapsedActiveMs: prev.totalDurationMs,
      };
    });
    if (shortSession) {
      setFalseSessionPrompt({ reason: "too_short", mode: "ended" });
    }
  }, []);

  const confirmFalseSession = useCallback(() => {
    const nowMs = Date.now();
    setFalseSessionPrompt(null);
    setActiveSession((prev) => {
      if (!prev) return prev;
      if (!falseSessionPrompt) return prev;
      if (falseSessionPrompt.mode === "active") return resumeSessionState(prev, nowMs);
      // mode === "ended"
      return null;
    });
  }, [falseSessionPrompt]);

  const restartFalseSession = useCallback(() => {
    const nowMs = Date.now();
    setFalseSessionPrompt(null);
    setActiveSession((prev) => {
      if (!prev) return prev;
      return restartSessionState(prev, nowMs);
    });
  }, []);

  const value = useMemo<StudyArenaContextValue>(
    () => ({
      activeSession,
      timeRemainingMs: derived.timeRemainingMs,
      progressPct: derived.progressPct,
      paused: derived.paused,
      distractionCount: derived.distractionCount,
      focusScore: derived.focusScore,
      falseSessionPrompt,
      startSession,
      togglePause,
      addDistraction,
      finalizeSession,
      confirmFalseSession,
      restartFalseSession,
      suppressFloatingWidget,
      setSuppressFloatingWidget,
    }),
    [
      activeSession,
      derived.timeRemainingMs,
      derived.progressPct,
      derived.paused,
      derived.distractionCount,
      derived.focusScore,
      falseSessionPrompt,
      startSession,
      togglePause,
      addDistraction,
      finalizeSession,
      confirmFalseSession,
      restartFalseSession,
      suppressFloatingWidget,
    ],
  );

  return <StudyArenaContext.Provider value={value}>{children}</StudyArenaContext.Provider>;
}

export function useStudyArena(): StudyArenaContextValue {
  const ctx = useContext(StudyArenaContext);
  if (!ctx) {
    throw new Error("useStudyArena debe usarse dentro de StudyArenaProvider.");
  }
  return ctx;
}

