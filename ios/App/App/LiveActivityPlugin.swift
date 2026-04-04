import ActivityKit
import Capacitor
import Foundation

/// Plugin de Capacitor para gestionar Live Activities de iOS (Dynamic Island / Lock Screen).
///
/// Requiere iOS 16.2+. En versiones anteriores los métodos resuelven sin error
/// para no bloquear el flujo de la app.
@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin {

    // Almacenamos la actividad como `Any` para no requerir iOS 16.2 en la declaración
    // de la propiedad; la usamos siempre tras un guard #available.
    private var _activity: Any?

    @available(iOS 16.2, *)
    private var activity: Activity<StudySessionAttributes>? {
        get { _activity as? Activity<StudySessionAttributes> }
        set { _activity = newValue }
    }

    // MARK: - isSupported

    @objc func isSupported(_ call: CAPPluginCall) {
        if #available(iOS 16.2, *) {
            let enabled = ActivityAuthorizationInfo().areActivitiesEnabled
            call.resolve(["supported": enabled])
        } else {
            call.resolve(["supported": false])
        }
    }

    // MARK: - start

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve(["activityId": ""])
            return
        }

        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            call.resolve(["activityId": ""])
            return
        }

        // Terminar actividad anterior si existe
        if let existing = activity {
            Task { await existing.end(existing.content, dismissalPolicy: .immediate) }
            activity = nil
        }

        let sessionTitle        = call.getString("sessionTitle")        ?? "Sesión de estudio"
        let subject             = call.getString("subject")             ?? ""
        let totalDurationSec    = call.getInt("totalDurationSeconds")   ?? 3600
        let endTimestampMs      = call.getDouble("endTimestampMs")      ?? (Date().timeIntervalSince1970 * 1000 + Double(totalDurationSec) * 1000)
        let focusScore          = call.getInt("focusScore")             ?? 100

        let endDate = Date(timeIntervalSince1970: endTimestampMs / 1000.0)

        let attributes = StudySessionAttributes(
            sessionTitle: sessionTitle,
            totalDurationSeconds: totalDurationSec
        )

        let initialState = StudySessionAttributes.ContentState(
            endDate: endDate,
            focusScore: focusScore,
            distractionCount: 0,
            isPaused: false,
            pausedSecondsRemaining: totalDurationSec,
            subject: subject,
            progressPercent: 0.0
        )

        do {
            let newActivity = try Activity<StudySessionAttributes>.request(
                attributes: attributes,
                content: ActivityContent(state: initialState, staleDate: nil),
                pushType: nil
            )
            activity = newActivity
            call.resolve(["activityId": newActivity.id])
        } catch {
            // En simulador o si el usuario ha desactivado las Live Activities
            print("[LiveActivity] start falló: \(error.localizedDescription)")
            call.resolve(["activityId": ""])
        }
    }

    // MARK: - update

    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *), let current = activity else {
            call.resolve()
            return
        }

        let endTimestampMs          = call.getDouble("endTimestampMs")          ?? (Date().timeIntervalSince1970 * 1000)
        let focusScore              = call.getInt("focusScore")                 ?? 100
        let distractionCount        = call.getInt("distractionCount")           ?? 0
        let isPaused                = call.getBool("isPaused")                  ?? false
        let pausedSecondsRemaining  = call.getInt("pausedSecondsRemaining")     ?? 0
        let subject                 = call.getString("subject")                 ?? ""
        let progressPercent         = call.getDouble("progressPercent")         ?? 0.0

        let endDate = Date(timeIntervalSince1970: endTimestampMs / 1000.0)

        let newState = StudySessionAttributes.ContentState(
            endDate: endDate,
            focusScore: focusScore,
            distractionCount: distractionCount,
            isPaused: isPaused,
            pausedSecondsRemaining: pausedSecondsRemaining,
            subject: subject,
            progressPercent: progressPercent
        )

        Task {
            await current.update(ActivityContent(state: newState, staleDate: nil))
            call.resolve()
        }
    }

    // MARK: - end

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *), let current = activity else {
            call.resolve()
            return
        }

        Task {
            await current.end(current.content, dismissalPolicy: .immediate)
            self.activity = nil
            call.resolve()
        }
    }
}
