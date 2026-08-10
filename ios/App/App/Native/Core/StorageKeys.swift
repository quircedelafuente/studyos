import Foundation

/// Claves de `localStorage` que la web guarda bajo el prefijo `iestudio-`
/// y que viajan tal cual por `/api/user-sync`.
///
/// Los valores están copiados literalmente de `src/lib/*-storage.ts`.
/// Si cambia un nombre en TypeScript hay que cambiarlo aquí: no hay
/// verificación en compilación que lo detecte.
public enum StorageKeys {

    /// Todo lo que empiece por este prefijo se sincroniza con la nube.
    public static let syncPrefix = "iestudio-"

    // MARK: - Planificación y tareas

    /// `study-plans-storage.ts` → array de planes de estudio.
    public static let studyPlans = "iestudio-study-plans"

    /// `study-microtasks-storage.ts` → mapa de microtareas marcadas.
    public static let studyMicrotasks = "iestudio-study-microtasks-checked"

    /// `daily-checklist-storage.ts` → checklist diaria.
    public static let dailyChecklist = "iestudio-daily-checklist-v1"

    /// `parking-lot-storage.ts` → notas del "parking lot".
    public static let parkingLot = "iestudio-parking-lot-notes"

    // MARK: - Entregas y exámenes

    /// `deadlines-storage.ts` → entregas/exámenes manuales.
    public static let deadlines = "iestudio-important-deadlines"

    /// `deadline-tags-storage.ts` → etiquetas asignadas a cada entrega.
    public static let deadlineTags = "iestudio-deadline-tags"

    /// `semester-exams-seed.ts` → flags de sembrado; son marcas de migración,
    /// no datos. La app nativa solo debería leerlas, nunca reescribirlas.
    public static let semesterExamsSeededFlag = "iestudio-seeded-exams-2026-fall"
    public static let semesterExamsSubjectsBackfillFlag = "iestudio-exams-2026-fall-subjects-v1"
    public static let semesterExamsColorsMigrationFlag = "iestudio-exams-2026-fall-colors-v4"

    // MARK: - Hábitos

    /// `habits-storage.ts` → definición de hábitos.
    public static let habits = "iestudio-habits-v1"

    /// `habit-logs-storage.ts` → registro diario de cumplimiento.
    public static let habitLogs = "iestudio-habit-logs-v1"

    // MARK: - Study Arena (sesiones de estudio)

    /// `study-arena-storage.ts` → sesión en curso. El servidor la resuelve por
    /// `_updatedAt` (last-write-wins), así que al escribirla conviene incluir
    /// ese campo o un dispositivo dormido puede pisar la sesión activa.
    public static let studyArenaState = "iestudio-study-arena-state"

    /// `study-arena-completed-storage.ts` → sesiones completadas.
    /// El servidor las fusiona por unión de ids (append-only): borrar un
    /// elemento localmente no lo borra en la nube, para eso está la lista
    /// de lápidas `studyArenaCompletedDeleted`.
    public static let studyArenaCompleted = "iestudio-study-arena-completed"
    public static let studyArenaCompletedDeleted = "iestudio-study-arena-completed-deleted"

    // MARK: - Notas de clase

    /// `class-notes-storage.ts` → notas por asignatura.
    public static let classNotes = "iestudio-class-notes"

    /// `session-notes-storage.ts` → notas por sesión de clase.
    public static let sessionNotes = "iestudio-class-session-notes-v1"

    /// `class-notes-companion-client.ts` → URL del backend companion.
    public static let classNotesCompanionURL = "iestudio-class-notes-companion-url"

    // MARK: - Blackboard

    /// `blackboard-storage.ts` → caché de cursos (`{ courses, fetchedAt }`).
    public static let bbCourses = "iestudio-bb-courses"

    /// `blackboard-config.ts` → configuración de la integración.
    public static let bbConfig = "iestudio-bb-config"

    /// `bb-course-curation.ts` → cursos ocultos/fijados por el usuario.
    public static let bbCourseCuration = "iestudio-bb-course-curation"

