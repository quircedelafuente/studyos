import Foundation

// MARK: - CompletedSession

/// Sesión de Study Arena ya completada.
/// JSON en `iestudio-study-arena-completed` → array plano, más recientes primero.
struct CompletedSession: Codable, Identifiable, Sendable, Hashable {
    static let storageKey = "iestudio-study-arena-completed"
    /// Lápidas de borrado: array plano de ids (completionId y arenaRunId).
    static let deletedStorageKey = "iestudio-study-arena-completed-deleted"
    static let maxStored = 10_000

    /// Id único de cada finalización (la misma sesión puede repetirse).
    let completionId: String
    /// ISO-8601 del momento de completar.
    var completedAt: String
    /// Id único de la ejecución; enlaza con las notas del Parking Lot.
    var arenaRunId: String

    // Datos de la sesión planificada
    var key: String
    var planId: String
    var planTitle: String
    /// Día de la sesión en el plan, "YYYY-MM-DD".
    var date: String
    var studyHours: Double
    var focus: String
    var sessionTitle: String?

    // Métricas
    /// 0…100.
    var focusScore: Double
    var distractionCount: Int
    var elapsedActiveMs: Double
    var totalDurationMs: Double
    /// Epoch en milisegundos (`Date.now()` de JS).
    var startedAtMs: Double

    var id: String { completionId }

    private enum CodingKeys: String, CodingKey {
        case completionId, completedAt, arenaRunId
        case key, planId, planTitle, date, studyHours, focus, sessionTitle
        case focusScore, distractionCount, elapsedActiveMs, totalDurationMs, startedAtMs
    }

    init(
        completionId: String,
        completedAt: String,
        arenaRunId: String,
        key: String = "",
        planId: String = "",
        planTitle: String = "",
        date: String = "",
        studyHours: Double = 0,
        focus: String = "",
        sessionTitle: String? = nil,
        focusScore: Double = 0,
        distractionCount: Int = 0,
        elapsedActiveMs: Double = 0,
        totalDurationMs: Double = 0,
        startedAtMs: Double = 0
    ) {
        self.completionId = completionId
        self.completedAt = completedAt
        self.arenaRunId = arenaRunId
        self.key = key
        self.planId = planId
        self.planTitle = planTitle
        self.date = date
        self.studyHours = studyHours
        self.focus = focus
        self.sessionTitle = sessionTitle
        self.focusScore = focusScore
        self.distractionCount = distractionCount
        self.elapsedActiveMs = elapsedActiveMs
        self.totalDurationMs = totalDurationMs
        self.startedAtMs = startedAtMs
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // Sin completionId no hay identidad estable para la lista.
        completionId = try c.decode(String.self, forKey: .completionId)
        completedAt = c.lenientString(.completedAt) ?? ""
        // Registros muy antiguos no tenían arenaRunId; se cae al completionId
        // para que la deduplicación por run siga funcionando.
        arenaRunId = c.lenientString(.arenaRunId) ?? completionId

        key = c.lenientString(.key) ?? ""
        planId = c.lenientString(.planId) ?? ""
        planTitle = c.lenientString(.planTitle) ?? ""
        date = c.lenientString(.date) ?? ""
        studyHours = c.lenientNumber(.studyHours) ?? 0
        focus = c.lenientString(.focus) ?? ""
        let rawTitle = c.lenientString(.sessionTitle)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        sessionTitle = (rawTitle?.isEmpty ?? true) ? nil : rawTitle

        focusScore = min(100, max(0, c.lenientNumber(.focusScore) ?? 0))
        distractionCount = Int(c.lenientNumber(.distractionCount) ?? 0)
        elapsedActiveMs = c.lenientNumber(.elapsedActiveMs) ?? 0
        totalDurationMs = c.lenientNumber(.totalDurationMs) ?? 0
        startedAtMs = c.lenientNumber(.startedAtMs) ?? 0
    }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(completionId, forKey: .completionId)
        try c.encode(completedAt, forKey: .completedAt)
        try c.encode(arenaRunId, forKey: .arenaRunId)
        try c.encode(key, forKey: .key)
        try c.encode(planId, forKey: .planId)
        try c.encode(planTitle, forKey: .planTitle)
        try c.encode(date, forKey: .date)
        try c.encode(studyHours, forKey: .studyHours)
        try c.encode(focus, forKey: .focus)
        // `sessionTitle` es opcional en TS: si no hay, se omite la clave.
        try c.encodeIfPresent(sessionTitle, forKey: .sessionTitle)
        try c.encode(focusScore, forKey: .focusScore)
        try c.encode(distractionCount, forKey: .distractionCount)
        try c.encode(elapsedActiveMs, forKey: .elapsedActiveMs)
        try c.encode(totalDurationMs, forKey: .totalDurationMs)
        try c.encode(startedAtMs, forKey: .startedAtMs)
    }
}

// MARK: - Helpers de fecha y métricas

extension CompletedSession {
    /// Instante en que se completó (parseado del ISO).
    var completedAtDate: Date? { SessionDate.isoDate(from: completedAt) }

    /// Instante de arranque, a partir del epoch en milisegundos.
    var startedAtDate: Date? {
        startedAtMs > 0 ? Date(timeIntervalSince1970: startedAtMs / 1000) : nil
    }

    /// Medianoche local del día planificado ("YYYY-MM-DD").
    var dayStart: Date? { SessionDate.date(fromYMD: date) }

