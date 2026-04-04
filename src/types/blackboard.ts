/* ─── Blackboard Learn REST API types ─── */

/** Membership entry from GET /learn/api/public/v1/users/me/courses */
export type BbCourseMembership = {
  courseId: string;
  userId?: string;
  courseRoleId?: string;
  availability?: {
    available?: string;
    duration?: { type?: string; start?: string; end?: string };
  };
  /** A veces el API anida datos del curso en la matrícula. */
  course?: {
    name?: string;
    displayName?: string;
    termId?: string;
    availability?: {
      available?: string;
      duration?: { type?: string; start?: string; end?: string };
    };
  };
  dataSourceId?: string;
  created?: string;
  modified?: string;
  lastAccessed?: string;
};

/** Course object from GET /learn/api/public/v1/courses/{courseId} */
export type BbCourse = {
  id: string;
  courseId?: string;
  externalId?: string;
  name?: string;
  displayName?: string;
  description?: string;
  termId?: string;
  availability?: {
    available?: string;
    duration?: {
      type?: string;
      start?: string;
      end?: string;
    };
  };
  created?: string;
  modified?: string;
  ultraStatus?: string;
};

/** Término académico (GET /learn/api/public/v1/terms/{termId} si está expuesto). */
export type BbTerm = {
  id: string;
  name?: string;
  title?: string;
  description?: string;
  availability?: {
    available?: string;
    duration?: { type?: string; start?: string; end?: string };
  };
};

/** Paged response wrapper used by Blackboard REST API */
export type BbPagedResponse<T> = {
  results: T[];
  paging?: { nextPage?: string };
};

/** Gradebook column from /courses/{id}/gradebook/columns */
export type BbGradebookColumn = {
  id: string;
  name?: string;
  displayName?: string;
  description?: string;
  externalGrade?: boolean;
  contentId?: string;
  score?: { possible?: number };
  availability?: { available?: string };
  grading?: {
    type?: string;
    due?: string;
    attemptsAllowed?: number;
    anonymousGrading?: { type?: string };
  };
  gradebookCategoryId?: string;
  /** Categoría (p. ej. Discussion.name) como en la API / gradebook/columns. */
  gradebookCategory?: {
    title?: string;
    localizableTitle?: { languageKey?: string };
  };
  /** If true the column accepts student attempts. */
  isAttemptBased?: boolean;
  /** True when the column was manually created (vs auto from content). */
  userCreatedColumn?: boolean;
};

/** Enriched column (list data + optional detail + nota del alumno vía /gradebook/grades) */
export type BbGradebookColumnEnriched = BbGradebookColumn & {
  detailFetched: boolean;
  detailError?: boolean;
  /** Texto de nota (displayGrade.text, score numérico, manualScore, etc.). */
  studentGradeText?: string | null;
  /** Estado del ítem (p. ej. GRADED) si no hay nota visible. */
  studentGradeStatus?: string | null;
  /** true si se cargó el endpoint de calificaciones del usuario con éxito. */
  studentGradesLoaded?: boolean;
  /** Link navegable (Jarvis `urlOpcional`) para abrir el ítem en Ultra. */
  urlOpcional?: string | null;
  /** Entrega (solo columnas attempt-based; null = no aplica). */
  submissionSubmitted?: boolean | null;
  /** Código de razón (Jarvis buildSubmissionStatusWithAttempts). */
  submissionReason?: string;
  /** Etiqueta en español para la columna Estado. */
  submissionLabelEs?: string;
  /**
   * true si GET /contents/{contentId} indica foro (p. ej. resource/x-bb-forumlink);
   * se persiste en caché para enlaces correctos sin volver a llamar a la API.
   */
  linkDiscussionFromContent?: boolean;
};

/* ─── App-level types ─── */

export type BbCourseItem = {
  learnCourseId: string;
  courseId?: string;
  name: string;
  description?: string;
  termId?: string;
  available?: string;
  startDate?: string;
  endDate?: string;
  lastAccessed?: string;
  /** Clasificación estilo Jarvis (Q1/Q2/ANNUAL/ORGANIZATION_COMMUNITY/OTHER). */
  category?: "Q1" | "Q2" | "ANNUAL" | "ORGANIZATION_COMMUNITY" | "OTHER";
};

export type BbGradebookCache = {
  courseId: string;
  columns: BbGradebookColumnEnriched[];
  fetchedAt: string;
  /**
   * id de categoría → título (GET /gradebook/categories).
   * Necesario para marcar columnas como Discussion cuando la API solo envía gradebookCategoryId.
   */
  gradebookCategoryTitles?: Record<string, string>;
};

export type BbConfig = {
  baseUrl: string;
  /** ID de la extensión puente (alternativa a NEXT_PUBLIC_BB_BRIDGE_EXTENSION_ID). */
  extensionId?: string;
};
