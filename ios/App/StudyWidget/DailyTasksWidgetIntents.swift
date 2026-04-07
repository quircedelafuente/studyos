import AppIntents
import Foundation
import WidgetKit

// MARK: - Checklist mirror (mismo JSON que `iestudio-daily-checklist-v1` en la web)

private struct IEChecklistMirrorRoot: Codable {
    var v: Int
    var tasks: [IEChecklistMirrorTask]
}

private struct IEChecklistMirrorTask: Codable {
    var id: String
    var title: String
    var done: Bool
    var createdAt: String
    var scope: String
    var periodKey: String
    var priority: String
}

// MARK: - Estado de la vista del widget

enum DailyTasksWidgetDisplayMode {
    case noMirror
    case noTasksToday
    case allDone
    case list(rows: [(id: String, title: String)])
}

struct DailyTasksWidgetBuilt {
    let ring: IEWidgetDailyTasksRing
    let mode: DailyTasksWidgetDisplayMode
}

/// Kinds de widgets que leen el mirror del checklist diario.
enum DailyTasksWidgetTimelineKind {
    static let home = "DailyTasksWidget"
    static let lockScreen = "LockScreenDailyTasksWidget"

    static func reloadAll() {
        WidgetCenter.shared.reloadTimelines(ofKind: home)
        WidgetCenter.shared.reloadTimelines(ofKind: lockScreen)
    }
}

enum DailyTasksMirrorStore {

    private static func todayYmd() -> String {
        let cal = Calendar.current
        let n = Date()
        let y = cal.component(.year, from: n)
        let mo = cal.component(.month, from: n)
        let d = cal.component(.day, from: n)
        return String(format: "%04d-%02d-%02d", y, mo, d)
    }

    private static func priorityOrder(_ p: String) -> Int {
        switch p {
        case "red": return 0
        case "orange": return 1
        default: return 2
        }
    }

    private static func sortedTodayTasks(_ tasks: [IEChecklistMirrorTask]) -> [IEChecklistMirrorTask] {
        let ymd = todayYmd()
        let today = tasks.filter { $0.scope == "day" && $0.periodKey == ymd }
        return today.sorted { a, b in
            let pa = priorityOrder(a.priority)
            let pb = priorityOrder(b.priority)
            if pa != pb { return pa < pb }
            if a.createdAt != b.createdAt { return a.createdAt < b.createdAt }
            return a.id < b.id
        }
    }

    private static func ringFromSortedToday(_ sorted: [IEChecklistMirrorTask]) -> IEWidgetDailyTasksRing {
        let total = sorted.count
        if total == 0 {
            return IEWidgetDailyTasksRing(pct: 0, empty: true, done: 0, total: 0)
        }
        let done = sorted.filter(\.done).count
        let pct = Int((100.0 * Double(done) / Double(total)).rounded())
        return IEWidgetDailyTasksRing(pct: pct, empty: false, done: done, total: total)
    }

    private static func fallbackRingFromWidgetData() -> IEWidgetDailyTasksRing {
        if let d = UserDefaults(suiteName: kAppGroupID),
           let r = IEWidgetDailyTasksRing.loadStandalone(from: d) {
            return r
        }
        let data = IEWidgetData.load()
        return data.dailyTasksRing
            ?? IEWidgetDailyTasksRing(pct: 0, empty: true, done: 0, total: 0)
    }

    /// Construye anillo + modo de UI para el widget mediano.
    static func widgetBuilt(fromMirrorRaw mirrorRaw: String?) -> DailyTasksWidgetBuilt {
        guard let mirrorRaw, !mirrorRaw.isEmpty,
              let data = mirrorRaw.data(using: .utf8),
              let root = try? JSONDecoder().decode(IEChecklistMirrorRoot.self, from: data),
              root.v == 1
        else {
            return DailyTasksWidgetBuilt(ring: fallbackRingFromWidgetData(), mode: .noMirror)
        }

        let sorted = sortedTodayTasks(root.tasks)
        let total = sorted.count
        if total == 0 {
            return DailyTasksWidgetBuilt(
                ring: IEWidgetDailyTasksRing(pct: 0, empty: true, done: 0, total: 0),
                mode: .noTasksToday,
            )
        }
        let ring = ringFromSortedToday(sorted)
        let done = sorted.filter(\.done).count
        if done >= total {
            return DailyTasksWidgetBuilt(ring: ring, mode: .allDone)
        }
        let pending = sorted.filter { !$0.done }
        let top = Array(pending.prefix(3)).map { ($0.id, $0.title) }
        return DailyTasksWidgetBuilt(ring: ring, mode: .list(rows: top))
    }

    private static func persistRing(_ ring: IEWidgetDailyTasksRing, defaults: UserDefaults) {
        let mini: [String: Any] = [
            "pct": ring.pct,
            "empty": ring.empty,
            "done": ring.done,
            "total": ring.total,
        ]
        guard let d = try? JSONSerialization.data(withJSONObject: mini),
              let str = String(data: d, encoding: .utf8) else { return }
        defaults.set(str, forKey: IEWidgetDailyTasksRing.appGroupStandaloneKey)
    }

    static func markDone(taskId: String) {
        guard let defaults = UserDefaults(suiteName: kAppGroupID) else { return }
        guard let raw = defaults.string(forKey: kChecklistMirrorKey), !raw.isEmpty,
              let data = raw.data(using: .utf8) else {
            return
        }
        guard var root = try? JSONDecoder().decode(IEChecklistMirrorRoot.self, from: data),
              root.v == 1 else {
            return
        }
        let ymd = todayYmd()
        guard let idx = root.tasks.firstIndex(where: {
            $0.id == taskId && $0.scope == "day" && $0.periodKey == ymd
        }) else { return }

        root.tasks[idx].done = true

        guard let out = try? JSONEncoder().encode(root),
              let outStr = String(data: out, encoding: .utf8) else { return }

        defaults.set(outStr, forKey: kChecklistMirrorKey)
        let sorted = sortedTodayTasks(root.tasks)
        persistRing(ringFromSortedToday(sorted), defaults: defaults)
        defaults.synchronize()
        DailyTasksWidgetTimelineKind.reloadAll()
    }
}

// MARK: - App Intent (iOS 17+)

@available(iOS 17.0, *)
struct ToggleDailyChecklistTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Completar tarea"
    static var description = IntentDescription("Marca una tarea diaria como hecha en IEStudio.")

    @Parameter(title: "ID de la tarea")
    var taskId: String

    init() {}

    init(taskId: String) {
        self.taskId = taskId
    }

    func perform() async throws -> some IntentResult {
        DailyTasksMirrorStore.markDone(taskId: taskId)
        return .result()
    }
}
