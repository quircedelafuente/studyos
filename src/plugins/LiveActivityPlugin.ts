import { registerPlugin } from "@capacitor/core";

export interface LiveActivityStartOptions {
  /** Título del plan de estudio (estático durante la sesión). */
  sessionTitle: string;
  /** Asignatura / tema. */
  subject: string;
  /** Duración total en segundos. */
  totalDurationSeconds: number;
  /** Timestamp Unix (ms) de fin previsto — iOS lo usa para el countdown. */
  endTimestampMs: number;
  /** Focus Score inicial (0–100). */
  focusScore: number;
}

export interface LiveActivityUpdateOptions {
  /** Timestamp Unix (ms) de fin previsto (recalculado tras pausar/reanudar). */
  endTimestampMs: number;
  /** Focus Score actual (0–100). */
  focusScore: number;
  /** Distracciones acumuladas. */
  distractionCount: number;
  /** Si la sesión está pausada. */
  isPaused: boolean;
  /** Segundos restantes en el momento de pausar (para mostrar tiempo estático). */
  pausedSecondsRemaining: number;
  /** Asignatura / tema actual. */
  subject: string;
  /** Progreso completado 0–100. */
  progressPercent: number;
}

export interface LiveActivityPlugin {
  /** ¿Están activadas las Live Activities en este dispositivo/iOS? */
  isSupported(): Promise<{ supported: boolean }>;
  /** Arranca la Live Activity al iniciar una sesión de estudio. */
  start(options: LiveActivityStartOptions): Promise<{ activityId: string }>;
  /** Actualiza los datos de la Live Activity en curso. */
  update(options: LiveActivityUpdateOptions): Promise<void>;
  /** Termina y cierra la Live Activity. */
  end(): Promise<void>;
}

const LiveActivity = registerPlugin<LiveActivityPlugin>("LiveActivity");

export default LiveActivity;
