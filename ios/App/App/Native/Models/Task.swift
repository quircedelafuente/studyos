import Foundation

// MARK: - ChecklistPriority

/// Punto de color de la tarea: verde = baja, naranja = media, roja = alta.
enum ChecklistPriority: String, Codable, Sendable, Hashable, CaseIterable {
    case green
    case orange
    case red

    /// Cualquier valor desconocido cae en `green` (`normalizeChecklistPriority`).
    init(from decoder: any Decoder) throws {
        let raw = try? decoder.singleValueContainer().decode(String.self)
        self = ChecklistPriority(rawValue: raw ?? "") ?? .green
    }

    /// Orden para listar: primero lo urgente.
    var sortRank: Int {
        switch self {
        case .red: return 0
        case .orange: return 1
        case .green: return 2
        }
    }
}

// MARK: - ChecklistScope

/// `day`: `periodKey` es el día YYYY-MM-DD. `week`: el lunes de esa semana.
enum ChecklistScope: String, Codable, Sendable, Hashable, CaseIterable {
    case day
    case week
}

// MARK: - ChecklistTaskItem

/// Tarea del checklist diario/semanal.
/// JSON en `iestudio-daily-checklist-v1` → `{ v: 1, tasks: [...] }`.
struct ChecklistTaskItem: Codable, Identifiable, Sendable, Hashable {
    static let storageKey = "iestudio-daily-checklist-v1"

    let id: String
    var title: String
    var done: Bool
    /// ISO-8601 del navegador.
    var createdAt: String
    var scope: ChecklistScope
    /// "YYYY-MM-DD": el día (scope `day`) o el lunes de la semana (scope `week`).
    var periodKey: String
    var priority: ChecklistPriority

    private enum CodingKeys: String, CodingKey {
        case id, title, done, createdAt, scope, periodKey, priority
    }

    init(
        id: String,
        title: String,
        done: Bool = false,
        createdAt: String = "",
        scope: ChecklistScope = .day,
        periodKey: String,
        priority: ChecklistPriority = .green
    ) {
        self.id = id
        self.title = title
        self.done = done
        self.createdAt = createdAt
        self.scope = scope
        self.periodKey = periodKey
        self.priority = priority
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = ((try? c.decodeIfPresent(String.self, forKey: .title)) ?? nil) ?? ""
        done = ((try? c.decodeIfPresent(Bool.self, forKey: .done)) ?? nil) ?? false
        createdAt = ((try? c.decodeIfPresent(String.self, forKey: .createdAt)) ?? nil) ?? ""
        scope = ((try? c.decodeIfPresent(ChecklistScope.self, forKey: .scope)) ?? nil) ?? .day

        // Sin un periodKey válido la tarea no cae en ningún día ni semana: la
        // web la descarta y aquí se lanza para que el contenedor lossy la tire.
        let rawPeriod = ((try? c.decodeIfPresent(String.self, forKey: .periodKey)) ?? nil) ?? ""
        guard ChecklistDate.isYMD(rawPeriod) else {
            throw DecodingError.dataCorruptedError(
                forKey: .periodKey, in: c,
                debugDescription: "periodKey no es YYYY-MM-DD: \(rawPeriod)"
            )
        }
        periodKey = rawPeriod
        priority = ((try? c.decodeIfPresent(ChecklistPriority.self, forKey: .priority)) ?? nil) ?? .green
    }
}

// MARK: - Helpers de fecha y consulta

extension ChecklistTaskItem {
    /// Medianoche local del día (scope `day`) o del lunes (scope `week`).
    var periodStart: Date? { ChecklistDate.date(fromYMD: periodKey) }

    /// Último día del periodo: el mismo día, o el domingo de esa semana.
    var periodEndYMD: String? {
        switch scope {
        case .day: return periodKey
        case .week: return ChecklistDate.sundayAfterMonday(periodKey)
        }
    }

    /// ¿Pertenece la tarea al periodo que contiene `date`?
    func belongs(to date: Date) -> Bool {
        periodKey == Self.periodKey(for: date, scope: scope)
    }

    /// Clave de periodo que le corresponde a una fecha según el ámbito.
    static func periodKey(for date: Date = Date(), scope: ChecklistScope) -> String {
        switch scope {
        case .day: return ChecklistDate.ymd(of: date)
        case .week: return ChecklistDate.mondayYMD(of: date)
        }
    }

