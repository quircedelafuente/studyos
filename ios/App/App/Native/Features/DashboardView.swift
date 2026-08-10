import SwiftUI

// MARK: - Pantalla

/// Resumen del día: entregas próximas, lo que quema, hábitos y tareas de hoy.
///
/// Es solo lectura a propósito. Marcar una tarea o un hábito implica replicar
/// las reglas de escritura de la web (claves de periodo, `updatedAt`, orden de
/// fusión en la nube); cada pestaña ya tiene esa lógica, así que aquí un toque
/// lleva a la sección correspondiente en vez de duplicarla.
@MainActor
struct DashboardView: View {

    private let onSelectTab: (AppTab) -> Void

    @StateObject private var model = DashboardModel()
    @ObservedObject private var bus = SyncBus.shared

    /// Explícito en vez del memberwise sintetizado: con propiedades privadas,
    /// el inicializador por defecto no siempre queda accesible desde otro fichero.
    init(onSelectTab: @escaping (AppTab) -> Void = { _ in }) {
        self.onSelectTab = onSelectTab
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AppSpacing.xl) {
                if !model.hasLoaded {
                    ProgressView()
                        .tint(ThemeColor(.inkFaint))
                        .frame(maxWidth: .infinity)
                        .padding(.top, AppSpacing.xxl)
                } else {
                    header
                    summaryCard
                    criticalSection
                    upcomingSection
                    habitsSection
                    tasksSection
                    syncFooter
                }
            }
            .padding(.horizontal, AppSpacing.lg)
            .padding(.bottom, AppSpacing.xxl)
        }
        .canvasBackground()
        .task { await model.start() }
        .refreshable { await SyncStore.shared.refresh() }
    }

    // MARK: Cabecera

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(DashboardDate.greeting())
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(ThemeColor(.ink))
            Text(DashboardDate.longToday())
                .font(AppFont.body)
                .foregroundStyle(ThemeColor(.inkMuted))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Resumen

    private var summaryCard: some View {
        let snap = model.snapshot
        return Card {
            HStack(alignment: .center, spacing: AppSpacing.lg) {
                DashboardRing(
                    progress: snap.tasksRing.empty ? 0 : Double(snap.tasksRing.pct) / 100,
                    caption: snap.tasksRing.empty ? "—" : "\(snap.tasksRing.pct)%"
                )
                .frame(width: 62, height: 62)

                VStack(alignment: .leading, spacing: AppSpacing.sm) {
                    DashboardStat(
                        value: snap.tasksRing.empty
                            ? "Sin tareas"
                            : "\(snap.tasksRing.done) de \(snap.tasksRing.total)",
                        label: "Tareas de hoy"
                    )
                    Hairline()
                    HStack(spacing: AppSpacing.xl) {
                        DashboardStat(
                            value: snap.habits.isEmpty
                                ? "—"
                                : "\(snap.habitsDone)/\(snap.habits.count)",
                            label: "Hábitos"
                        )
                        DashboardStat(
                            value: DashboardFormat.minutes(snap.studyMinutesToday),
                            label: "Arena"
                        )
                    }
                }
            }
        }
    }

    // MARK: Deadlines críticos

    @ViewBuilder
    private var criticalSection: some View {
        if !model.snapshot.criticalDeadlines.isEmpty {
            VStack(alignment: .leading, spacing: AppSpacing.md) {
                SectionHeader(
                    "Crítico",
                    subtitle: "En las próximas 72 horas"
                ) {
                    Pill("\(model.snapshot.criticalDeadlines.count)", style: .solid)
                }

                VStack(spacing: AppSpacing.sm) {
                    ForEach(model.snapshot.criticalDeadlines) { row in
                        CriticalDeadlineCard(row: row)
                    }
                }
                .onTapGesture { onSelectTab(.fechas) }
            }
        }
    }

    // MARK: Próximas entregas

    @ViewBuilder
    private var upcomingSection: some View {
        VStack(alignment: .leading, spacing: AppSpacing.md) {
            SectionHeader("Próximas entregas", subtitle: "Siguientes 14 días") {
                Button { onSelectTab(.fechas) } label: {
                    Pill("Ver todo", style: .outline)
                }
                .buttonStyle(.plain)
            }

            Card(padding: 0) {
                if model.snapshot.upcomingDeadlines.isEmpty {
                    EmptyState(
                        systemImage: "calendar",
                        title: "Nada a la vista",
                        message: "No hay exámenes ni entregas en las próximas dos semanas."
                    )
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(model.snapshot.upcomingDeadlines.enumerated()), id: \.element.id) { index, row in
                            if index > 0 { Hairline() }
                            DeadlineRowView(row: row)
                                .padding(.horizontal, AppSpacing.lg)
                                .padding(.vertical, AppSpacing.md)
                        }
                    }
                }
            }
            .onTapGesture { onSelectTab(.fechas) }
        }
    }

    // MARK: Hábitos

    @ViewBuilder
    private var habitsSection: some View {
        VStack(alignment: .leading, spacing: AppSpacing.md) {
            SectionHeader("Hábitos de hoy", subtitle: habitsSubtitle) {
                Button { onSelectTab(.habitos) } label: {
                    Pill("Ver todo", style: .outline)
                }
                .buttonStyle(.plain)
            }

            Card(padding: 0) {
                if model.snapshot.habits.isEmpty {
                    EmptyState(
                        systemImage: "flame",
                        title: "Hoy no toca ninguno",
                        message: "Los hábitos programados para hoy aparecerán aquí."
                    )
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(model.snapshot.habits.enumerated()), id: \.element.id) { index, row in
                            if index > 0 { Hairline() }
                            HabitRowView(row: row)
                                .padding(.horizontal, AppSpacing.lg)
                                .padding(.vertical, AppSpacing.md)
                        }
                    }
                }
            }
            .onTapGesture { onSelectTab(.habitos) }
        }
    }

    private var habitsSubtitle: String? {
        let snap = model.snapshot
        guard !snap.habits.isEmpty else { return nil }
        return "\(snap.habitsDone) de \(snap.habits.count) completados"
    }

    // MARK: Tareas

    @ViewBuilder
    private var tasksSection: some View {
        VStack(alignment: .leading, spacing: AppSpacing.md) {
            SectionHeader("Tareas de hoy", subtitle: tasksSubtitle) {
                Button { onSelectTab(.tareas) } label: {
                    Pill("Ver todo", style: .outline)
                }
                .buttonStyle(.plain)
            }

            Card(padding: 0) {
                if model.snapshot.tasks.isEmpty {
                    EmptyState(
                        systemImage: "checklist",
                        title: "Sin tareas para hoy",
                        message: "Añade tus tareas del día en la sección Tareas."
                    )
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(model.snapshot.tasks.enumerated()), id: \.element.id) { index, task in
                            if index > 0 { Hairline() }
                            TaskRowView(task: task)
                                .padding(.horizontal, AppSpacing.lg)
                                .padding(.vertical, AppSpacing.md)
                        }
                    }
                }
            }
            .onTapGesture { onSelectTab(.tareas) }
        }
    }

    private var tasksSubtitle: String? {
        let pending = model.snapshot.weekTasksPending
        guard pending > 0 else { return nil }
        return pending == 1
            ? "1 tarea semanal pendiente"
            : "\(pending) tareas semanales pendientes"
    }

    // MARK: Estado de sincronización

    private var syncFooter: some View {
        HStack(spacing: AppSpacing.sm) {
            Circle()
                .fill(syncColor)
                .frame(width: 6, height: 6)
            Text(syncText)
                .font(AppFont.caption)
                .foregroundStyle(ThemeColor(.inkFaint))
            Spacer(minLength: 0)
            if bus.pendingUploads > 0 {
                Text("\(bus.pendingUploads) por subir")
                    .font(AppFont.caption)
                    .foregroundStyle(ThemeColor(.inkFaint))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, AppSpacing.sm)
    }

    private var syncText: String {
        switch bus.status {
        case .syncing:
            return "Sincronizando…"
        case .offline:
            return "Sin conexión · datos guardados en el dispositivo"
        case .unauthorized:
            return "Sesión caducada · vuelve a entrar"
        case .failed(let reason):
            return "Error de sincronización (\(reason))"
        case .idle:
            guard let last = bus.lastSyncedAt else { return "Sin sincronizar todavía" }
            return "Actualizado \(last.formatted(date: .omitted, time: .shortened))"
        }
    }

    private var syncColor: Color {
        switch bus.status {
        case .idle: Color(hex: 0x34A853)
        case .syncing: Color(hex: 0xF9AB00)
        case .offline: Color(hex: 0x8A8A8A)
        case .unauthorized, .failed: Color(hex: 0xEA4335)
        }
    }
}