    /// `bb-course-filter-prefs.ts` → modo de filtrado de cursos.
    public static let bbCourseFilterMode = "iestudio-bb-course-filter-mode"

    /// Prefijos de clave dinámica: se completan con el id del curso.
    /// Usa `SyncStore.keys(withPrefix:)` para enumerarlas.
    public static let bbGradebookPrefix = "iestudio-bb-gb-"
    public static let bbContentFirstLastModPrefix = "iestudio-bb-content-first-lastmod-"

    public static func bbGradebook(courseID: String) -> String {
        bbGradebookPrefix + courseID
    }

    public static func bbContentFirstLastMod(courseID: String) -> String {
        bbContentFirstLastModPrefix + courseID
    }

    // MARK: - Interfaz

    /// `theme.ts` → tema activo. Guardado como texto plano (`"dark"`), no JSON.
    public static let theme = "iestudio-theme"

    /// `section-visibility.ts` → array de secciones **ocultas** (no visibles).
    public static let hiddenSections = "iestudio-hidden-sections"

    /// `DashboardOverviewPanel.tsx` → disposición de los paneles.
    public static let dashboardLayout = "iestudio-dashboard-layout-v4"
    public static let dashboardMobileHeights = "iestudio-dashboard-mobile-heights-v1"

    /// `DailyTasksPanel.tsx` → preferencias de vista del panel de tareas.
    public static let dailyTasksListMode = "iestudio-daily-tasks-list-mode"
    public static let dailyTasksPanelView = "iestudio-daily-tasks-panel-view"

    /// `ChatTab.tsx` → modelo Gemini elegido en NotebookLM.
    public static let notebooklmGeminiModel = "iestudio-notebooklm-gemini-model"

    // MARK: - Solo local

    /// `manual-courses-storage.ts`. El servidor la borra explícitamente de todo
    /// payload (`delete sanitized[MANUAL_COURSES_STORAGE_KEY]`): son documentos
    /// de este dispositivo y nunca se suben. Escribirla es inofensivo pero
    /// jamás llegará a la nube.
    public static let manualCourses = "iestudio-manual-courses"

    /// Nombre de la base IndexedDB de la web con los ficheros de curso.
    /// No es una clave de `localStorage`; aquí solo como referencia.
    public static let courseFilesIndexedDBName = "iestudio-course-files"

    // MARK: - Identificadores de calendario (no son claves de almacenamiento)

    /// Ids sintéticos que la web inyecta en la vista de calendario. Sirven para
    /// reconocer/filtrar eventos, no para leer ni escribir en `SyncStore`.
    public enum CalendarIDs {
        public static let studyPlanPreviewCalendar = "iestudio-study-plan-preview"
        public static let localDeadlinesCalendar = "iestudio-local-deadlines"
        public static let deadlineEventPrefix = "iestudio-deadline-"
        public static let studyPlanDayEventPrefix = "iestudio-sp-day-"
    }

    // MARK: - Conjuntos útiles

    /// Claves con datos de usuario que la app nativa lee al arrancar.
    /// No incluye flags de migración ni preferencias de la web.
    public static let userData: [String] = [
        studyPlans,
        studyMicrotasks,
        dailyChecklist,
        parkingLot,
        deadlines,
        deadlineTags,
        habits,
        habitLogs,
        studyArenaState,
        studyArenaCompleted,
        studyArenaCompletedDeleted,
        classNotes,
        sessionNotes,
        bbCourses,
        bbCourseCuration,
    ]

    /// Claves cuyo valor NO es JSON válido: la web las guarda como texto plano.
    /// `SyncStore` ya lo tolera, pero conviene saberlo al modelarlas.
    public static let plainTextValues: Set<String> = [
        theme,
        bbCourseFilterMode,
        dailyTasksListMode,
        dailyTasksPanelView,
        notebooklmGeminiModel,
        classNotesCompanionURL,
    ]
}
