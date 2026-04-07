import Foundation
import WidgetKit

// MARK: - App Group

let kAppGroupID      = "group.com.agustmun.iestudio"
let kWidgetDataKey   = "iestudio_widget_data"
/// Copia del checklist web (`iestudio-daily-checklist-v1`) para el widget interactivo y reconciliación.
let kChecklistMirrorKey = "iestudio_daily_checklist_mirror"

// MARK: - Top-level container

struct IEWidgetData: Codable {
    var deadlines:    [IEWidgetDeadline]
    var todaySessions:[IEWidgetSession]
    var activeSession:IEWidgetActiveSession?
    var bbDeliveries: [IEWidgetDelivery]
    /// Puntos del gráfico StudyTrend (±6 días); opcional por compatibilidad con JSON antiguos.
    var studyTrend:   [IEWidgetStudyTrendPoint]?
    /// Anillo "Hoy (diarias)" del checklist (Tareas).
    var dailyTasksRing: IEWidgetDailyTasksRing?
    var lastUpdated:  Double          // Unix ms

    static var empty: IEWidgetData {
        IEWidgetData(
            deadlines: [],
            todaySessions: [],
            activeSession: nil,
            bbDeliveries: [],
            studyTrend: nil,
            dailyTasksRing: nil,
            lastUpdated: 0,
        )
    }

    static func load() -> IEWidgetData {
        guard
            let defaults = UserDefaults(suiteName: kAppGroupID),
            let raw      = defaults.string(forKey: kWidgetDataKey),
            let data     = raw.data(using: .utf8),
            let decoded  = try? JSONDecoder().decode(IEWidgetData.self, from: data)
        else { return .empty }
        return decoded
    }
}

// MARK: - Deadlines

struct IEWidgetDeadline: Codable, Identifiable {
    var id:      String
    var title:   String
    var subject: String
    var date:    String   // YYYY-MM-DD
    var isExam:  Bool
    var urgency: String   // "red" | "yellow" | "normal"

    var daysRemaining: Int {
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd"
        guard let d = fmt.date(from: date) else { return 999 }
        let cal   = Calendar.current
        let today = cal.startOfDay(for: Date())
        let target = cal.startOfDay(for: d)
        return cal.dateComponents([.day], from: today, to: target).day ?? 999
    }

    var urgencyColor: String {
        switch urgency {
        case "red":    return "red"
        case "yellow": return "yellow"
        default:       return daysRemaining <= 3 ? "red" : daysRemaining <= 7 ? "yellow" : "normal"
        }
    }
}

// MARK: - Study trend (dashboard chart)

struct IEWidgetStudyTrendPoint: Codable {
    var label:   String
    var hours:   Double
    var isToday: Bool
}

// MARK: - Daily tasks (hoy diarias)

struct IEWidgetDailyTasksRing: Codable {
    /// 0…100
    var pct:   Int
    var empty: Bool
    var done:  Int
    var total: Int

    /// Copia reducida escrita por `WidgetDataPlugin` para que el widget siga funcionando
    /// aunque falle el decode del JSON completo (p. ej. `null` en algún `Double`).
    static let appGroupStandaloneKey = "iestudio_widget_daily_tasks_ring"

    static func loadStandalone(from defaults: UserDefaults) -> IEWidgetDailyTasksRing? {
        guard
            let raw = defaults.string(forKey: appGroupStandaloneKey),
            let data = raw.data(using: .utf8),
            let decoded = try? JSONDecoder().decode(IEWidgetDailyTasksRing.self, from: data)
        else { return nil }
        return decoded
    }
}

// MARK: - Today sessions

struct IEWidgetSession: Codable, Identifiable {
    var id:           String   // session key
    var sessionTitle: String
    var planTitle:    String
    var studyHours:   Double
    var focus:        String
    var date:         String
}

// MARK: - Active session (Study Arena)

struct IEWidgetActiveSession: Codable {
    var sessionTitle:    String
    var planTitle:       String
    var focusScore:      Int
    var distractionCount:Int
    var elapsedActiveMs: Double
    var totalDurationMs: Double
    var endTimestampMs:  Double
    var isPaused:        Bool

    var progressPct: Double {
        guard totalDurationMs > 0 else { return 0 }
        return min(100, (elapsedActiveMs / totalDurationMs) * 100)
    }

    var endDate: Date {
        Date(timeIntervalSince1970: endTimestampMs / 1000.0)
    }

    var remainingSeconds: Int {
        max(0, Int((endTimestampMs / 1000.0) - Date().timeIntervalSince1970))
    }

    func formatRemaining() -> String {
        let s = remainingSeconds
        let h = s / 3600
        let m = (s % 3600) / 60
        let sec = s % 60
        if h > 0 { return String(format: "%d:%02d:%02d", h, m, sec) }
        return String(format: "%02d:%02d", m, sec)
    }
}

// MARK: - BB Deliveries

struct IEWidgetDelivery: Codable, Identifiable {
    var id:         String
    var courseName: String
    var title:      String
    var dueDate:    String   // ISO or YYYY-MM-DD
    var urgency:    String   // "red" | "yellow"

    var daysRemaining: Int {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var d: Date? = formatter.date(from: dueDate)
        if d == nil {
            let fmt2 = DateFormatter()
            fmt2.dateFormat = "yyyy-MM-dd"
            d = fmt2.date(from: dueDate)
        }
        guard let due = d else { return 999 }
        let cal   = Calendar.current
        let today = cal.startOfDay(for: Date())
        let target = cal.startOfDay(for: due)
        return cal.dateComponents([.day], from: today, to: target).day ?? 999
    }
}