// MARK: - Filas

private struct CriticalDeadlineCard: View {
    let row: DeadlineRow
    @Environment(\.appPalette) private var palette

    var body: some View {
        let style = EventColors.style(for: row.colorId, palette: palette)
        return HStack(alignment: .top, spacing: AppSpacing.md) {
            VStack(alignment: .leading, spacing: AppSpacing.xs) {
                Text(row.title)
                    .font(AppFont.cardTitle)
                    .foregroundStyle(style.text)
                    .lineLimit(2)
                if let detail = row.detail {
                    Text(detail)
                        .font(AppFont.caption)
                        .foregroundStyle(style.textMuted)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: AppSpacing.sm)
            VStack(alignment: .trailing, spacing: 2) {
                Text(row.dayLabel)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(style.text)
                if let time = row.timeLabel {
                    Text(time)
                        .font(AppFont.mono)
                        .foregroundStyle(style.textMuted)
                }
            }
        }
        .padding(.vertical, AppSpacing.md)
        .padding(.leading, AppSpacing.lg)
        .padding(.trailing, AppSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .eventChipBackground(style, radius: AppRadius.medium)
    }
}

private struct DeadlineRowView: View {
    let row: DeadlineRow
    @Environment(\.appPalette) private var palette

    var body: some View {
        HStack(spacing: AppSpacing.md) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(EventColors.swatch(for: row.colorId, palette: palette))
                .frame(width: AppMetrics.accentBar, height: 30)

            VStack(alignment: .leading, spacing: 2) {
                Text(row.title)
                    .font(AppFont.body)
                    .foregroundStyle(ThemeColor(.ink))
                    .lineLimit(1)
                if let detail = row.detail {
                    Text(detail)
                        .font(AppFont.caption)
                        .foregroundStyle(ThemeColor(.inkFaint))
                        .lineLimit(1)
                }
            }

            Spacer(minLength: AppSpacing.sm)

            VStack(alignment: .trailing, spacing: 2) {
                Text(row.dayLabel)
                    .font(AppFont.caption)
                    .foregroundStyle(ThemeColor(.inkMuted))
                if let time = row.timeLabel {
                    Text(time)
                        .font(AppFont.mono)
                        .foregroundStyle(ThemeColor(.inkFaint))
                }
            }
        }
    }
}

private struct HabitRowView: View {
    let row: HabitRow

