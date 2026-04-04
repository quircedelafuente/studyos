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
  const [activeSession, setActiveSession] = useState<StudyArenaActiveSession | null>(null);
  const [falseSessionPrompt, setFalseSessionPrompt] = useState<FalseSessionPrompt | null>(null);
  const [suppressFloatingWidget, setSuppressFloatingWidget] = useState(false);
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
      if (falseSessionPrompt) return prev;
      if (prev.paused) return resumeSessionState(prev, nowMs);
      return pauseSessionState(prev, nowMs, true);
    });
  }, [falseSessionPrompt]);

  const addDistraction = useCallback(() => {
    const nowMs = Date.now();
    setActiveSession((prev) => {
      if (!prev) return prev;
      if (falseSessionPrompt) return prev;
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
  }, [falseSessionPrompt]);

  const finalizeSession = useCallback(() => {
    const nowMs = Date.now();
    setFalseSessionPrompt(null);
    setActiveSession((prev) => {
      if (!prev) return prev;
      const elapsed = computeElapsedActiveMs(prev, nowMs);
      const shouldPrompt = elapsed < FALSE_SESSION_TOO_SHORT_MS;
      if (!shouldPrompt) return null;
      // Guardamos estado pausado para permitir reinicio.
      const pausedState = pauseSessionState(prev, nowMs, false);
      return {
        ...pausedState,
        // La sesión está terminada: forzamos tiempo restante a 0 para coherencia visual.
        elapsedActiveMs: prev.totalDurationMs,
      };
    });

    // El prompt depende del estado actual. Para evitar inconsistencias por React batching,
    // lo calculamos leyendo el snapshot ref del estado actual.
    const s = activeSessionRef.current;
    if (!s) return;
    const elapsed = computeElapsedActiveMs(s, nowMs);
    if (elapsed >= FALSE_SESSION_TOO_SHORT_MS) return;
    setFalseSessionPrompt({ reason: "too_short", mode: "ended" });
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

