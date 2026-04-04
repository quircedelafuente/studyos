import ActivityKit
import Capacitor
import Foundation

@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin {

    private var _activity: Any?

    @available(iOS 16.2, *)
    private var activity: Activity<StudySessionAttributes>? {
        get { _activity as? Activity<StudySessionAttributes> }
        set { _activity = newValue }
    }

    // MARK: - isSupported

    @objc func isSupported(_ call: CAPPluginCall) {
        if #available(iOS 16.2, *) {
            let info = ActivityAuthorizationInfo()
            let enabled = info.areActivitiesEnabled
            print("[LiveActivity] isSupported → areActivitiesEnabled=\(enabled)")
            call.resolve(["supported": enabled])
        } else {
            print("[LiveActivity] isSupported → iOS < 16.2, unsupported")
            call.resolve(["supported": false])
        }
    }

    // MARK: - start

    @objc func start(_ call: CAPPluginCall) {
        print("[LiveActivity] start() called")

        guard #available(iOS 16.2, *) else {
            print("[LiveActivity] start() → iOS < 16.2, aborting")
            call.resolve(["activityId": ""])
            return
        }

        let info = ActivityAuthorizationInfo()
        print("[LiveActivity] areActivitiesEnabled=\(info.areActivitiesEnabled)")
        guard info.areActivitiesEnabled else {
            print("[LiveActivity] start() → actividades deshabilitadas (Settings > \(Bundle.main.bundleIdentifier ?? "app") > Live Activities)")
            call.resolve(["activityId": ""])
            return
        }

        // Terminar actividad anterior si existe
        if let existing = activity {
            print("[LiveActivity] terminando actividad anterior id=\(existing.id)")
            Task { await existing.end(existing.content, dismissalPolicy: .immediate) }
            activity = nil
        }

        let sessionTitle     = call.getString("sessionTitle")      ?? "Sesión de estudio"
        let subject          = call.getString("subject")           ?? ""
        let totalDurationSec = call.getInt("totalDurationSeconds") ?? 3600
        let endTimestampMs   = call.getDouble("endTimestampMs")    ?? (Date().timeIntervalSince1970 * 1000 + Double(totalDurationSec) * 1000)
        let focusScore       = call.getInt("focusScore")           ?? 100

        let endDate = Date(timeIntervalSince1970: endTimestampMs / 1000.0)
        print("[LiveActivity] sessionTitle=\(sessionTitle) subject=\(subject) totalSec=\(totalDurationSec) endDate=\(endDate) focusScore=\(focusScore)")

        // Validar que endDate no sea en el pasado
        guard endDate > Date() else {
            print("[LiveActivity] start() → endDate está en el pasado (\(endDate)), abortando")
            call.resolve(["activityId": ""])
            return
        }

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
            print("[LiveActivity] ✅ Actividad creada id=\(newActivity.id) state=\(newActivity.activityState)")
            call.resolve(["activityId": newActivity.id])
        } catch {
            print("[LiveActivity] ❌ Activity.request() falló: \(error)")
            print("[LiveActivity]    localizedDescription: \(error.localizedDescription)")
            if let activityError = error as? ActivityAuthorizationError {
                print("[LiveActivity]    ActivityAuthorizationError: \(activityError)")
            }
            call.resolve(["activityId": ""])
        }
    }

    // MARK: - update

    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *), let current = activity else {
            if #available(iOS 16.2, *) {
                print("[LiveActivity] update() → no hay actividad activa")
            }
            call.resolve()
            return
        }

        let endTimestampMs         = call.getDouble("endTimestampMs")         ?? (Date().timeIntervalSince1970 * 1000)
        let focusScore             = call.getInt("focusScore")                ?? 100
        let distractionCount       = call.getInt("distractionCount")          ?? 0
        let isPaused               = call.getBool("isPaused")                 ?? false
        let pausedSecondsRemaining = call.getInt("pausedSecondsRemaining")    ?? 0
        let subject                = call.getString("subject")                ?? ""
        let progressPercent        = call.getDouble("progressPercent")        ?? 0.0

        let endDate = Date(timeIntervalSince1970: endTimestampMs / 1000.0)

        print("[LiveActivity] update() focus=\(focusScore) paused=\(isPaused) progress=\(progressPercent)%")

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
            print("[LiveActivity] update() → actualizado correctamente")
            call.resolve()
        }
    }

    // MARK: - end

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *), let current = activity else {
            if #available(iOS 16.2, *) {
                print("[LiveActivity] end() → no hay actividad activa")
            }
            call.resolve()
            return
        }

        print("[LiveActivity] end() → terminando actividad id=\(current.id)")
        Task {
            await current.end(current.content, dismissalPolicy: .immediate)
            self.activity = nil
            print("[LiveActivity] end() → terminada")
            call.resolve()
        }
    }
}