    var body: some View {
        HStack(spacing: AppSpacing.md) {
            Image(systemName: row.isDone ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 18, weight: .regular))
                .foregroundStyle(row.isDone ? ThemeColor(.ink) : ThemeColor(.inkFaint))

            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: AppSpacing.sm) {
                    Text(row.title)
                        .font(AppFont.body)
                        .foregroundStyle(ThemeColor(.ink))
                        .lineLimit(1)
                    if row.isWeekly {
                        Pill("semana")
                    }
                    Spacer(minLength: 0)
                    if let detail = row.detail {
                        Text(detail)
                            .font(AppFont.caption)
                            .foregroundStyle(ThemeColor(.inkMuted))
                    }
                }
                // La barra también se pinta en los de tipo check: es 0 o 1, y
                // así todas las filas tienen la misma altura.
                DashboardBar(progress: row.progress)
            }
        }
    }
}

private struct TaskRowView: View {
    let task: ChecklistTaskItem

    var body: some View {
        HStack(spacing: AppSpacing.md) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
            Text(task.title.isEmpty ? "(Sin título)" : task.title)
                .font(AppFont.body)
                .foregroundStyle(task.done ? ThemeColor(.inkFaint) : ThemeColor(.ink))
                .strikethrough(task.done, color: nil)
                .lineLimit(2)
            Spacer(minLength: 0)
            if task.done {
                Image(systemName: "checkmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(ThemeColor(.inkFaint))
            }
        }
    }

