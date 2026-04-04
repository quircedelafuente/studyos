import ActivityKit
import Foundation

/// Modelo de datos de la Live Activity de IEStudio.
///
/// IMPORTANTE: Este archivo debe añadirse a DOS targets en Xcode:
///   - App  (lo usa LiveActivityPlugin.swift para arrancar/actualizar la actividad)
///   - StudyWidget (lo usa StudyWidgetLiveActivity.swift para renderizar la UI)
@available(iOS 16.2, *)
public struct StudySessionAttributes: ActivityAttributes {

    // MARK: - Estado dinámico (se actualiza durante la sesión)
    public struct ContentState: Codable, Hashable {
        /// Fecha/hora prevista de fin. iOS usa esto para el countdown automático
        /// en Dynamic Island y Lock Screen sin necesidad de actualizaciones continuas.
        public var endDate: Date
        /// Focus Score actual (0–100).
        public var focusScore: Int
        /// Número de distracciones registradas.
        public var distractionCount: Int
        /// Indica si la sesión está pausada (muestra tiempo estático).
        public var isPaused: Bool
        /// Segundos restantes en el momento de pausar (para mostrar tiempo estático).
        public var pausedSecondsRemaining: Int
        /// Asignatura o tema de la sesión.
        public var subject: String
        /// Progreso completado 0.0–100.0.
        public var progressPercent: Double
    }

    // MARK: - Atributos estáticos (no cambian durante la sesión)
    /// Título del plan de estudio.
    public var sessionTitle: String
    /// Duración total en segundos.
    public var totalDurationSeconds: Int
}
