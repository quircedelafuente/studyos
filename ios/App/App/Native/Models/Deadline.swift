import Foundation

// MARK: - DeadlineTag

/// Etiqueta reutilizable de «Exámenes y fechas».
/// JSON en localStorage: `iestudio-deadline-tags` → array plano de objetos.
struct DeadlineTag: Codable, Identifiable, Sendable, Hashable {
    static let storageKey = "iestudio-deadline-tags"

    let id: String
    var label: String
    /// ISO-8601 tal cual lo escribe el navegador (`new Date().toISOString()`).
    var createdAt: String

    init(id: String, label: String, createdAt: String = "") {
        self.id = id
        self.label = label
        self.createdAt = createdAt
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // `id` y `label` son lo único imprescindible: sin ellos la etiqueta no
        // sirve para nada, así que se deja lanzar y el contenedor lossy la tira.
        id = try c.decode(String.self, forKey: .id)
        label = try c.decode(String.self, forKey: .label)
        createdAt = c.lenient(String.self, .createdAt) ?? ""
    }

    var createdAtDate: Date? { DeadlineDate.isoDate(from: createdAt) }
}

// MARK: - ImportantDeadline

/// Examen o entrega manual. JSON en `iestudio-important-deadlines` (array plano).
struct ImportantDeadline: Codable, Identifiable, Sendable, Hashable {
    static let storageKey = "iestudio-important-deadlines"

    /// Duración asumida cuando el registro no trae `durationMinutes` (igual que la web).
    static let defaultDurationMinutes = 60
    /// `normalizeGoogleEventColorId` devuelve "18" cuando el id no es válido.
    static let defaultCalendarColorId = "18"

    let id: String
    var title: String
    /// Día local en formato "YYYY-MM-DD".
    var date: String
    /// Hora local "HH:mm" (24 h); `nil` = evento sin hora concreta.
    var time: String?
    /// Puede llegar como `null` desde la web; `nil` significa «usa el valor por defecto».
    var durationMinutes: Int?
    /// Id de curso manual. Los cursos NO se sincronizan, así que en iOS casi
    /// siempre es un id huérfano: para mostrar la asignatura usa `subject`.
    var courseId: String?
    var subject: String?
    var tagIds: [String]
    var calendarColorId: String
    var createdAt: String

    // Se declara a mano porque el tipo implementa init(from:) y encode(to:):
    // en ese caso el compilador ya no sintetiza CodingKeys.
    private enum CodingKeys: String, CodingKey {
        case id, title, date, time, durationMinutes, courseId, subject
        case tagIds, calendarColorId, createdAt
    }

    init(
        id: String,
        title: String,
        date: String,
        time: String? = nil,
        durationMinutes: Int? = nil,
        courseId: String? = nil,
        subject: String? = nil,
        tagIds: [String] = [],
        calendarColorId: String = ImportantDeadline.defaultCalendarColorId,
        createdAt: String = ""
    ) {
        self.id = id
        self.title = title
        self.date = date
        self.time = time
        self.durationMinutes = durationMinutes
        self.courseId = courseId
        self.subject = subject
        self.tagIds = tagIds
        self.calendarColorId = calendarColorId
        self.createdAt = createdAt
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = c.lenient(String.self, .title) ?? ""
        date = c.lenient(String.self, .date) ?? ""

        // "time" llega como string, null o directamente ausente, y hay registros
        // antiguos con basura ("", "9:00"): solo se acepta HH:mm estricto.
        let rawTime = c.lenient(String.self, .time)
        time = DeadlineDate.hourMinute(from: rawTime) == nil ? nil : rawTime

        // Se lee como Double porque JS puede haber guardado 60.0 o 90.5.
        if let mins = c.lenient(Double.self, .durationMinutes), mins.isFinite, mins > 0 {
            durationMinutes = Int(mins.rounded())
        } else {
            durationMinutes = nil
        }

        courseId = c.lenient(String.self, .courseId)
        let trimmedSubject = c.lenient(String.self, .subject)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        subject = (trimmedSubject?.isEmpty ?? true) ? nil : trimmedSubject
        tagIds = c.lenient([String].self, .tagIds) ?? []
        calendarColorId = c.lenient(String.self, .calendarColorId) ?? Self.defaultCalendarColorId
        createdAt = c.lenient(String.self, .createdAt) ?? ""
    }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(title, forKey: .title)
        try c.encode(date, forKey: .date)
        // La web espera `time`, `durationMinutes`, `courseId` y `subject`
        // presentes con valor null, no ausentes: se codifican siempre.
        try c.encode(time, forKey: .time)
        try c.encode(durationMinutes, forKey: .durationMinutes)
        try c.encode(courseId, forKey: .courseId)
        try c.encode(subject, forKey: .subject)
        try c.encode(tagIds, forKey: .tagIds)
        try c.encode(calendarColorId, forKey: .calendarColorId)
        try c.encode(createdAt, forKey: .createdAt)
    }
}

// MARK: - Helpers de fecha

extension ImportantDeadline {
    /// Duración efectiva en minutos (60 si el registro no la trae).
    var effectiveDurationMinutes: Int { durationMinutes ?? Self.defaultDurationMinutes }

