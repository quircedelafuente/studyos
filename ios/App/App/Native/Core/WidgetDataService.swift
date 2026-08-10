import Foundation
import WidgetKit

/// Alimenta los widgets con datos reales.
///
/// Antes lo hacía `WidgetDataPlugin` recibiendo llamadas del WebView. Sin
/// WebView, el cálculo se hace aquí a partir de `SyncStore` y se escribe en el
/// App Group que leen las extensiones.
///
/// `IEStudioWidgetData.swift` se comparte entre este target y el de los
/// widgets, así que las estructuras son literalmente las mismas: no hay forma
/// de que el escritor y el lector se desincronicen.
enum WidgetDataService {
    private static let appGroupID = "group.com.agustmun.iestudio"
    private static let widgetDataKey = "iestudio_widget_data"
    private static let checklistMirrorKey = "iestudio_daily_checklist_mirror"
    private static let habitsMirrorKey = "iestudio_habits_mirror"
    private static let habitLogsMirrorKey = "iestudio_habit_logs_mirror"

    private static var defaults: UserDefaults? { UserDefaults(suiteName: appGroupID) }

    // MARK: - Punto de entrada

    /// Recalcula todo y refresca las líneas de tiempo.
    ///
    /// Se llama tras cada `SyncStore.refresh()` y tras cambios locales. Es
    /// barato: son unos pocos miles de registros en memoria.
    static func rebuild() async {
        guard let defaults else { return }

        let deadlines = await SyncStore.shared.decoded(DeadlineList.self,
                                                       forKey: StorageKeys.deadlines)?.items ?? []
        let checklist = await SyncStore.shared.decoded(ChecklistFile.self,
                                                       forKey: StorageKeys.dailyChecklist)
        let sessions = await SyncStore.shared.decoded(CompletedSessionList.self,
                                                      forKey: StorageKeys.studyArenaCompleted)?.items ?? []
        let tombstones = await SyncStore.shared.decoded(CompletedSessionTombstones.self,
                                                        forKey: StorageKeys.studyArenaCompletedDeleted)?.ids ?? []

        let payload = build(deadlines: deadlines,
                            checklist: checklist,
                            sessions: sessions,
                            tombstones: Set(tombstones))

        if let json = try? JSONEncoder().encode(payload),
           let raw = String(data: json, encoding: .utf8) {
            defaults.set(raw, forKey: widgetDataKey)
        }

        await writeMirrors(defaults: defaults)
        WidgetCenter.shared.reloadAllTimelines()
    }

    // MARK: - Construcción del payload

    static func build(
        deadlines: [ImportantDeadline],
        checklist: ChecklistFile?,
        sessions: [CompletedSession],
        tombstones: Set<String>,
        now: Date = Date()
    ) -> IEWidgetData {
        IEWidgetData(
            deadlines: widgetDeadlines(from: deadlines, now: now),
            todaySessions: [],
            activeSession: nil,
            bbDeliveries: [],
            upcomingEntregas: upcomingEntregas(from: deadlines, now: now),
            studyTrend: studyTrend(from: sessions, tombstones: tombstones, now: now),
            dailyTasksRing: ring(from: checklist, now: now),
            lastUpdated: now.timeIntervalSince1970 * 1000
        )
    }

    /// Los seis deadlines más próximos que no hayan pasado.
    private static func widgetDeadlines(from all: [ImportantDeadline], now: Date) -> [IEWidgetDeadline] {
        let hoy = ymd(now)
        return all
            .filter { $0.date >= hoy }
            .sorted { ($0.date, $0.time ?? "") < ($1.date, $1.time ?? "") }
            .prefix(6)
            .map { d in
                let dias = diasHasta(d.date, from: now)
                return IEWidgetDeadline(
                    id: d.id,
                    title: d.title,
                    subject: d.subject ?? "",
                    date: d.date,
                    // La web marca como examen por el texto: no hay campo propio.
                    isExam: esExamen(d.title),
                    urgency: dias <= 2 ? "red" : (dias <= 7 ? "yellow" : "normal")
                )
            }
    }

    /// Mismo criterio que el widget «Entregas» del dashboard: las 3 siguientes.
    private static func upcomingEntregas(from all: [ImportantDeadline], now: Date) -> [IEWidgetUpcomingEntrega] {
        let hoy = ymd(now)
        return all
            .filter { $0.date >= hoy }
            .sorted { ($0.date, $0.time ?? "") < ($1.date, $1.time ?? "") }
            .prefix(3)
            .map { d in
                let dias = diasHasta(d.date, from: now)
                return IEWidgetUpcomingEntrega(
                    id: d.id,
                    courseName: d.subject ?? "Sin asignatura",
                    title: d.title,
                    dueIso: d.date,
                    relLabel: etiquetaRelativa(dias),
                    relTone: dias <= 2 ? "red" : "amber"
                )
            }
    }