    private var color: Color {
        switch task.priority {
        case .red: Color(hex: 0xEA4335)
        case .orange: Color(hex: 0xF9AB00)
        case .green: Color(hex: 0x34A853)
        }
    }
}

// MARK: - Piezas visuales

private struct DashboardStat: View {
    let value: String
    let label: String

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(ThemeColor(.ink))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(label)
                .font(AppFont.caption)
                .foregroundStyle(ThemeColor(.inkFaint))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct DashboardRing: View {
    let progress: Double
    let caption: String

    var body: some View {
        ZStack {
            Circle()
                .stroke(ThemeColor(.surfaceMuted), lineWidth: 7)
            Circle()
                .trim(from: 0, to: max(0.001, min(1, progress)))
                .stroke(ThemeColor(.accent), style: StrokeStyle(lineWidth: 7, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text(caption)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(ThemeColor(.ink))
                .minimumScaleFactor(0.6)
                .lineLimit(1)
        }
        .animation(.easeOut(duration: 0.35), value: progress)
    }
}

private struct DashboardBar: View {
    let progress: Double

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(ThemeColor(.surfaceMuted))
                Capsule()
                    .fill(ThemeColor(.accent))
                    .frame(width: geo.size.width * max(0, min(1, progress)))
            }
        }
        .frame(height: 4)
    }
}

// MARK: - Datos derivados

/// Todo lo que pinta la pantalla, ya calculado. Es `Sendable` para poder
/// construirlo fuera del hilo principal.
private struct DashboardSnapshot: Sendable {
    var criticalDeadlines: [DeadlineRow] = []
    var upcomingDeadlines: [DeadlineRow] = []
    var habits: [HabitRow] = []
    var habitsDone: Int = 0
    var tasks: [ChecklistTaskItem] = []
    var tasksRing = DailyTasksRing(tasks: [])
    var weekTasksPending: Int = 0
    var studyMinutesToday: Int = 0
}

private struct DeadlineRow: Identifiable, Sendable {
    let id: String
    let title: String
    let detail: String?
    let colorId: String
    let dayLabel: String
    let timeLabel: String?
}

private struct HabitRow: Identifiable, Sendable {
    let id: String
    let title: String
    let detail: String?
    let progress: Double
    let isDone: Bool
    let isWeekly: Bool
}

// MARK: - Modelo

@MainActor
private final class DashboardModel: ObservableObject {

    @Published private(set) var snapshot = DashboardSnapshot()
    @Published private(set) var hasLoaded = false

    /// Solo estas claves obligan a recalcular; las demás (tema, preferencias de
    /// paneles, caché de Blackboard…) cambian sin afectar a este resumen.
    private static let watchedKeys: Set<String> = [
        StorageKeys.deadlines,
        StorageKeys.deadlineTags,
        StorageKeys.habits,
        StorageKeys.habitLogs,
        StorageKeys.dailyChecklist,
        StorageKeys.studyArenaCompleted,
        StorageKeys.studyArenaCompletedDeleted,
    ]

    /// Carga inicial y recarga ante cada cambio relevante del almacén.
    func start() async {
        await load()
        for await keys in SyncBus.shared.changes() {
            // "*" lo emite `SyncStore.reset()`: cambia todo de golpe.
            guard keys.contains("*") || !keys.isDisjoint(with: Self.watchedKeys) else { continue }
            await load()
        }
    }