    static func todayYMD() -> String { ChecklistDate.ymd(of: Date()) }
    static func mondayYMD(of date: Date = Date()) -> String { ChecklistDate.mondayYMD(of: date) }

    /// Tareas de un periodo, ordenadas por prioridad y luego por antigüedad.
    static func tasks(
        _ all: [ChecklistTaskItem],
        scope: ChecklistScope,
        on date: Date = Date()
    ) -> [ChecklistTaskItem] {
        let key = periodKey(for: date, scope: scope)
        return all
            .filter { $0.scope == scope && $0.periodKey == key }
            .sorted { a, b in
                if a.priority != b.priority { return a.priority.sortRank < b.priority.sortRank }
                return a.createdAt < b.createdAt
            }
    }
}

/// Datos del anillo «Hoy (diarias)» del dashboard y del widget.
struct DailyTasksRing: Sendable, Hashable {
    var pct: Int
    var empty: Bool
    var done: Int
    var total: Int

    /// Misma fórmula que `dailyRingMetaFromTasks` en la web.
    init(tasks: [ChecklistTaskItem], on date: Date = Date()) {
        let key = ChecklistDate.ymd(of: date)
        let today = tasks.filter { $0.scope == .day && $0.periodKey == key }
        total = today.count
        done = today.filter(\.done).count
        empty = total == 0
        pct = total == 0 ? 0 : Int((100.0 * Double(done) / Double(total)).rounded())
    }
}

// MARK: - Fichero de almacenamiento

/// Contenido de `iestudio-daily-checklist-v1`. Descarta tareas corruptas.
struct ChecklistFile: Codable, Sendable {
    var v: Int
    var tasks: [ChecklistTaskItem]

    init(tasks: [ChecklistTaskItem] = []) {
        self.v = 1
        self.tasks = tasks
    }

    private enum CodingKeys: String, CodingKey { case v, tasks }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        v = ((try? c.decodeIfPresent(Int.self, forKey: .v)) ?? nil) ?? 1
        var out: [ChecklistTaskItem] = []
        if var list = try? c.nestedUnkeyedContainer(forKey: .tasks) {
            while !list.isAtEnd {
                if let one = try? list.decode(ChecklistTaskItem.self) {
                    out.append(one)
                } else {
                    _ = try? list.decode(ChecklistSkip.self)
                }
            }
        }
        tasks = out
    }
}

/// Comodín para saltar elementos rotos del array.
private struct ChecklistSkip: Decodable {
    init(from decoder: any Decoder) throws {
        _ = try decoder.singleValueContainer()
    }
}

// MARK: - Utilidades de fecha (privadas del fichero)

private enum ChecklistDate {
    static func isYMD(_ raw: String) -> Bool {
        guard raw.count == 10 else { return false }
        let parts = raw.split(separator: "-")
        guard parts.count == 3,
              parts[0].count == 4, parts[1].count == 2, parts[2].count == 2
        else { return false }
        return parts.allSatisfy { $0.allSatisfy(\.isNumber) }
    }

    static func ymd(of date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    static func date(fromYMD raw: String) -> Date? {
        let parts = raw.split(separator: "-")
        guard parts.count == 3,
              let y = Int(parts[0]), let mo = Int(parts[1]), let d = Int(parts[2])
        else { return nil }
        var comps = DateComponents()
        comps.year = y
        comps.month = mo
        comps.day = d
        return Calendar.current.date(from: comps)
    }

    /// Lunes de la semana local. La semana empieza en lunes por definición del
    /// producto, así que no se usa `Calendar.firstWeekday` (varía por región).
    static func mondayYMD(of date: Date) -> String {
        let cal = Calendar.current
        let start = cal.startOfDay(for: date)
        let dow = cal.component(.weekday, from: start) - 1   // 0 = domingo
        let offset = dow == 0 ? -6 : 1 - dow
        let monday = cal.date(byAdding: .day, value: offset, to: start) ?? start
        return ymd(of: monday)
    }

    /// Domingo de la misma semana que ese lunes.
    static func sundayAfterMonday(_ mondayYMD: String) -> String? {
        guard let monday = date(fromYMD: mondayYMD),
              let sunday = Calendar.current.date(byAdding: .day, value: 6, to: monday)
        else { return nil }
        return ymd(of: sunday)
    }
}