    /// Horas de estudio de los 13 días centrados en hoy (±6), como el gráfico web.
    private static func studyTrend(from sessions: [CompletedSession],
                                   tombstones: Set<String>,
                                   now: Date) -> [IEWidgetStudyTrendPoint] {
        // Se filtran clones y borrados igual que en la web: hay registros
        // duplicados del mismo run por la fusión en la nube.
        var vistos = Set<String>()
        let limpias = sessions.filter { s in
            if tombstones.contains(s.completionId) || tombstones.contains(s.arenaRunId) { return false }
            if vistos.contains(s.arenaRunId) { return false }
            vistos.insert(s.arenaRunId)
            return true
        }

        var horasPorDia: [String: Double] = [:]
        for s in limpias {
            let dia = String(s.completedAt.prefix(10))
            horasPorDia[dia, default: 0] += s.elapsedActiveMs / 3_600_000
        }

        let cal = Calendar.current
        return (-6...6).compactMap { offset -> IEWidgetStudyTrendPoint? in
            guard let fecha = cal.date(byAdding: .day, value: offset, to: now) else { return nil }
            let clave = ymd(fecha)
            return IEWidgetStudyTrendPoint(
                label: etiquetaDia(fecha),
                hours: (horasPorDia[clave] ?? 0).rounded(toPlaces: 2),
                isToday: offset == 0
            )
        }
    }

    /// Anillo de tareas diarias de hoy.
    private static func ring(from file: ChecklistFile?, now: Date) -> IEWidgetDailyTasksRing {
        let hoy = ymd(now)
        let deHoy = (file?.tasks ?? []).filter { $0.scope == .day && $0.periodKey == hoy }
        let total = deHoy.count
        let done = deHoy.filter(\.done).count
        return IEWidgetDailyTasksRing(
            pct: total == 0 ? 0 : Int((Double(done) / Double(total) * 100).rounded()),
            empty: total == 0,
            done: done,
            total: total
        )
    }

    // MARK: - Espejos

    /// Copias crudas que los widgets interactivos necesitan para marcar sin
    /// abrir la app. Se guardan tal cual llegan de la nube: los widgets ya saben
    /// interpretarlas y así no hay dos formatos que mantener.
    private static func writeMirrors(defaults: UserDefaults) async {
        if let raw = await SyncStore.shared.rawString(forKey: StorageKeys.dailyChecklist) {
            defaults.set(raw, forKey: checklistMirrorKey)
        }
        if let raw = await SyncStore.shared.rawString(forKey: StorageKeys.habits) {
            defaults.set(raw, forKey: habitsMirrorKey)
        }
        if let raw = await SyncStore.shared.rawString(forKey: StorageKeys.habitLogs) {
            defaults.set(raw, forKey: habitLogsMirrorKey)
        }
    }

    /// Cambios hechos desde un widget interactivo, de vuelta al store.
    ///
    /// El widget escribe en el App Group; al abrir la app hay que recogerlo o se
    /// perdería en la siguiente descarga.
    static func reconcileFromWidgets() async {
        guard let defaults else { return }
        if let raw = defaults.string(forKey: checklistMirrorKey),
           let actual = await SyncStore.shared.rawString(forKey: StorageKeys.dailyChecklist),
           raw != actual {
            await SyncStore.shared.setRawString(raw, forKey: StorageKeys.dailyChecklist)
        }
        if let raw = defaults.string(forKey: habitLogsMirrorKey),
           let actual = await SyncStore.shared.rawString(forKey: StorageKeys.habitLogs),
           raw != actual {
            await SyncStore.shared.setRawString(raw, forKey: StorageKeys.habitLogs)
        }
    }

    // MARK: - Utilidades

    private static func ymd(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    private static func diasHasta(_ fecha: String, from now: Date) -> Int {
        let partes = fecha.split(separator: "-").compactMap { Int($0) }
        guard partes.count == 3 else { return 999 }
        var comps = DateComponents()
        comps.year = partes[0]; comps.month = partes[1]; comps.day = partes[2]
        let cal = Calendar.current
        guard let objetivo = cal.date(from: comps) else { return 999 }
        return cal.dateComponents([.day], from: cal.startOfDay(for: now),
                                  to: cal.startOfDay(for: objetivo)).day ?? 999
    }

    private static func etiquetaRelativa(_ dias: Int) -> String {
        switch dias {
        case ..<0: "Vencida"
        case 0: "Hoy"
        case 1: "Mañana"
        default: "En \(dias) d"
        }
    }

    private static func etiquetaDia(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "es")
        f.dateFormat = "d"
        return f.string(from: d)
    }

    /// Heurística: la web tampoco distingue examen de entrega con un campo.
    private static func esExamen(_ titulo: String) -> Bool {
        let t = titulo.lowercased()
        return t.contains("examen") || t.contains("exam") || t.contains("midterm")
            || t.contains("quiz") || t.contains("parcial") || t.contains("final")
    }
}

private extension Double {
    func rounded(toPlaces places: Int) -> Double {
        let m = pow(10.0, Double(places))
        return (self * m).rounded() / m
    }
}
