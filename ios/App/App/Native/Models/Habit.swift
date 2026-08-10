import Foundation

// MARK: - HabitKind / HabitTargetMode

enum HabitKind: String, Codable, Sendable, Hashable, CaseIterable {
    case check
    case measure

    /// Cualquier valor desconocido cae en `check`, como hace `normalizeKind` en la web.
    init(from decoder: any Decoder) throws {
        let raw = try? decoder.singleValueContainer().decode(String.self)
        self = (raw == "measure") ? .measure : .check
    }
}

enum HabitTargetMode: String, Codable, Sendable, Hashable, CaseIterable {
    case atLeast = "at_least"
    case exact

    init(from decoder: any Decoder) throws {
        let raw = try? decoder.singleValueContainer().decode(String.self)
        self = (raw == "exact") ? .exact : .atLeast
    }
}

// MARK: - HabitSchedule

/// Unión discriminada por `mode` en el JSON de TypeScript.
enum HabitSchedule: Codable, Sendable, Hashable {
    /// Días de la semana en convención JS: 0 = domingo … 6 = sábado.
    case weekdays([Int])
    /// Veces por semana, 1…7.
    case timesPerWeek(Int)

    static let `default` = HabitSchedule.weekdays([1, 2, 3, 4, 5])

    private enum CodingKeys: String, CodingKey {
        case mode, weekdays, timesPerWeek
    }

    var mode: String {
        switch self {
        case .weekdays: return "weekdays"
        case .timesPerWeek: return "times_per_week"
        }
    }

    /// Días programados (vacío si el hábito es de tipo «veces por semana»).
    var weekdayList: [Int] {
        if case .weekdays(let days) = self { return days }
        return []
    }

    var timesPerWeekValue: Int? {
        if case .timesPerWeek(let n) = self { return n }
        return nil
    }

    /// El periodo de registro es diario para `weekdays` y semanal para `times_per_week`.
    var isWeekly: Bool { timesPerWeekValue != nil }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let mode = (try? c.decodeIfPresent(String.self, forKey: .mode)) ?? nil

        switch mode {
        case "weekdays":
            // Los números pueden venir como 7.0 o fuera de rango: se normaliza
            // igual que `clampWeekday` (módulo 7) y se deduplica ordenado.
            let raw = ((try? c.decodeIfPresent([Double].self, forKey: .weekdays)) ?? nil) ?? []
            var set = Set<Int>()
            for value in raw where value.isFinite {
                set.insert(HabitDate.clampWeekday(Int(value.rounded(.towardZero))))
            }
            guard !set.isEmpty else {
                // Sin días la web descarta el hábito entero: se lanza para que
                // el contenedor lossy lo tire y no aparezca un hábito imposible.
                throw DecodingError.dataCorruptedError(
                    forKey: .weekdays, in: c,
                    debugDescription: "weekdays vacío"
                )
            }
            self = .weekdays(set.sorted())

        case "times_per_week":
            let raw = ((try? c.decodeIfPresent(Double.self, forKey: .timesPerWeek)) ?? nil) ?? 3
            let n = raw.isFinite ? Int(raw.rounded()) : 3
            self = .timesPerWeek(min(7, max(1, n)))

        default:
            throw DecodingError.dataCorruptedError(
                forKey: .mode, in: c,
                debugDescription: "mode desconocido: \(mode ?? "nil")"
            )
        }
    }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(mode, forKey: .mode)
        switch self {
        case .weekdays(let days):
            try c.encode(days, forKey: .weekdays)
        case .timesPerWeek(let n):
            try c.encode(n, forKey: .timesPerWeek)
        }
    }
}

// MARK: - HabitReminder

struct HabitReminder: Codable, Sendable, Hashable {
    var enabled: Bool
    /// Hora local "HH:mm".
    var timeLocal: String
    /// Mensaje motivador; cadena vacía si no hay.
    var message: String

    static let `default` = HabitReminder(enabled: false, timeLocal: "09:00", message: "")

    init(enabled: Bool, timeLocal: String, message: String) {
        self.enabled = enabled
        self.timeLocal = timeLocal
        self.message = message
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        enabled = ((try? c.decodeIfPresent(Bool.self, forKey: .enabled)) ?? nil) ?? false
        timeLocal = ((try? c.decodeIfPresent(String.self, forKey: .timeLocal)) ?? nil) ?? "09:00"
        message = ((try? c.decodeIfPresent(String.self, forKey: .message)) ?? nil) ?? ""
    }

    /// Componentes para programar la notificación local.
    var timeComponents: DateComponents? {
        guard let hm = HabitDate.hourMinute(from: timeLocal) else { return nil }
        return DateComponents(hour: hm.hour, minute: hm.minute)
    }
}

// MARK: - HabitDefinition

/// Definición de hábito. JSON en `iestudio-habits-v1` → `{ v: 1, habits: [...] }`.
struct HabitDefinition: Codable, Identifiable, Sendable, Hashable {
    static let storageKey = "iestudio-habits-v1"

