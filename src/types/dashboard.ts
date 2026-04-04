export type MainTabId =
  | "dashboard"
  | "calendario"
  | "courses"
  | "fechas"
  | "documentos"
  | "assignments"
  | "study-arena"
  | "study-planner"
  | "notas"
  | "notebooklm";

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
