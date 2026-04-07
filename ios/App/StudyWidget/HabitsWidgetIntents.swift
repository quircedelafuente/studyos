import AppIntents
import Foundation
import WidgetKit

// MARK: - Mirror decode (mismo JSON que la web)

private struct IEHabitsMirrorRoot: Codable { var v: Int; var habits: [IEHabitDef] }

private struct IEHabitDef: Codable {
    var id: String
    var title: String
    var kind: String              // "check" | "measure"
    var schedule: IEHabitSchedule
    var unit: String?
    var target: Double?
    var targetMode: String?
    var archived: Bool?
    var createdAt: String
}

private struct IEHabitSchedule: Codable {
    var mode: String              // "weekdays" | "times_per_week"
    var weekdays: [Int]?
    var timesPerWeek: Int?
}

private struct IEHabitLogsMirrorRoot: Codable { var v: Int; var byPeriod: [String: [String: IEHabitLogEntry]] }

private struct IEHabitLogEntry: Codable {
    var done: Bool?
    var value: Double?
}

private func todayYmd() -> String {
    let cal = Calendar.current
    let n = Date()
    let y = cal.component(.year, from: n)
    let mo = cal.component(.month, from: n)
    let d = cal.component(.day, from: n)
    return String(format: "%04d-%02d-%02d", y, mo, d)
}

private func mondayYmd() -> String {
    let cal = Calendar.current
    let now = Date()
    let start = cal.startOfDay(for: now)
    let dow = cal.component(.weekday, from: start) // 1=Sun..7=Sat
    let offset = dow == 1 ? -6 : 2 - dow
    let mon = cal.date(byAdding: .day, value: offset, to: start) ?? start
    let y = cal.component(.year, from: mon)
    let mo = cal.component(.month, from: mon)
    let d = cal.component(.day, from: mon)
    return String(format: "%04d-%02d-%02d", y, mo, d)
}

private func periodKey(for habit: IEHabitDef) -> String {
    if habit.schedule.mode == "times_per_week" { return mondayYmd() }
    return todayYmd()
}

private func isScheduledToday(_ habit: IEHabitDef) -> Bool {
    if habit.schedule.mode == "times_per_week" { return true }
    let wd0 = Calendar.current.component(.weekday, from: Date()) - 1 // 0..6
    return habit.schedule.weekdays?.contains(wd0) ?? false
}

private func doneForHabit(_ h: IEHabitDef, _ e: IEHabitLogEntry?) -> Bool {
    if h.kind == "check" { return e?.done ?? false }
    let v = e?.value ?? 0
    let tgt = h.target ?? 0
    if tgt <= 0 { return v > 0 }
    return v >= tgt
}

enum HabitsMirrorStore {
    static func loadHabitsAndLogs() -> (habits: [IEHabitDef], logs: IEHabitLogsMirrorRoot) {
        let defaults = UserDefaults(suiteName: kAppGroupID)
        let habitsRaw = defaults?.string(forKey: kHabitsMirrorKey) ?? ""
        let logsRaw = defaults?.string(forKey: kHabitLogsMirrorKey) ?? ""

        let habits: [IEHabitDef]
        if let d = habitsRaw.data(using: .utf8),
           let root = try? JSONDecoder().decode(IEHabitsMirrorRoot.self, from: d),
           root.v == 1 {
            habits = root.habits
        } else {
            habits = []
        }

        let logs: IEHabitLogsMirrorRoot
        if let d = logsRaw.data(using: .utf8),
           let root = try? JSONDecoder().decode(IEHabitLogsMirrorRoot.self, from: d),
           root.v == 1 {
            logs = root
        } else {
            logs = IEHabitLogsMirrorRoot(v: 1, byPeriod: [:])
        }
        return (habits, logs)
    }

    static func saveLogs(_ logs: IEHabitLogsMirrorRoot) {
        guard let defaults = UserDefaults(suiteName: kAppGroupID) else { return }
        guard let d = try? JSONEncoder().encode(logs),
              let s = String(data: d, encoding: .utf8) else { return }
        defaults.set(s, forKey: kHabitLogsMirrorKey)
        defaults.synchronize()
        WidgetCenter.shared.reloadTimelines(ofKind: "HabitsWidget")
    }

    static func toggleCheck(habitId: String) {
        let (habits, logs) = loadHabitsAndLogs()
        guard let h = habits.first(where: { $0.id == habitId }) else { return }
        let pk = periodKey(for: h)
        var next = logs
        var bucket = next.byPeriod[pk] ?? [:]
        let prev = bucket[habitId]
        let nowDone = !(prev?.done ?? false)
        bucket[habitId] = IEHabitLogEntry(done: nowDone, value: prev?.value)
        next.byPeriod[pk] = bucket
        saveLogs(next)
    }

    static func addMeasure(habitId: String, delta: Double) {
        let (habits, logs) = loadHabitsAndLogs()
        guard let h = habits.first(where: { $0.id == habitId }) else { return }
        let pk = periodKey(for: h)
        var next = logs
        var bucket = next.byPeriod[pk] ?? [:]
        let prev = bucket[habitId]
        let v = max(0, (prev?.value ?? 0) + delta)
        bucket[habitId] = IEHabitLogEntry(done: prev?.done, value: v)
        next.byPeriod[pk] = bucket
        saveLogs(next)
    }

    static func topToday(max: Int) -> [(id: String, title: String, kind: String, value: Double, unit: String, done: Bool)] {
        let (habits, logs) = loadHabitsAndLogs()
        let today = habits
            .filter { !($0.archived ?? false) }
            .filter { isScheduledToday($0) }
            .sorted { $0.createdAt < $1.createdAt }
        var out: [(String, String, String, Double, String, Bool)] = []
        for h in today {
            if out.count >= max { break }
            let pk = periodKey(for: h)
            let e = logs.byPeriod[pk]?[h.id]
            let done = doneForHabit(h, e)
            if done { continue }
            let unit = h.unit ?? ""
            let value = e?.value ?? 0
            out.append((h.id, h.title, h.kind, value, unit, done))
        }
        return out
    }
}

// MARK: - App Intents

@available(iOS 17.0, *)
struct ToggleHabitIntent: AppIntent {
    static var title: LocalizedStringResource = "Completar hábito"

    @Parameter(title: "ID del hábito")
    var habitId: String

    init() {}
    init(habitId: String) { self.habitId = habitId }

    func perform() async throws -> some IntentResult {
        HabitsMirrorStore.toggleCheck(habitId: habitId)
        return .result()
    }
}

@available(iOS 17.0, *)
struct AddHabitMeasureIntent: AppIntent {
    static var title: LocalizedStringResource = "Sumar medida"

    @Parameter(title: "ID del hábito")
    var habitId: String

    @Parameter(title: "Delta")
    var delta: Double

    init() {}
    init(habitId: String, delta: Double) {
        self.habitId = habitId
        self.delta = delta
    }

    func perform() async throws -> some IntentResult {
        HabitsMirrorStore.addMeasure(habitId: habitId, delta: delta)
        return .result()
    }
}