    /// Día local en el que se completó realmente, que puede no ser `date`
    /// (una sesión del lunes se puede recuperar el miércoles). Es el que hay
    /// que usar para agrupar historial y rachas.
    var completedDayYMD: String {
        guard let d = completedAtDate else { return date }
        return SessionDate.ymd(of: d)
    }

    /// Tiempo realmente activo (sin pausas ni distracciones).
    var activeDuration: TimeInterval { max(0, elapsedActiveMs / 1000) }
    var totalDuration: TimeInterval { max(0, totalDurationMs / 1000) }
    var activeMinutes: Int { Int((activeDuration / 60).rounded()) }
    var activeHours: Double { activeDuration / 3600 }

    /// Título a mostrar: el de la sesión, o el foco, o la fecha.
    var displayTitle: String {
        if let sessionTitle, !sessionTitle.isEmpty { return sessionTitle }
        if !focus.isEmpty { return focus }
        return date
    }

    /// "1 h 25 min" / "25 min" a partir del tiempo activo.
    var activeDurationLabel: String {
        let mins = activeMinutes
        if mins < 60 { return "\(mins) min" }
        let h = mins / 60
        let m = mins % 60
        return m == 0 ? "\(h) h" : "\(h) h \(m) min"
    }
}

// MARK: - Lista + lápidas

/// Array de sesiones completadas que descarta elementos corruptos.
struct CompletedSessionList: Codable, Sendable {
    var items: [CompletedSession]

    init(items: [CompletedSession] = []) { self.items = items }

    init(from decoder: any Decoder) throws {
        var c = try decoder.unkeyedContainer()
        var out: [CompletedSession] = []
        out.reserveCapacity(c.count ?? 0)
        while !c.isAtEnd {
            if let one = try? c.decode(CompletedSession.self) {
                out.append(one)
            } else {
                _ = try? c.decode(SessionSkip.self)
            }
        }
        items = out
    }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(items)
    }
}

/// Contenido de `iestudio-study-arena-completed-deleted`: ids borrados.
struct CompletedSessionTombstones: Codable, Sendable {
    var ids: Set<String>

    init(ids: Set<String> = []) { self.ids = ids }

    init(from decoder: any Decoder) throws {
        var c = try decoder.unkeyedContainer()
        var out = Set<String>()
        while !c.isAtEnd {
            if let s = try? c.decode(String.self) {
                out.insert(s)
            } else {
                _ = try? c.decode(SessionSkip.self)
            }
        }
        ids = out
    }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(ids.sorted())
    }
}

extension CompletedSession {
    /// Réplica exacta de `loadCompletedSessions` en la web: aplica lápidas,
    /// deduplica por `arenaRunId` y ordena de más reciente a más antigua.
    ///
    /// Se miran las lápidas contra los dos ids porque la fusión en la nube deja
    /// clones del mismo run con `completionId` distinto: mirando solo uno, los
    /// clones sobreviven y la sesión borrada reaparece al recargar.
    static func visible(
        raw: [CompletedSession],
        deleted: Set<String>
    ) -> [CompletedSession] {
        var seenRuns = Set<String>()
        var out: [CompletedSession] = []
        for s in raw {
            if deleted.contains(s.completionId) || deleted.contains(s.arenaRunId) { continue }
            if seenRuns.contains(s.arenaRunId) { continue }
            seenRuns.insert(s.arenaRunId)
            out.append(s)
        }
        return out.sorted { $0.completedAt > $1.completedAt }
    }

    /// Agrupadas por día local de finalización (clave "YYYY-MM-DD").
    static func groupedByDay(_ sessions: [CompletedSession]) -> [String: [CompletedSession]] {
        Dictionary(grouping: sessions, by: \.completedDayYMD)
    }

    /// Horas activas totales de un día concreto.
    static func activeHours(_ sessions: [CompletedSession], onDay ymd: String) -> Double {
        sessions.filter { $0.completedDayYMD == ymd }.reduce(0) { $0 + $1.activeHours }
    }
}

/// Comodín para saltar elementos rotos del array.
private struct SessionSkip: Decodable {
    init(from decoder: any Decoder) throws {
        _ = try decoder.singleValueContainer()
    }
}

// MARK: - Utilidades privadas del fichero

private extension KeyedDecodingContainer {
    /// Decodifica sin lanzar: clave ausente, null o tipo equivocado → nil.
    func lenientString(_ key: Key) -> String? {
        (try? decodeIfPresent(String.self, forKey: key)) ?? nil
    }

    /// Todos los numéricos llegan como `number` de JS: se leen como Double y
    /// se descartan NaN/infinitos, que romperían los cálculos de la UI.
    func lenientNumber(_ key: Key) -> Double? {
        guard let v = ((try? decodeIfPresent(Double.self, forKey: key)) ?? nil), v.isFinite else {
            return nil
        }
        return v
    }
}

private enum SessionDate {
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

    // ISO8601FormatStyle es un struct Sendable; ISO8601DateFormatter (clase) no
    // se puede guardar en un `static let` bajo Swift 6.
    static let isoWithFraction = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
    static let isoPlain = Date.ISO8601FormatStyle()

    static func isoDate(from raw: String) -> Date? {
        if raw.isEmpty { return nil }
        return (try? isoWithFraction.parse(raw)) ?? (try? isoPlain.parse(raw))
    }
}