    func load(now: Date = Date()) async {
        let store = SyncStore.shared
        async let deadlines = store.decoded(DeadlineList.self, forKey: StorageKeys.deadlines)
        async let tags = store.decoded(DeadlineTagList.self, forKey: StorageKeys.deadlineTags)
        async let habits = store.decoded(HabitsFile.self, forKey: StorageKeys.habits)
        async let logs = store.decoded(HabitLogsFile.self, forKey: StorageKeys.habitLogs)
        async let checklist = store.decoded(ChecklistFile.self, forKey: StorageKeys.dailyChecklist)
        async let sessions = store.decoded(CompletedSessionList.self, forKey: StorageKeys.studyArenaCompleted)
        async let deleted = store.decoded(
            CompletedSessionTombstones.self, forKey: StorageKeys.studyArenaCompletedDeleted
        )

        snapshot = await DashboardBuilder.build(
            now: now,
            deadlines: deadlines?.items ?? [],
            tags: tags?.items ?? [],
            habits: habits?.active ?? [],
            logs: logs ?? HabitLogsFile(),
            tasks: checklist?.tasks ?? [],
            sessions: sessions?.items ?? [],
            deleted: deleted?.ids ?? []
        )
        hasLoaded = true
    }
}

/// Cálculo puro. Va fuera del actor principal porque el historial de Arena
/// puede tener miles de sesiones y hacerlo en la UI se nota al sincronizar.
private enum DashboardBuilder {

    /// Ventana de «crítico»: hoy, mañana y pasado.
    static let criticalDays = 2
    /// Horizonte de «próximas entregas».
    static let horizonDays = 14
    static let maxUpcoming = 6

    static func build(
        now: Date,
        deadlines: [ImportantDeadline],
        tags: [DeadlineTag],
        habits: [HabitDefinition],
        logs: HabitLogsFile,
        tasks: [ChecklistTaskItem],
        sessions: [CompletedSession],
        deleted: Set<String>
    ) async -> DashboardSnapshot {
        var snapshot = DashboardSnapshot()

        // ── Entregas ────────────────────────────────────────────────────────
        let tagLabels = Dictionary(tags.map { ($0.id, $0.label) }, uniquingKeysWith: { a, _ in a })
        var critical: [DeadlineRow] = []
        var upcoming: [DeadlineRow] = []

        for deadline in ImportantDeadline.sortedByDate(deadlines) {
            guard let day = deadline.dayStart else { continue }
            let daysAway = DashboardDate.days(from: now, to: day)
            // Los vencidos no se muestran: el modelo no tiene «hecho», así que
            // se quedarían clavados en la lista para siempre.
            guard daysAway >= 0, daysAway <= horizonDays else { continue }

            let row = DeadlineRow(
                id: deadline.id,
                title: deadline.title.isEmpty ? "(Sin título)" : deadline.title,
                detail: detail(for: deadline, tagLabels: tagLabels),
                colorId: deadline.calendarColorId,
                dayLabel: DashboardDate.dayLabel(daysAway: daysAway, date: day),
                timeLabel: deadline.time
            )

            if daysAway <= criticalDays {
                critical.append(row)
            } else if upcoming.count < maxUpcoming {
                upcoming.append(row)
            }
        }
        snapshot.criticalDeadlines = critical
        // Con la ventana crítica vacía, «próximas» se queda huérfana de lo más
        // inminente: se rellena con ella para que la tarjeta nunca mienta.
        snapshot.upcomingDeadlines = upcoming.isEmpty ? critical : upcoming

        // ── Hábitos ─────────────────────────────────────────────────────────
        var habitRows: [HabitRow] = []
        var done = 0
        for habit in habits where habit.isScheduled(on: now) {
            let entry = logs.entry(for: habit, on: now)
            let isDone = habit.isDone(entry)
            if isDone { done += 1 }
            habitRows.append(
                HabitRow(
                    id: habit.id,
                    title: habit.title,
                    detail: habitDetail(habit, entry: entry),
                    progress: habit.progress(entry),
                    isDone: isDone,
                    isWeekly: habit.schedule.isWeekly
                )
            )
        }
        // Primero lo que falta: un hábito ya hecho no necesita recordatorio.
        snapshot.habits = habitRows.sorted { a, b in
            a.isDone == b.isDone ? a.title < b.title : (!a.isDone && b.isDone)
        }
        snapshot.habitsDone = done

        // ── Tareas ──────────────────────────────────────────────────────────
        snapshot.tasks = ChecklistTaskItem.tasks(tasks, scope: .day, on: now)
        snapshot.tasksRing = DailyTasksRing(tasks: tasks, on: now)
        snapshot.weekTasksPending = ChecklistTaskItem
            .tasks(tasks, scope: .week, on: now)
            .filter { !$0.done }
            .count

        // ── Arena ───────────────────────────────────────────────────────────
        let todayYMD = DashboardDate.ymd(of: now)
        // Se filtra por día ANTES de deduplicar: el historial guarda hasta
        // 10.000 sesiones y recorrerlas enteras aquí no aporta nada.
        let todaySessions = sessions.filter { $0.completedDayYMD == todayYMD }
        var seenRuns = Set<String>()
        var minutes = 0
        for session in todaySessions {
            if deleted.contains(session.completionId) || deleted.contains(session.arenaRunId) { continue }
            guard seenRuns.insert(session.arenaRunId).inserted else { continue }
            minutes += session.activeMinutes
        }
        snapshot.studyMinutesToday = minutes

        return snapshot
    }

