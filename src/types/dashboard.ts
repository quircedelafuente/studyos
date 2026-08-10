export type MainTabId =
  | "dashboard"
  | "calendario"
  | "class-notes"
  | "fechas"
  | "daily-tasks"
  | "habits"
  | "documentos"
  | "assignments"
  | "study-arena"
  | "study-planner"
  | "notas"
  | "notebooklm"
  | "app-blocking";

/** Prioridad visual de una tarea (punto de color). */
export type ChecklistPriority = "green" | "orange" | "red";

/** Ítem de checklist diario o semanal (persistido en localStorage / nube). */
export type ChecklistTaskItem = {
  id: string;
  title: string;
  done: boolean;
  createdAt: string;
  /** `day`: {@link ChecklistTaskItem.periodKey} es YYYY-MM-DD local. `week`: lunes de esa semana (YYYY-MM-DD). */
  scope: "day" | "week";
  periodKey: string;
  /** Verde = baja, naranja = media, roja = alta. */
  priority: ChecklistPriority;
};

// ── Habit tracker ────────────────────────────────────────────────────────────

export type HabitSchedule =
  | {
      mode: "weekdays";
      /** 0=Dom ... 6=Sáb */
      weekdays: number[];
    }
  | {
      mode: "times_per_week";
      /** 1..7 */
      timesPerWeek: number;
    };

export type HabitReminder = {
  enabled: boolean;
  /** Hora local HH:mm */
  timeLocal: string;
  /** Mensaje motivador personalizado (opcional) */
  message: string;
};

export type HabitKind = "check" | "measure";

export type HabitTargetMode = "at_least" | "exact";

export type HabitDefinition = {
  id: string;
  title: string;
  kind: HabitKind;
  schedule: HabitSchedule;
  /** Para hábitos de medida */
  unit?: string;
  target?: number | null;
  targetMode?: HabitTargetMode;
  reminder?: HabitReminder;
  createdAt: string;
  updatedAt: string;
  archived?: boolean;
};

export type HabitLogEntry = {
  /** true para hábitos de tipo check; o derivado para medida */
  done?: boolean;
  /** acumulado para hábitos de medida */
  value?: number;
};

/** Mensaje en el chat de planificación (modelo vía OpenRouter). */
export type StudyPlanChatTurn = {
  role: "user" | "model";
  content: string;
  at: string;
};

/** Día concreto del calendario de estudio generado por la IA. */
export type StudyPlanDayEntry = {
  date: string;
  studyHours: number;
  focus: string;
  /** Título opcional de la sesión (tarjeta); si falta, se muestra la fecha. */
  sessionTitle?: string;
  /** Hora de inicio en formato HH:mm; si falta, la vista previa usa 09:00. */
  startTime?: string | null;
};

/** Calendario estructurado guardado en el plan (tras «Guardar en la app»). */
export type StudyPlanAISchedule = {
  totalHoursEstimated: number | null;
  methodNote: string;
  days: StudyPlanDayEntry[];
  /** ISO; vacío = borrador solo en pantalla (no persistido con «Añadir al calendario»). */
  savedAt: string;
};

/** Plan de estudio creado en Study Planner (persistido en el navegador). */
export type StudyPlan = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** Id de {@link ImportantDeadline} en «Exámenes y fechas» (null = sin evento vinculado). */
  targetDeadlineId?: string | null;
  chatMessages?: StudyPlanChatTurn[];
  aiSchedule?: StudyPlanAISchedule;
};

/** Etiqueta reutilizable para deadlines (registro global en localStorage). */
export type DeadlineTag = {
  id: string;
  label: string;
  createdAt: string;
};

/** Examen u otro deadline manual, asociado a un curso del panel Courses. */
export type ImportantDeadline = {
  id: string;
  title: string;
  /** Día del deadline en formato YYYY-MM-DD (local). */
  date: string;
  /** Hora en formato HH:mm (24 h); null = sin hora concreta. */
  time: string | null;
  /** Duración en minutos (para bloques de estudio); si no se da, 60 min por defecto. */
  durationMinutes?: number | null;
  /** Curso manual (`ManualCourse.id`); null = sin asignatura. */
  courseId: string | null;
  /**
   * Nombre de la asignatura escrito en el propio deadline.
   *
   * Existe porque `courseId` apunta al registro de cursos, que es **local de
   * cada dispositivo** (queda fuera de la sincronización): en el iPad no
   * resolvería a nada. Guardando el nombre aquí, la asignatura viaja con el
   * deadline y se puede filtrar en cualquier dispositivo.
   */
  subject?: string | null;
  /** Ids de {@link DeadlineTag}; vacío si no hay etiquetas. */
  tagIds: string[];
  /** colorId de la paleta Google Calendar ("1"…"11") en vistas del calendario. */
  calendarColorId: string;
  createdAt: string;
};

export type CourseFileKind = "pdf" | "nota" | "slide" | "enlace" | "other";

export type CourseFileMock = {
  id: string;
  name: string;
  kind: CourseFileKind;
  updatedAt: string;
  pinned?: boolean;
};

/** Archivo de curso persistido (metadata en localStorage, binario en IndexedDB). */
export type CourseFileStored = CourseFileMock & {
  /** Carpeta contenedora; null = raíz del curso. */
  folderId: string | null;
  /** Clave en IndexedDB (suele coincidir con id). Ausente en datos antiguos sin blob. */
  blobKey?: string;
};

export type CourseFolder = {
  id: string;
  name: string;
  /** null = raíz del curso. */
  parentId: string | null;
};

export type CourseMock = {
  id: string;
  name: string;
  short: string;
  accent: string;
  files: CourseFileMock[];
};

/** Curso creado a mano en el panel Courses (persistido en el navegador). */
export type ManualCourse = {
  id: string;
  name: string;
  /** Siglas o código corto (opcional). */
  short: string;
  createdAt: string;
  folders: CourseFolder[];
  files: CourseFileStored[];
};