    let id: String
    var title: String
    var kind: HabitKind
    var schedule: HabitSchedule
    /// Unidad para hábitos de medida ("min", "págs", "L"…).
    var unit: String?
    /// Objetivo numérico; `nil` o `null` = sin objetivo (cuenta con que sea > 0).
    var target: Double?
    var targetMode: HabitTargetMode?
    var reminder: HabitReminder?
    var createdAt: String
    var updatedAt: String
    var archived: Bool

    private enum CodingKeys: String, CodingKey {
        case id, title, kind, schedule, unit, target, targetMode, reminder
        case createdAt, updatedAt, archived
    }

    init(
        id: String,
        title: String,
        kind: HabitKind = .check,
        schedule: HabitSchedule = .default,
        unit: String? = nil,
        target: Double? = nil,
        targetMode: HabitTargetMode? = nil,
        reminder: HabitReminder? = nil,
        createdAt: String = "",
        updatedAt: String = "",
        archived: Bool = false
    ) {
        self.id = id
        self.title = title
        self.kind = kind
        self.schedule = schedule
        self.unit = unit
        self.target = target
        self.targetMode = targetMode
        self.reminder = reminder
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.archived = archived
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        let rawTitle = (((try? c.decodeIfPresent(String.self, forKey: .title)) ?? nil) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        title = rawTitle.isEmpty ? "(Sin título)" : rawTitle
        kind = ((try? c.decodeIfPresent(HabitKind.self, forKey: .kind)) ?? nil) ?? .check
        // Un `schedule` inválido invalida el hábito completo (como en la web).
        schedule = try c.decode(HabitSchedule.self, forKey: .schedule)

        let rawUnit = (((try? c.decodeIfPresent(String.self, forKey: .unit)) ?? nil) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        unit = rawUnit.isEmpty ? nil : rawUnit

        if let t = ((try? c.decodeIfPresent(Double.self, forKey: .target)) ?? nil), t.isFinite {
            target = t
        } else {
            target = nil
        }
        targetMode = ((try? c.decodeIfPresent(HabitTargetMode.self, forKey: .targetMode)) ?? nil)
        reminder = ((try? c.decodeIfPresent(HabitReminder.self, forKey: .reminder)) ?? nil)

        let created = (((try? c.decodeIfPresent(String.self, forKey: .createdAt)) ?? nil) ?? "")
        createdAt = created
        // La web usa createdAt como fallback de updatedAt.
        updatedAt = (((try? c.decodeIfPresent(String.self, forKey: .updatedAt)) ?? nil) ?? created)
        archived = (((try? c.decodeIfPresent(Bool.self, forKey: .archived)) ?? nil) ?? false)
    }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(title, forKey: .title)
        try c.encode(kind, forKey: .kind)
        try c.encode(schedule, forKey: .schedule)
        try c.encodeIfPresent(unit, forKey: .unit)
        // Solo los hábitos de medida escriben target/targetMode, y `target`
        // viaja como null explícito cuando no hay objetivo (igual que la web).
        if kind == .measure {
            try c.encode(target, forKey: .target)
            try c.encode(targetMode ?? .atLeast, forKey: .targetMode)
        }
        try c.encodeIfPresent(reminder, forKey: .reminder)
        try c.encode(createdAt, forKey: .createdAt)
        try c.encode(updatedAt, forKey: .updatedAt)
        if archived { try c.encode(true, forKey: .archived) }
    }
}

// MARK: - Programación y periodos

extension HabitDefinition {
    /// ¿Toca este hábito en esa fecha? Los `times_per_week` cuentan todos los días.
    func isScheduled(on date: Date = Date()) -> Bool {
        switch schedule {
        case .weekdays(let days):
            return days.contains(HabitDate.jsWeekday(of: date))
        case .timesPerWeek:
            return true
        }
    }

    /// Clave de registro en `HabitLogsFile`: día (YYYY-MM-DD) para `weekdays`,
    /// lunes de la semana para `times_per_week`.
    func periodKey(for date: Date = Date()) -> String {
        schedule.isWeekly ? HabitDate.mondayYMD(of: date) : HabitDate.ymd(of: date)
    }

    /// Objetivo utilizable (> 0) o nil.
    var usableTarget: Double? {
        guard let target, target > 0 else { return nil }
        return target
    }

    /// Réplica de `isHabitLogDone`: para medida, hecho = alcanzar el objetivo
    /// (o cualquier valor > 0 si no hay objetivo).
    func isDone(_ entry: HabitLogEntry?) -> Bool {
        guard let entry else { return false }
        if kind == .check { return entry.done ?? false }
        let value = entry.value ?? 0
        guard let target = usableTarget else { return value > 0 }
        return value >= target
    }

    /// Progreso 0…1 para anillos y barras.
    func progress(_ entry: HabitLogEntry?) -> Double {
        guard let entry else { return 0 }
        if kind == .check { return (entry.done ?? false) ? 1 : 0 }
        let value = entry.value ?? 0
        guard let target = usableTarget else { return value > 0 ? 1 : 0 }
        return min(1, max(0, value / target))
    }
}

// MARK: - HabitLogEntry

/// Registro de un hábito en un periodo. Ambos campos son opcionales: los de
/// tipo check usan `done`, los de medida acumulan en `value`.
struct HabitLogEntry: Codable, Sendable, Hashable {
    var done: Bool?
    var value: Double?

