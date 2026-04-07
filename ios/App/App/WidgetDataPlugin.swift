import Capacitor
import Foundation
import WidgetKit

// MARK: - Checklist localStorage (iestudio-daily-checklist-v1) — mismo contrato que el cliente web

private struct IEChecklistFile: Codable {
    var v: Int
    var tasks: [IEChecklistTaskRow]
}

private struct IEChecklistTaskRow: Codable {
    var scope: String
    var periodKey: String
    var done: Bool
}

@objc(WidgetDataPlugin)
public class WidgetDataPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier      = "WidgetDataPlugin"
    public let jsName          = "WidgetData"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "syncDailyTasksRing", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "syncDailyChecklistMirror", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reconcileChecklistFromAppGroup", returnType: CAPPluginReturnPromise),
    ]

    private let appGroupSuite = "group.com.agustmun.iestudio"
    private let dailyRingKey = "iestudio_widget_daily_tasks_ring"
    private let checklistStorageKey = "iestudio-daily-checklist-v1"
    private let checklistMirrorKey = "iestudio_daily_checklist_mirror"
    private let habitsMirrorKey = "iestudio_habits_mirror"
    private let habitLogsMirrorKey = "iestudio_habit_logs_mirror"

    private func localTodayYmd() -> String {
        let cal = Calendar.current
        let n = Date()
        let y = cal.component(.year, from: n)
        let mo = cal.component(.month, from: n)
        let d = cal.component(.day, from: n)
        return String(format: "%04d-%02d-%02d", y, mo, d)
    }

    private func ringMiniFromChecklistStorageRaw(_ raw: String) -> [String: Any]? {
        guard let data = raw.data(using: .utf8) else { return nil }
        let file: IEChecklistFile
        do {
            file = try JSONDecoder().decode(IEChecklistFile.self, from: data)
        } catch {
            print("[WidgetDataPlugin] ⚠️ decode checklist: \(error.localizedDescription)")
            return nil
        }
        guard file.v == 1 else { return nil }
        let ymd = localTodayYmd()
        let todayTasks = file.tasks.filter { $0.scope == "day" && $0.periodKey == ymd }
        let total = todayTasks.count
        if total == 0 {
            return ["pct": 0, "empty": true, "done": 0, "total": 0]
        }
        let done = todayTasks.filter { $0.done }.count
        let pct = Int((100.0 * Double(done) / Double(total)).rounded())
        return ["pct": pct, "empty": false, "done": done, "total": total]
    }

    private func persistRingMini(_ mini: [String: Any], defaults: UserDefaults) -> Bool {
        guard let miniData = try? JSONSerialization.data(withJSONObject: mini),
              let miniStr = String(data: miniData, encoding: .utf8) else { return false }
        defaults.set(miniStr, forKey: dailyRingKey)
        return true
    }

    /// Ajusta el anillo desde localStorage del WKWebView sin bloquear el sync principal
    /// (StudyTrend y el resto dependen de `reloadAllTimelines` inmediato tras escribir el JSON).
    private func refreshDailyRingFromWebViewNonBlocking(defaults: UserDefaults) {
        guard let wv = webView else { return }

        let escapedKey = checklistStorageKey
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
        let js = """
        (function(){
          try { return localStorage.getItem('\(escapedKey)') || ''; } catch (e) { return ''; }
        })()
        """

        wv.evaluateJavaScript(js) { [weak self] result, error in
            if let error = error {
                print("[WidgetDataPlugin] ⚠️ WebView localStorage: \(error.localizedDescription)")
                return
            }
            guard let self = self else { return }
            guard let defaults = UserDefaults(suiteName: self.appGroupSuite) else { return }

            if let raw = result as? String {
                // Mirror completo del checklist para el widget interactivo.
                defaults.set(raw, forKey: self.checklistMirrorKey)
                if raw.isEmpty {
                    let empty: [String: Any] = ["pct": 0, "empty": true, "done": 0, "total": 0]
                    _ = self.persistRingMini(empty, defaults: defaults)
                } else if let mini = self.ringMiniFromChecklistStorageRaw(raw) {
                    _ = self.persistRingMini(mini, defaults: defaults)
                    print("[WidgetDataPlugin] ✅ daily tasks ring from WebView → \(mini)")
                }
            }
            defaults.synchronize()
            WidgetCenter.shared.reloadTimelines(ofKind: "DailyTasksWidget")
        }
    }

    @objc public func syncDailyTasksRing(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            print("[WidgetDataPlugin] ❌ syncDailyTasksRing: missing json")
            call.reject("Missing json parameter")
            return
        }
        guard let defaults = UserDefaults(suiteName: appGroupSuite) else {
            print("[WidgetDataPlugin] ❌ syncDailyTasksRing: App Group unavailable")
            call.reject("App Group not available")
            return
        }
        guard let d = json.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else {
            print("[WidgetDataPlugin] ❌ syncDailyTasksRing: invalid JSON")
            call.reject("Invalid json")
            return
        }
        let mini: [String: Any] = [
            "pct": obj["pct"] ?? 0,
            "empty": obj["empty"] ?? true,
            "done": obj["done"] ?? 0,
            "total": obj["total"] ?? 0,
        ]
        guard let miniData = try? JSONSerialization.data(withJSONObject: mini),
              let miniStr = String(data: miniData, encoding: .utf8) else {
            call.reject("Could not encode ring")
            return
        }
        defaults.set(miniStr, forKey: dailyRingKey)
        defaults.synchronize()
        print("[WidgetDataPlugin] ✅ daily tasks ring (JS explícito) → \(miniStr)")
        WidgetCenter.shared.reloadTimelines(ofKind: "DailyTasksWidget")
        call.resolve()
    }

    /// Persiste el JSON completo del checklist (mismo formato que localStorage web) para el widget y la reconciliación.
    @objc public func syncDailyChecklistMirror(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("Missing json parameter")
            return
        }
        guard let defaults = UserDefaults(suiteName: appGroupSuite) else {
            call.reject("App Group not available")
            return
        }
        defaults.set(json, forKey: checklistMirrorKey)
        if json.isEmpty {
            let empty: [String: Any] = ["pct": 0, "empty": true, "done": 0, "total": 0]
            _ = persistRingMini(empty, defaults: defaults)
        } else if let mini = ringMiniFromChecklistStorageRaw(json) {
            _ = persistRingMini(mini, defaults: defaults)
        }
        defaults.synchronize()
        WidgetCenter.shared.reloadTimelines(ofKind: "DailyTasksWidget")
        call.resolve()
    }

    /// Devuelve el mirror del App Group para que JS lo fusione en localStorage si difiere (p. ej. marcas desde el widget).
    @objc public func reconcileChecklistFromAppGroup(_ call: CAPPluginCall) {
        guard let defaults = UserDefaults(suiteName: appGroupSuite),
              let mirror = defaults.string(forKey: checklistMirrorKey),
              !mirror.isEmpty
        else {
            call.resolve(["mirror": NSNull()])
            return
        }
        call.resolve(["mirror": mirror])
    }

    @objc public func syncHabitsMirror(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("Missing json parameter")
            return
        }
        guard let defaults = UserDefaults(suiteName: appGroupSuite) else {
            call.reject("App Group not available")
            return
        }
        defaults.set(json, forKey: habitsMirrorKey)
        defaults.synchronize()
        WidgetCenter.shared.reloadTimelines(ofKind: "HabitsWidget")
        call.resolve()
    }

    @objc public func syncHabitLogsMirror(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("Missing json parameter")
            return
        }
        guard let defaults = UserDefaults(suiteName: appGroupSuite) else {
            call.reject("App Group not available")
            return
        }
        defaults.set(json, forKey: habitLogsMirrorKey)
        defaults.synchronize()
        WidgetCenter.shared.reloadTimelines(ofKind: "HabitsWidget")
        call.resolve()
    }

    @objc public func reconcileHabitsFromAppGroup(_ call: CAPPluginCall) {
        guard let defaults = UserDefaults(suiteName: appGroupSuite),
              let mirror = defaults.string(forKey: habitsMirrorKey),
              !mirror.isEmpty
        else {
            call.resolve(["mirror": NSNull()])
            return
        }
        call.resolve(["mirror": mirror])
    }

    @objc public func reconcileHabitLogsFromAppGroup(_ call: CAPPluginCall) {
        guard let defaults = UserDefaults(suiteName: appGroupSuite),
              let mirror = defaults.string(forKey: habitLogsMirrorKey),
              !mirror.isEmpty
        else {
            call.resolve(["mirror": NSNull()])
            return
        }
        call.resolve(["mirror": mirror])
    }

    @objc public func sync(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            print("[WidgetDataPlugin] ❌ missing json parameter")
            call.reject("Missing json parameter")
            return
        }

        guard let defaults = UserDefaults(suiteName: appGroupSuite) else {
            print("[WidgetDataPlugin] ❌ App Group 'group.com.agustmun.iestudio' not available — check entitlements in both targets")
            call.reject("App Group not available — check entitlements")
            return
        }

        defaults.set(json, forKey: "iestudio_widget_data")

        if let d = json.data(using: .utf8),
           let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
           let ring = obj["dailyTasksRing"] as? [String: Any] {
            let mini: [String: Any] = [
                "pct": ring["pct"] ?? 0,
                "empty": ring["empty"] ?? true,
                "done": ring["done"] ?? 0,
                "total": ring["total"] ?? 0,
            ]
            if let miniData = try? JSONSerialization.data(withJSONObject: mini),
               let miniStr = String(data: miniData, encoding: .utf8) {
                defaults.set(miniStr, forKey: dailyRingKey)
            }
        }

        defaults.synchronize()
        print("[WidgetDataPlugin] ✅ data written to App Group (\(json.count) bytes)")

        WidgetCenter.shared.reloadAllTimelines()
        WidgetCenter.shared.reloadTimelines(ofKind: "DailyTasksWidget")
        print("[WidgetDataPlugin] ✅ WidgetCenter reload timelines triggered")

        call.resolve()

        refreshDailyRingFromWebViewNonBlocking(defaults: defaults)
    }
}