    private static func detail(
        for deadline: ImportantDeadline,
        tagLabels: [String: String]
    ) -> String? {
        var parts: [String] = []
        if let subject = deadline.subject { parts.append(subject) }
        let labels = deadline.tagIds.compactMap { tagLabels[$0] }
        parts.append(contentsOf: labels.prefix(2))
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private static func habitDetail(_ habit: HabitDefinition, entry: HabitLogEntry?) -> String? {
        guard habit.kind == .measure else { return nil }
        let value = entry?.value ?? 0
        let unit = habit.unit.map { " \($0)" } ?? ""
        guard let target = habit.usableTarget else {
            return "\(DashboardFormat.number(value))\(unit)"
        }
        return "\(DashboardFormat.number(value)) / \(DashboardFormat.number(target))\(unit)"
    }
}

// MARK: - Formato

private enum DashboardFormat {
    /// Sin decimales cuando no hacen falta: "3" en vez de "3.0".
    static func number(_ value: Double) -> String {
        value == value.rounded() && abs(value) < 1e9
            ? String(Int(value))
            : String(format: "%.1f", value)
    }

    static func minutes(_ total: Int) -> String {
        if total <= 0 { return "0 min" }
        if total < 60 { return "\(total) min" }
        let h = total / 60
        let m = total % 60
        return m == 0 ? "\(h) h" : "\(h) h \(m)"
    }
}

private enum DashboardDate {

    static func ymd(of date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// Días naturales entre dos fechas, ignorando la hora.
    static func days(from: Date, to: Date) -> Int {
        let cal = Calendar.current
        return cal.dateComponents(
            [.day], from: cal.startOfDay(for: from), to: cal.startOfDay(for: to)
        ).day ?? 0
    }

    static func dayLabel(daysAway: Int, date: Date) -> String {
        switch daysAway {
        case 0: return "Hoy"
        case 1: return "Mañana"
        case 2...6: return date.formatted(.dateTime.weekday(.abbreviated)).capitalized
        default: return date.formatted(.dateTime.day().month(.abbreviated))
        }
    }

    static func longToday(_ date: Date = Date()) -> String {
        date.formatted(.dateTime.weekday(.wide).day().month(.wide)).capitalized
    }

    static func greeting(_ date: Date = Date()) -> String {
        switch Calendar.current.component(.hour, from: date) {
        case 0..<6: return "Buenas noches"
        case 6..<14: return "Buenos días"
        case 14..<21: return "Buenas tardes"
        default: return "Buenas noches"
        }
    }
}

// MARK: - Previews

#Preview("Dashboard — claro") {
    NavigationStack {
        DashboardView()
            .navigationTitle("Dashboard")
    }
    .studyOSTheme()
    .preferredColorScheme(.light)
}

#Preview("Dashboard — oscuro") {
    NavigationStack {
        DashboardView()
            .navigationTitle("Dashboard")
    }
    .studyOSTheme()
    .preferredColorScheme(.dark)
}