    private enum CodingKeys: String, CodingKey { case done, value }

    init(done: Bool? = nil, value: Double? = nil) {
        self.done = done
        self.value = value
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        done = ((try? c.decodeIfPresent(Bool.self, forKey: .done)) ?? nil)
        if let v = ((try? c.decodeIfPresent(Double.self, forKey: .value)) ?? nil), v.isFinite {
            value = v
        } else {
            value = nil
        }
    }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        // Las claves ausentes son significativas para la web: no se escriben nulls.
        try c.encodeIfPresent(done, forKey: .done)
        try c.encodeIfPresent(value, forKey: .value)
    }

    var isEmpty: Bool { done == nil && value == nil }
}

// MARK: - Ficheros de almacenamiento

/// Contenido de `iestudio-habits-v1`. Descarta hábitos corruptos en vez de fallar.
struct HabitsFile: Codable, Sendable {
    var v: Int
    var habits: [HabitDefinition]

    init(habits: [HabitDefinition] = []) {
        self.v = 1
        self.habits = habits
    }

    private enum CodingKeys: String, CodingKey { case v, habits }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        v = ((try? c.decodeIfPresent(Int.self, forKey: .v)) ?? nil) ?? 1
        var out: [HabitDefinition] = []
        if var list = try? c.nestedUnkeyedContainer(forKey: .habits) {
            while !list.isAtEnd {
                if let one = try? list.decode(HabitDefinition.self) {
                    out.append(one)
                } else {
                    _ = try? list.decode(HabitSkip.self)
                }
            }
        }
        // La web ordena por fecha de creación: se replica para que ambas
        // plataformas muestren la misma lista.
        habits = out.sorted { $0.createdAt < $1.createdAt }
    }

    var active: [HabitDefinition] { habits.filter { !$0.archived } }
}

/// Contenido de `iestudio-habit-logs-v1`: periodKey → habitId → entrada.
struct HabitLogsFile: Codable, Sendable {
    static let storageKey = "iestudio-habit-logs-v1"

    var v: Int
    var byPeriod: [String: [String: HabitLogEntry]]

    init(byPeriod: [String: [String: HabitLogEntry]] = [:]) {
        self.v = 1
        self.byPeriod = byPeriod
    }

    private enum CodingKeys: String, CodingKey { case v, byPeriod }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        v = ((try? c.decodeIfPresent(Int.self, forKey: .v)) ?? nil) ?? 1
        byPeriod = ((try? c.decodeIfPresent([String: [String: HabitLogEntry]].self, forKey: .byPeriod)) ?? nil) ?? [:]
    }

    func entry(periodKey: String, habitId: String) -> HabitLogEntry? {
        byPeriod[periodKey]?[habitId]
    }

    func entry(for habit: HabitDefinition, on date: Date = Date()) -> HabitLogEntry? {
        entry(periodKey: habit.periodKey(for: date), habitId: habit.id)
    }

    mutating func set(_ entry: HabitLogEntry, periodKey: String, habitId: String) {
        var bucket = byPeriod[periodKey] ?? [:]
        bucket[habitId] = entry
        byPeriod[periodKey] = bucket
    }
}

/// Comodín para saltar elementos rotos del array.
private struct HabitSkip: Decodable {
    init(from decoder: any Decoder) throws {
        _ = try decoder.singleValueContainer()
    }
}

// MARK: - Utilidades de fecha (privadas del fichero)

private enum HabitDate {
    /// Convierte cualquier entero al rango 0…6 con el mismo módulo que la web.
    static func clampWeekday(_ n: Int) -> Int { ((n % 7) + 7) % 7 }

    /// Día de la semana en convención JS (0 = domingo) a partir de un `Date`.
    /// `Calendar.weekday` es 1…7 empezando en domingo.
    static func jsWeekday(of date: Date) -> Int {
        Calendar.current.component(.weekday, from: date) - 1
    }

    static func hourMinute(from raw: String?) -> (hour: Int, minute: Int)? {
        guard let raw, raw.count == 5 else { return nil }
        let parts = raw.split(separator: ":")
        guard parts.count == 2,
              let h = Int(parts[0]), let m = Int(parts[1]),
              (0...23).contains(h), (0...59).contains(m)
        else { return nil }
        return (h, m)
    }

    /// "YYYY-MM-DD" en hora local (nunca UTC: la clave de periodo es local).
    static func ymd(of date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// Lunes de la semana de `date`, con semana empezando en lunes como en la web
    /// (no se usa `Calendar.firstWeekday`, que depende de la configuración regional).
    static func mondayYMD(of date: Date) -> String {
        let cal = Calendar.current
        let start = cal.startOfDay(for: date)
        let dow = jsWeekday(of: start)          // 0 = domingo
        let offset = dow == 0 ? -6 : 1 - dow
        let monday = cal.date(byAdding: .day, value: offset, to: start) ?? start
        return ymd(of: monday)
    }
}