    /// Medianoche local del día del deadline.
    var dayStart: Date? { DeadlineDate.date(fromYMD: date) }

    /// Instante de inicio: día + hora si la hay; si no, medianoche local.
    var startDate: Date? {
        guard let day = dayStart else { return nil }
        guard let hm = DeadlineDate.hourMinute(from: time) else { return day }
        return Calendar.current.date(bySettingHour: hm.hour, minute: hm.minute, second: 0, of: day)
    }

    /// Fin estimado del bloque (solo tiene sentido si hay hora).
    var endDate: Date? {
        guard let start = startDate else { return nil }
        return Calendar.current.date(byAdding: .minute, value: effectiveDurationMinutes, to: start)
    }

    var isAllDay: Bool { time == nil }

    /// Fecha de creación parseada del ISO-8601 del navegador.
    var createdAtDate: Date? { DeadlineDate.isoDate(from: createdAt) }

    /// Días naturales desde hoy: 0 = hoy, negativo = ya pasó.
    var daysFromToday: Int? {
        guard let day = dayStart else { return nil }
        let cal = Calendar.current
        return cal.dateComponents([.day], from: cal.startOfDay(for: Date()), to: day).day
    }

    var isToday: Bool { daysFromToday == 0 }

    /// Pasado = día anterior a hoy (un examen de hoy sigue contando como pendiente).
    var isPast: Bool { (daysFromToday ?? 0) < 0 }

    func hasTag(_ tagId: String) -> Bool { tagIds.contains(tagId) }

    /// Orden natural en las listas: por día y, dentro del día, por hora
    /// (los de todo el día primero).
    static func sortedByDate(_ list: [ImportantDeadline]) -> [ImportantDeadline] {
        list.sorted { a, b in
            if a.date != b.date { return a.date < b.date }
            return (a.time ?? "") < (b.time ?? "")
        }
    }
}

// MARK: - Contenedores tolerantes

/// Array de deadlines que descarta elementos corruptos en vez de fallar entero.
/// Se decodifica/codifica como el array plano que guarda la web.
struct DeadlineList: Codable, Sendable {
    var items: [ImportantDeadline]

    init(items: [ImportantDeadline] = []) { self.items = items }

    init(from decoder: any Decoder) throws {
        var c = try decoder.unkeyedContainer()
        var out: [ImportantDeadline] = []
        out.reserveCapacity(c.count ?? 0)
        while !c.isAtEnd {
            if let one = try? c.decode(ImportantDeadline.self) {
                out.append(one)
            } else {
                // Hay que consumir el elemento sí o sí: si no, bucle infinito.
                _ = try? c.decode(DeadlineSkip.self)
            }
        }
        items = out
    }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(items)
    }
}

/// Igual que `DeadlineList` pero para el registro global de etiquetas.
struct DeadlineTagList: Codable, Sendable {
    var items: [DeadlineTag]

    init(items: [DeadlineTag] = []) { self.items = items }

    init(from decoder: any Decoder) throws {
        var c = try decoder.unkeyedContainer()
        var out: [DeadlineTag] = []
        while !c.isAtEnd {
            if let one = try? c.decode(DeadlineTag.self) {
                out.append(one)
            } else {
                _ = try? c.decode(DeadlineSkip.self)
            }
        }
        items = out
    }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(items)
    }
}

/// Comodín que decodifica cualquier JSON: sirve para saltar elementos rotos.
private struct DeadlineSkip: Decodable {
    init(from decoder: any Decoder) throws {
        _ = try decoder.singleValueContainer()
    }
}

// MARK: - Utilidades privadas del fichero

private extension KeyedDecodingContainer {
    /// Decodifica sin lanzar: clave ausente, null o tipo equivocado → nil.
    func lenient<T: Decodable>(_ type: T.Type, _ key: Key) -> T? {
        (try? decodeIfPresent(type, forKey: key)) ?? nil
    }
}

private enum DeadlineDate {
    /// Parsea "HH:mm" a mano (inmune a locales de 12 h y a DateFormatter).
    static func hourMinute(from raw: String?) -> (hour: Int, minute: Int)? {
        guard let raw, raw.count == 5 else { return nil }
        let parts = raw.split(separator: ":")
        guard parts.count == 2,
              parts[0].count == 2, parts[1].count == 2,
              let h = Int(parts[0]), let m = Int(parts[1]),
              (0...23).contains(h), (0...59).contains(m)
        else { return nil }
        return (h, m)
    }

    /// "YYYY-MM-DD" → medianoche en la zona horaria del dispositivo.
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

    // Se usa ISO8601FormatStyle (struct Sendable) en vez de ISO8601DateFormatter,
    // que al ser una clase no puede guardarse en un `static let` bajo Swift 6.
    static let isoWithFraction = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
    static let isoPlain = Date.ISO8601FormatStyle()

    /// `toISOString()` siempre lleva milisegundos, pero hay registros migrados
    /// a mano que no: se prueban las dos variantes.
    static func isoDate(from raw: String) -> Date? {
        if raw.isEmpty { return nil }
        return (try? isoWithFraction.parse(raw)) ?? (try? isoPlain.parse(raw))
    }
}
