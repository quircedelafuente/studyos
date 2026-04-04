import ActivityKit
import Capacitor
import Foundation

@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {

    // ── CAPBridgedPlugin — protocolo obligatorio en Capacitor 7 para auto-registro ─
    public let identifier = "LiveActivityPlugin"
    public let jsName = "LiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start",       returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update",      returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end",         returnType: CAPPluginReturnPromise),
    ]

    // Almacenamos la actividad como `Any` para evitar @available en la propiedad
    private var _activity: Any?

    @available(iOS 16.2, *)
    private var activity: Activity<StudySessionAttributes>? {
        get { _activity as? Activity<StudySessionAttributes> }
        set { _activity = newValue }
    }

    // MARK: - isSupported

    @objc public func isSupported(_ call: CAPPluginCall) {
        if #available(iOS 16.2, *) {
            let enabled = ActivityAuthorizationInfo().areActivitiesEnabled
            print("[LiveActivity] isSupported → areActivitiesEnabled=\(enabled)")
            call.resolve(["supported": enabled])
        } else {
            print("[LiveActivity] isSupported → iOS < 16.2")
            call.resolve(["supported": false])
        }
    }

    // MARK: - start

    @objc public func start(_ call: CAPPluginCall) {
        print("[LiveActivity] start() invocado")

        guard #available(iOS 16.2, *) else {
            print("[LiveActivity] iOS < 16.2 — abortando")
            call.resolve(["activityId": ""])
            return
        }

        let authInfo = ActivityAuthorizationInfo()
        print("[LiveActivity] areActivitiesEnabled=\(authInfo.areActivitiesEnabled)")

        guard authInfo.areActivitiesEnabled else {
            print("[LiveActivity] Live Activities deshabilitadas — ve a Ajustes › \(Bundle.main.bundleIdentifier ?? "app") › Actividades en vivo")
            call.resolve(["activityId": ""])
            return
        }

        // Terminar actividad anterior
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
        let endDate          = Date(timeIntervalSince1970: endTimestampMs / 1000.0)

        print("[LiveActivity] title=\(sessionTitle) subject=\(subject) totalSec=\(totalDurationSec) endDate=\(endDate)")

        guard endDate > Date() else {
            print("[LiveActivity] endDate en el pasado — abortando")
            call.resolve(["activityId": ""])
            return
        }

        let attrs = StudySessionAttributes(
            sessionTitle: sessionTitle,
            totalDurationSeconds: totalDurationSec
        )
        let state = StudySessionAttributes.ContentState(
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
                attributes: attrs,
                content: ActivityContent(state: state, staleDate: nil),
                pushType: nil
            )
            activity = newActivity
            print("[LiveActivity] ✅ Actividad creada id=\(newActivity.id) activityState=\(newActivity.activityState)")
            call.resolve(["activityId": newActivity.id])
        } catch {
            print("[LiveActivity] ❌ Activity.request() falló: \(error)")
            call.resolve(["activityId": ""])
        }
    }

    // MARK: - update

    @objc public func update(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *), let current = activity else {
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
        let endDate                = Date(timeIntervalSince1970: endTimestampMs / 1000.0)

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

    @objc public func end(_ call: CAPPluginCall) {
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
