import SwiftUI

// MARK: - TasksView

/// Pantalla de Tareas: equivalente nativo de `DailyTasksPanel.tsx`.
///
/// Dos vistas, igual que en la web: lista (diaria o semanal) y calendario
/// mensual con el detalle del día seleccionado. Todo el estado vive en
/// `iestudio-daily-checklist-v1`, así que la web y el iPhone ven lo mismo.
public struct TasksView: View {

    @StateObject private var model = TasksModel()
    @ObservedObject private var bus = SyncBus.shared

    @State private var editing: ChecklistTaskItem?
    @State private var listDraft = ""
    @State private var dayDraft = ""

    @FocusState private var focusedField: TasksField?

    public init() {}

    public var body: some View {
        List {
            headerSection
            viewPickerSection

            switch model.panelView {
            case .list:
                listComposerSection
                listItemsSection
            case .calendar:
                calendarSection
                daySection
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .canvasBackground()
        .navigationTitle("Tareas")
        .navigationBarTitleDisplayMode(.inline)
        .animation(.snappy(duration: 0.22), value: model.panelView)
        .animation(.snappy(duration: 0.22), value: model.listMode)
        .sensoryFeedback(.selection, trigger: model.feedbackTick)
        .task { await model.loadIfNeeded() }
        .refreshable {
            // Pull-to-refresh: baja la nube y repinta. `refresh()` respeta lo que
            // aún no se ha subido, así que no pisa lo que el usuario acaba de tocar.
            await SyncStore.shared.refresh()
            await model.reload()
        }
        .onChange(of: bus.revision) { _, _ in
            // Otro dispositivo (o el WebView) tocó la checklist: recarga.
            guard bus.didChange(any: [StorageKeys.dailyChecklist, "*"]) else { return }
            Task { await model.reload() }
        }
        .sheet(item: $editing) { task in
            TasksEditorSheet(
                task: task,
                onSave: { model.update($0) },
                onDelete: { model.remove(id: task.id) }
            )
        }
    }

    // MARK: Cabecera

    private var headerSection: some View {
        Section {
            VStack(alignment: .leading, spacing: AppSpacing.sm) {
                Text("Organización")
                    .font(.system(size: 11, weight: .bold))
                    .textCase(.uppercase)
                    .kerning(1.6)
                    .foregroundStyle(ThemeColor(.inkMuted))

                HStack(alignment: .firstTextBaseline, spacing: AppSpacing.md) {
                    Text("Tareas")
                        .font(.system(size: 30, weight: .bold))
                        .foregroundStyle(ThemeColor(.ink))
                    Pill("Checklist", systemImage: "checklist", style: .outline)
                }

                Text(headerBlurb)
                    .font(AppFont.caption)
                    .foregroundStyle(ThemeColor(.inkMuted))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.top, AppSpacing.sm)
            .plainRow()
        }
    }

    private var headerBlurb: String {
        let base = "Lista diaria o semanal, prioridad por colores y calendario para revisar días anteriores."
        switch bus.status {
        case .unauthorized:
            return base + " Inicia sesión para sincronizar con tu cuenta."
        case .offline:
            return base + " Sin conexión: los cambios se subirán al recuperarla."
        default:
            return base + " Los cambios se sincronizan con tu cuenta."
        }
    }

    private var viewPickerSection: some View {
        Section {
            VStack(alignment: .leading, spacing: AppSpacing.md) {
                Picker("Vista principal", selection: model.panelViewBinding) {
                    Label("Lista", systemImage: "checklist").tag(TasksPanelView.list)
                    Label("Calendario", systemImage: "calendar").tag(TasksPanelView.calendar)
                }
                .pickerStyle(.segmented)

                if model.panelView == .list {
                    Picker("Tipo de lista", selection: model.listModeBinding) {
                        Text("Diaria").tag(ChecklistScope.day)
                        Text("Semanal").tag(ChecklistScope.week)
                    }
                    .pickerStyle(.segmented)
                }
            }
            .plainRow()
        }
    }

    // MARK: Vista lista

    private var listComposerSection: some View {
        let items = model.items(scope: model.listMode, periodKey: model.currentPeriodKey)
        let done = items.filter(\.done).count

        return Section {
            VStack(alignment: .leading, spacing: AppSpacing.md) {
                HStack(alignment: .firstTextBaseline, spacing: AppSpacing.sm) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(model.listMode == .day ? "Hoy" : "Esta semana")
                            .font(.system(size: 19, weight: .bold))
                            .foregroundStyle(ThemeColor(.ink))
                        Text(model.listSubtitle)
                            .font(AppFont.caption)
                            .foregroundStyle(ThemeColor(.inkMuted))
                    }
                    Spacer(minLength: AppSpacing.sm)
                    Pill(TasksFormat.progress(done: done, total: items.count))
                }

                TasksComposer(
                    text: $listDraft,
                    placeholder: model.listMode == .day ? "Nueva tarea de hoy…" : "Nueva tarea de la semana…",
                    isFocused: $focusedField,
                    field: .list,
                    onSubmit: submitListDraft
                )

                TasksPriorityLegend()
            }
            .plainRow()
        }
    }

    private var listItemsSection: some View {
        let items = model.items(scope: model.listMode, periodKey: model.currentPeriodKey)

        return Section {
            if items.isEmpty {
                EmptyState(
                    systemImage: model.listMode == .day ? "sun.max" : "calendar.badge.clock",
                    title: "Lista vacía",
                    message: "No hay tareas en esta lista. Añade la primera arriba."
                )
                .plainRow()
            } else {
                ForEach(items) { task in
                    taskRow(task, showsState: false)
                }
            }
        }
    }

    // MARK: Vista calendario

    private var calendarSection: some View {
        // Un solo recorrido de las tareas para las 42 celdas: contar dentro del
        // bucle de celdas sería cuadrático con meses cargados.
        let stats = model.dayStats

        return Section {
            VStack(spacing: AppSpacing.md) {
                HStack(spacing: AppSpacing.sm) {
                    TasksMonthButton(systemImage: "chevron.left", label: "Mes anterior") {
                        model.shiftMonth(-1)
                    }
                    Spacer(minLength: 0)
                    Text(model.monthTitle)
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(ThemeColor(.ink))
                    Spacer(minLength: 0)
                    TasksMonthButton(systemImage: "chevron.right", label: "Mes siguiente") {
                        model.shiftMonth(1)
                    }
                }

                TasksWeekdayHeader()

                LazyVGrid(columns: TasksLayout.columns, spacing: 4) {
                    ForEach(model.calendarCells) { cell in
                        TasksDayCell(
                            cell: cell,
                            stat: stats[cell.ymd],
                            isToday: cell.ymd == model.todayKey,
                            isSelected: cell.ymd == model.selectedYmd
                        )
                        .onTapGesture { model.select(ymd: cell.ymd) }
                    }
                }
                .animation(.snappy(duration: 0.2), value: model.monthAnchor)

                TasksCalendarLegend()
            }
            .padding(AppSpacing.md)
            .background(
                RoundedRectangle(cornerRadius: AppRadius.card, style: .continuous)
                    .fill(ThemeColor(.surface))
            )
            .overlay {
                RoundedRectangle(cornerRadius: AppRadius.card, style: .continuous)
                    .strokeBorder(ThemeColor(.border), lineWidth: AppMetrics.hairline)
            }
            .plainRow()
        }
    }

    private var daySection: some View {
        let items = model.items(scope: .day, periodKey: model.selectedYmd)
        let done = items.filter(\.done).count

        return Group {
            Section {
                VStack(alignment: .leading, spacing: AppSpacing.md) {
                    HStack(alignment: .firstTextBaseline, spacing: AppSpacing.sm) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Tareas del día")
                                .font(.system(size: 19, weight: .bold))
                                .foregroundStyle(ThemeColor(.ink))
                            HStack(spacing: AppSpacing.sm) {
                                Text(TasksDate.longDate(model.selectedYmd))
                                    .font(AppFont.caption)
                                    .foregroundStyle(ThemeColor(.inkMuted))
                                if model.selectedYmd == model.todayKey {
                                    Pill("Hoy", style: .solid)
                                }
                            }
                        }
                        Spacer(minLength: AppSpacing.sm)
                        Pill(TasksFormat.progress(done: done, total: items.count))
                    }

                    TasksComposer(
                        text: $dayDraft,
                        placeholder: "Nueva tarea para este día…",
                        isFocused: $focusedField,
                        field: .day,
                        onSubmit: submitDayDraft
                    )
                }
                .plainRow()
            }

            Section {
                if items.isEmpty {
                    EmptyState(
                        systemImage: "calendar.day.timeline.left",
                        title: "Día sin tareas",
                        message: "No hay tareas diarias registradas para esta fecha."
                    )
                    .plainRow()
                } else {
                    ForEach(items) { task in
                        taskRow(task, showsState: true)
                    }
                }
            }
        }
    }

    // MARK: Fila de tarea

    private func taskRow(_ task: ChecklistTaskItem, showsState: Bool) -> some View {
        TasksRow(
            task: task,
            showsState: showsState,
            onToggle: { model.toggle(id: task.id) },
            onCyclePriority: { model.cyclePriority(id: task.id) },
            onEdit: { editing = task }
        )
        .plainRow(insets: EdgeInsets(top: 2, leading: AppSpacing.lg, bottom: 2, trailing: AppSpacing.lg))
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button(role: .destructive) {
                model.remove(id: task.id)
            } label: {
                Label("Borrar", systemImage: "trash")
            }
        }
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            Button {
                model.toggle(id: task.id)
            } label: {
                Label(task.done ? "Pendiente" : "Hecha",
                      systemImage: task.done ? "arrow.uturn.backward" : "checkmark")
            }
            .tint(task.done ? TasksTint.amber : TasksTint.green)

            Button {
                model.cyclePriority(id: task.id)
            } label: {
                Label("Prioridad", systemImage: "flag")
            }
            .tint(TasksTint.color(for: task.priority.next))
        }
    }

    // MARK: Altas

    private func submitListDraft() {
        let title = listDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return }
        model.add(title: title, scope: model.listMode, periodKey: model.currentPeriodKey)
        listDraft = ""
        focusedField = .list
    }

    private func submitDayDraft() {
        let title = dayDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return }
        // En calendario siempre se crea en el día seleccionado, no en hoy: es lo
        // que espera quien está mirando una fecha concreta.
        model.add(title: title, scope: .day, periodKey: model.selectedYmd)
        dayDraft = ""
        focusedField = .day
    }
}

// MARK: - Modelo de pantalla

private enum TasksField: Hashable {
    case list
    case day
}

/// Qué pestaña está activa. Se guarda en `iestudio-daily-tasks-panel-view`.
private enum TasksPanelView: String, Hashable, Sendable {
    case list
    case calendar
}

@MainActor
private final class TasksModel: ObservableObject {

    @Published private(set) var tasks: [ChecklistTaskItem] = []
    @Published private(set) var panelView: TasksPanelView = .list
    @Published private(set) var listMode: ChecklistScope = .day
    @Published private(set) var selectedYmd: String = TasksDate.todayYMD()
    /// Primer día del mes visible. Un solo `Date` en vez de (año, mes) evita
    /// estados imposibles al saltar de diciembre a enero.
    @Published private(set) var monthAnchor: Date = TasksDate.startOfMonth(Date())
    /// Contador para `sensoryFeedback`: SwiftUI necesita un valor que cambie.
    @Published private(set) var feedbackTick = 0

    private var didLoad = false

    // MARK: Derivados

    var todayKey: String { TasksDate.todayYMD() }

    var currentPeriodKey: String {
        listMode == .day ? TasksDate.todayYMD() : TasksDate.mondayYMD()
    }

    var listSubtitle: String {
        listMode == .day
            ? TasksDate.longDate(TasksDate.todayYMD())
            : TasksFormat.weekRange(mondayYmd: TasksDate.mondayYMD())
    }

    var monthTitle: String { TasksDate.monthTitle(monthAnchor) }

    var calendarCells: [TasksCalendarCell] { TasksDate.monthCells(anchor: monthAnchor) }

    /// hechas/total por día, solo con tareas de ámbito diario.
    var dayStats: [String: TasksDayStat] {
        var out: [String: TasksDayStat] = [:]
        for task in tasks where task.scope == .day {
            var stat = out[task.periodKey] ?? TasksDayStat(done: 0, total: 0)
            stat.total += 1
            if task.done { stat.done += 1 }
            out[task.periodKey] = stat
        }
        return out
    }

    func items(scope: ChecklistScope, periodKey: String) -> [ChecklistTaskItem] {
        tasks
            .filter { $0.scope == scope && $0.periodKey == periodKey }
            .sorted { a, b in
                if a.priority != b.priority { return a.priority.sortRank < b.priority.sortRank }
                if a.createdAt != b.createdAt { return a.createdAt < b.createdAt }
                return a.id < b.id
            }
    }

    // MARK: Bindings de las preferencias

    var panelViewBinding: Binding<TasksPanelView> {
        Binding(get: { self.panelView }, set: { self.setPanelView($0) })
    }

    var listModeBinding: Binding<ChecklistScope> {
        Binding(get: { self.listMode }, set: { self.setListMode($0) })
    }

    // MARK: Carga

    func loadIfNeeded() async {
        guard !didLoad else { return }
        didLoad = true
        await reload()
        await loadPreferences()
    }

    func reload() async {
        let file = await SyncStore.shared.decoded(
            ChecklistFile.self, forKey: StorageKeys.dailyChecklist
        )
        tasks = file?.tasks ?? []
    }

    private func loadPreferences() async {
        if let raw = await SyncStore.shared.decoded(String.self, forKey: StorageKeys.dailyTasksPanelView),
           let value = TasksPanelView(rawValue: raw.trimmingCharacters(in: .whitespacesAndNewlines)) {
            panelView = value
        }
        if let raw = await SyncStore.shared.decoded(String.self, forKey: StorageKeys.dailyTasksListMode),
           let value = ChecklistScope(rawValue: raw.trimmingCharacters(in: .whitespacesAndNewlines)) {
            listMode = value
        }
    }

    // MARK: Preferencias

    private func setPanelView(_ value: TasksPanelView) {
        guard panelView != value else { return }
        panelView = value
        savePlain(value.rawValue, forKey: StorageKeys.dailyTasksPanelView)
    }

    private func setListMode(_ value: ChecklistScope) {
        guard listMode != value else { return }
        listMode = value
        savePlain(value.rawValue, forKey: StorageKeys.dailyTasksListMode)
    }

    /// Estas dos claves las escribe la web como texto pelado (`day`), no como
    /// JSON: con `encode` quedaría `"day"` entre comillas y la web dejaría de
    /// reconocerlo. De ahí el `setRawString` en crudo.
    private func savePlain(_ value: String, forKey key: String) {
        Task { await SyncStore.shared.setRawString(value, forKey: key) }
    }

    // MARK: Navegación del calendario

    func shiftMonth(_ delta: Int) {
        monthAnchor = TasksDate.month(monthAnchor, offsetBy: delta)
        feedbackTick += 1
    }

    func select(ymd: String) {
        guard selectedYmd != ymd else { return }
        selectedYmd = ymd
        feedbackTick += 1
        // Tocar un día del mes contiguo (los rellenos de la rejilla) mueve la
        // vista a ese mes; si no, la selección quedaría fuera de pantalla.
        let cellMonth = TasksDate.date(fromYMD: ymd).map(TasksDate.startOfMonth)
        if let cellMonth, cellMonth != monthAnchor { monthAnchor = cellMonth }
    }

    // MARK: Mutaciones

    func add(title: String, scope: ChecklistScope, periodKey: String) {
        let item = ChecklistTaskItem(
            id: UUID().uuidString.lowercased(),
            title: title,
            done: false,
            createdAt: TasksDate.nowISO(),
            scope: scope,
            periodKey: periodKey,
            priority: .green
        )
        tasks.append(item)
        feedbackTick += 1
        persist()
    }

    func toggle(id: String) {
        guard let index = tasks.firstIndex(where: { $0.id == id }) else { return }
        tasks[index].done.toggle()
        feedbackTick += 1
        persist()
    }

    func cyclePriority(id: String) {
        guard let index = tasks.firstIndex(where: { $0.id == id }) else { return }
        tasks[index].priority = tasks[index].priority.next
        feedbackTick += 1
        persist()
    }

    func remove(id: String) {
        tasks.removeAll { $0.id == id }
        feedbackTick += 1
        persist()
    }

    func update(_ task: ChecklistTaskItem) {
        guard let index = tasks.firstIndex(where: { $0.id == task.id }) else { return }
        tasks[index] = task
        persist()
    }

    /// Se escribe el fichero entero (`{ v: 1, tasks }`), igual que
    /// `saveChecklistTasks`. `SyncStore` agrupa y sube con debounce.
    private func persist() {
        let snapshot = ChecklistFile(tasks: tasks)
        Task { await SyncStore.shared.encode(snapshot, forKey: StorageKeys.dailyChecklist) }
    }
}

// MARK: - Fila

private struct TasksRow: View {
    let task: ChecklistTaskItem
    let showsState: Bool
    let onToggle: () -> Void
    let onCyclePriority: () -> Void
    let onEdit: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: AppSpacing.md) {
            Button(action: onToggle) {
                Image(systemName: task.done ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 21, weight: .regular))
                    .foregroundStyle(task.done ? AnyShapeStyle(TasksTint.green) : AnyShapeStyle(ThemeColor(.inkFaint)))
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(task.done ? "Marcar como no hecha" : "Marcar como hecha")

            HStack(alignment: .top, spacing: AppSpacing.sm) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(task.title)
                        .font(AppFont.body)
                        .strikethrough(task.done, color: nil)
                        .foregroundStyle(task.done ? ThemeColor(.inkMuted) : ThemeColor(.ink))
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.leading)

                    if showsState {
                        Text(task.done ? "Hecha" : "Pendiente")
                            .font(.system(size: 11, weight: .semibold))
                            .padding(.horizontal, 7)
                            .padding(.vertical, 2)
                            .foregroundStyle(task.done ? TasksTint.greenInk : TasksTint.amberInk)
                            .background(
                                RoundedRectangle(cornerRadius: 6, style: .continuous)
                                    .fill((task.done ? TasksTint.green : TasksTint.amber).opacity(0.16))
                            )
                    }
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
            .onTapGesture(perform: onEdit)

            Button(action: onCyclePriority) {
                Circle()
                    .fill(TasksTint.color(for: task.priority))
                    .frame(width: 10, height: 10)
                    .overlay(Circle().stroke(TasksTint.color(for: task.priority).opacity(0.35), lineWidth: 3))
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(TasksTint.priorityHint(task.priority))
        }
        .padding(.vertical, 6)
    }
}

// MARK: - Composer

private struct TasksComposer: View {
    @Binding var text: String
    let placeholder: String
    @FocusState.Binding var isFocused: TasksField?
    let field: TasksField
    let onSubmit: () -> Void

    private var isEmpty: Bool {
        text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        HStack(spacing: AppSpacing.sm) {
            TextField(placeholder, text: $text)
                .textFieldStyle(.plain)
                .font(AppFont.body)
                .foregroundStyle(ThemeColor(.ink))
                .submitLabel(.done)
                .focused($isFocused, equals: field)
                .onSubmit(onSubmit)
                .padding(.horizontal, AppSpacing.md)
                .padding(.vertical, 10)
                .background(
                    RoundedRectangle(cornerRadius: AppRadius.small, style: .continuous)
                        .fill(ThemeColor(.surfaceMuted))
                )
                .overlay {
                    RoundedRectangle(cornerRadius: AppRadius.small, style: .continuous)
                        .strokeBorder(ThemeColor(.border), lineWidth: AppMetrics.hairline)
                }

            Button(action: onSubmit) {
                Image(systemName: "plus")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(ThemeColor(.onAccent))
                    .frame(width: 42, height: 42)
                    .background(
                        RoundedRectangle(cornerRadius: AppRadius.small, style: .continuous)
                            .fill(ThemeColor(.accent))
                    )
            }
            .buttonStyle(.plain)
            .opacity(isEmpty ? 0.4 : 1)
            .disabled(isEmpty)
            .accessibilityLabel("Añadir tarea")
        }
    }
}

// MARK: - Calendario

private struct TasksDayStat: Equatable, Sendable {
    var done: Int
    var total: Int

    var tone: TasksCellTone {
        if total == 0 { return .empty }
        return done >= total ? .done : .pending
    }
}

private enum TasksCellTone {
    case empty
    case pending
    case done
}

private struct TasksCalendarCell: Identifiable, Equatable, Sendable {
    let ymd: String
    let inMonth: Bool
    var id: String { ymd }
    var dayNumber: Int { TasksDate.dayNumber(ymd) }
}

private enum TasksLayout {
    /// Calculada, no `static let`: `GridItem` no es `Sendable` y como estado
    /// global compartido no compila con concurrencia estricta.
    static var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: 4), count: 7)
    }

    static let cellHeight: CGFloat = 52
}

private struct TasksWeekdayHeader: View {
    // La semana empieza en lunes por definición del producto (igual que la web),
    // así que las letras no salen de `Calendar`, que depende de la región.
    private let symbols = ["L", "M", "X", "J", "V", "S", "D"]

    var body: some View {
        LazyVGrid(columns: TasksLayout.columns, spacing: 0) {
            ForEach(Array(symbols.enumerated()), id: \.offset) { _, symbol in
                Text(symbol)
                    .font(.system(size: 11, weight: .bold))
                    .kerning(0.6)
                    .foregroundStyle(ThemeColor(.inkMuted))
                    .frame(maxWidth: .infinity)
            }
        }
        .accessibilityHidden(true)
    }
}

private struct TasksDayCell: View {
    let cell: TasksCalendarCell
    let stat: TasksDayStat?
    let isToday: Bool
    let isSelected: Bool

    @Environment(\.appPalette) private var palette

    private var tone: TasksCellTone { stat?.tone ?? .empty }

    var body: some View {
        VStack(spacing: 2) {
            Text("\(cell.dayNumber)")
                .font(.system(size: 15, weight: isToday ? .bold : .semibold))
                .monospacedDigit()
                .foregroundStyle(cell.inMonth ? ThemeColor(.ink) : ThemeColor(.inkFaint))

            if let stat, stat.total > 0 {
                Text("\(stat.done)/\(stat.total)")
                    .font(.system(size: 10, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(ThemeColor(.inkMuted))
            } else {
                // Hueco del mismo alto que el contador: sin él las celdas con y
                // sin tareas no alinean el número.
                Text(" ")
                    .font(.system(size: 10, weight: .semibold))
                    .opacity(0)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: TasksLayout.cellHeight)
        .background(
            RoundedRectangle(cornerRadius: AppRadius.small, style: .continuous)
                .fill(background)
        )
        .overlay {
            RoundedRectangle(cornerRadius: AppRadius.small, style: .continuous)
                .strokeBorder(strokeColor, lineWidth: strokeWidth)
        }
        .opacity(cell.inMonth ? 1 : 0.55)
        .contentShape(RoundedRectangle(cornerRadius: AppRadius.small, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
        .accessibilityLabel(accessibilityText)
    }

    private var background: Color {
        switch tone {
        case .empty:
            return cell.inMonth ? palette.canvas : palette.surfaceMuted.opacity(0.4)
        case .pending:
            return TasksTint.amber.opacity(0.14)
        case .done:
            return TasksTint.green.opacity(0.16)
        }
    }

    private var strokeColor: Color {
        if isSelected { return palette.ink }
        if isToday { return palette.inkMuted.opacity(0.55) }
        switch tone {
        case .empty: return palette.border
        case .pending: return TasksTint.amber.opacity(0.3)
        case .done: return TasksTint.green.opacity(0.3)
        }
    }

    private var strokeWidth: CGFloat {
        isSelected ? 2 : (isToday ? 1 : AppMetrics.hairline)
    }

    private var accessibilityText: String {
        var parts = [TasksDate.longDate(cell.ymd)]
        if let stat, stat.total > 0 {
            parts.append("\(stat.done) de \(stat.total) hechas")
        } else {
            parts.append("sin tareas")
        }
        if isToday { parts.append("hoy") }
        return parts.joined(separator: ", ")
    }
}

private struct TasksMonthButton: View {
    let systemImage: String
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(ThemeColor(.ink))
                .frame(width: 44, height: 44)
                .background(
                    RoundedRectangle(cornerRadius: AppRadius.small, style: .continuous)
                        .fill(ThemeColor(.surfaceMuted))
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

// MARK: - Leyendas

private struct TasksPriorityLegend: View {
    var body: some View {
        HStack(spacing: AppSpacing.md) {
            Text("Prioridad")
                .font(.system(size: 11, weight: .bold))
                .textCase(.uppercase)
                .kerning(0.8)
                .foregroundStyle(ThemeColor(.inkFaint))
            ForEach(ChecklistPriority.allCases, id: \.self) { priority in
                HStack(spacing: 5) {
                    Circle()
                        .fill(TasksTint.color(for: priority))
                        .frame(width: 8, height: 8)
                    Text(TasksTint.priorityName(priority))
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(ThemeColor(.inkMuted))
                }
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct TasksCalendarLegend: View {
    var body: some View {
        HStack(spacing: AppSpacing.md) {
            legendItem(color: nil, text: "sin tareas")
            legendItem(color: TasksTint.amber, text: "pendientes")
            legendItem(color: TasksTint.green, text: "completadas")
            Spacer(minLength: 0)
        }
        .accessibilityHidden(true)
    }

    private func legendItem(color: Color?, text: String) -> some View {
        HStack(spacing: 5) {
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(color?.opacity(0.35) ?? Color.clear)
                .overlay {
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .strokeBorder(color?.opacity(0.5) ?? Color.gray.opacity(0.4), lineWidth: 1)
                }
                .frame(width: 12, height: 12)
            Text(text)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(ThemeColor(.inkMuted))
        }
    }
}

// MARK: - Editor

private struct TasksEditorSheet: View {
    let task: ChecklistTaskItem
    let onSave: (ChecklistTaskItem) -> Void
    let onDelete: () -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var title: String
    @State private var priority: ChecklistPriority
    @State private var done: Bool
    @State private var day: Date
    @State private var confirmingDelete = false

    init(
        task: ChecklistTaskItem,
        onSave: @escaping (ChecklistTaskItem) -> Void,
        onDelete: @escaping () -> Void
    ) {
        self.task = task
        self.onSave = onSave
        self.onDelete = onDelete
        _title = State(initialValue: task.title)
        _priority = State(initialValue: task.priority)
        _done = State(initialValue: task.done)
        _day = State(initialValue: TasksDate.date(fromYMD: task.periodKey) ?? Date())
    }

    private var trimmedTitle: String {
        title.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Tarea") {
                    TextField("Título", text: $title, axis: .vertical)
                        .lineLimit(1...4)
                    Toggle("Hecha", isOn: $done)
                }

                Section("Prioridad") {
                    Picker("Prioridad", selection: $priority) {
                        ForEach(ChecklistPriority.allCases, id: \.self) { value in
                            Text(TasksTint.priorityName(value)).tag(value)
                        }
                    }
                    .pickerStyle(.segmented)
                    HStack(spacing: AppSpacing.sm) {
                        Circle().fill(TasksTint.color(for: priority)).frame(width: 10, height: 10)
                        Text(TasksTint.priorityHint(priority))
                            .font(AppFont.caption)
                            .foregroundStyle(ThemeColor(.inkMuted))
                    }
                }

                if task.scope == .day {
                    Section("Día") {
                        DatePicker("Fecha", selection: $day, displayedComponents: .date)
                            .datePickerStyle(.compact)
                    }
                } else {
                    Section("Semana") {
                        Text(TasksFormat.weekRange(mondayYmd: task.periodKey))
                            .font(AppFont.body)
                            .foregroundStyle(ThemeColor(.inkMuted))
                    }
                }

                Section {
                    Button(role: .destructive) {
                        confirmingDelete = true
                    } label: {
                        Label("Borrar tarea", systemImage: "trash")
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(ThemeColor(.canvas))
            .navigationTitle("Editar tarea")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Guardar", action: save).disabled(trimmedTitle.isEmpty)
                }
            }
            .confirmationDialog("¿Borrar esta tarea?", isPresented: $confirmingDelete, titleVisibility: .visible) {
                Button("Borrar", role: .destructive) {
                    onDelete()
                    dismiss()
                }
                Button("Cancelar", role: .cancel) {}
            }
        }
        .studyOSTheme()
        .presentationDetents([.medium, .large])
    }

    private func save() {
        guard !trimmedTitle.isEmpty else { return }
        var updated = task
        updated.title = trimmedTitle
        updated.priority = priority
        updated.done = done
        // Cambiar de día solo tiene sentido en ámbito diario; en semanal el
        // `periodKey` es el lunes y moverlo rompería la agrupación de la web.
        if task.scope == .day {
            updated.periodKey = TasksDate.ymd(of: day)
        }
        onSave(updated)
        dismiss()
    }
}

// MARK: - Colores y textos de prioridad

private enum TasksTint {
    /// Los mismos hex que Tailwind usa en la web: emerald-500, amber-500, red-500.
    static let green = Color(hex: 0x10B981)
    static let amber = Color(hex: 0xF59E0B)
    static let red = Color(hex: 0xEF4444)
    /// Variantes oscuras para texto sobre fondo teñido (emerald-800, amber-900).
    static let greenInk = Color(hex: 0x065F46)
    static let amberInk = Color(hex: 0x78350F)

    static func color(for priority: ChecklistPriority) -> Color {
        switch priority {
        case .green: green
        case .orange: amber
        case .red: red
        }
    }

    static func priorityName(_ priority: ChecklistPriority) -> String {
        switch priority {
        case .green: "Baja"
        case .orange: "Media"
        case .red: "Alta"
        }
    }

    static func priorityHint(_ priority: ChecklistPriority) -> String {
        switch priority {
        case .green: "Prioridad baja. Toca para subir a media."
        case .orange: "Prioridad media. Toca para subir a alta."
        case .red: "Prioridad alta. Toca para bajar a baja."
        }
    }
}

private extension ChecklistPriority {
    /// verde → naranja → rojo → verde (`cyclePriority` de la web).
    var next: ChecklistPriority {
        switch self {
        case .green: .orange
        case .orange: .red
        case .red: .green
        }
    }
}

// MARK: - Formato

private enum TasksFormat {
    static func progress(done: Int, total: Int) -> String {
        total == 0 ? "Sin tareas" : "\(done)/\(total) hechas"
    }

    static func weekRange(mondayYmd: String) -> String {
        guard let sunday = TasksDate.sundayAfterMonday(mondayYmd) else {
            return TasksDate.longDate(mondayYmd)
        }
        return "\(TasksDate.shortDate(mondayYmd)) – \(TasksDate.shortDate(sunday))"
    }
}

// MARK: - Fechas

/// Todo el cálculo de fechas de la pantalla. Duplica las utilidades privadas de
/// `Task.swift` a propósito: aquellas son `private` a ese fichero.
private enum TasksDate {
    /// La web formatea con `toLocaleDateString("es", …)`, no con el idioma del
    /// dispositivo: se replica para que ambas pantallas digan lo mismo.
    static let locale = Locale(identifier: "es_ES")

    static func ymd(of date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    static func date(fromYMD raw: String) -> Date? {
        let parts = raw.split(separator: "-")
        guard parts.count == 3,
              let y = Int(parts[0]), let m = Int(parts[1]), let d = Int(parts[2])
        else { return nil }
        var comps = DateComponents()
        comps.year = y
        comps.month = m
        comps.day = d
        return Calendar.current.date(from: comps)
    }

    static func todayYMD() -> String { ymd(of: Date()) }

    static func dayNumber(_ raw: String) -> Int {
        Int(raw.suffix(2)) ?? 0
    }

    /// Lunes de la semana local. Se calcula a mano porque
    /// `Calendar.firstWeekday` cambia con la región y aquí la semana empieza en
    /// lunes siempre (es lo que guarda `periodKey`).
    static func mondayYMD(of date: Date = Date()) -> String {
        let cal = Calendar.current
        let start = cal.startOfDay(for: date)
        let dow = cal.component(.weekday, from: start) - 1   // 0 = domingo
        let offset = dow == 0 ? -6 : 1 - dow
        return ymd(of: cal.date(byAdding: .day, value: offset, to: start) ?? start)
    }

    static func sundayAfterMonday(_ mondayYmd: String) -> String? {
        guard let monday = date(fromYMD: mondayYmd),
              let sunday = Calendar.current.date(byAdding: .day, value: 6, to: monday)
        else { return nil }
        return ymd(of: sunday)
    }

    static func startOfMonth(_ date: Date) -> Date {
        let cal = Calendar.current
        let comps = cal.dateComponents([.year, .month], from: date)
        return cal.date(from: comps) ?? cal.startOfDay(for: date)
    }

    static func month(_ anchor: Date, offsetBy delta: Int) -> Date {
        let cal = Calendar.current
        return startOfMonth(cal.date(byAdding: .month, value: delta, to: anchor) ?? anchor)
    }

    /// 42 celdas: desde el lunes anterior (o igual) al día 1, seis semanas.
    static func monthCells(anchor: Date) -> [TasksCalendarCell] {
        let cal = Calendar.current
        let first = startOfMonth(anchor)
        let monthIndex = cal.component(.month, from: first)
        let dow = cal.component(.weekday, from: first) - 1   // 0 = domingo
        let pad = (dow + 6) % 7
        guard let start = cal.date(byAdding: .day, value: -pad, to: first) else { return [] }

        return (0..<42).compactMap { offset in
            guard let day = cal.date(byAdding: .day, value: offset, to: start) else { return nil }
            return TasksCalendarCell(
                ymd: ymd(of: day),
                inMonth: cal.component(.month, from: day) == monthIndex
            )
        }
    }

    static func longDate(_ raw: String) -> String {
        guard let date = date(fromYMD: raw) else { return raw }
        return date.formatted(
            Date.FormatStyle(locale: locale).weekday(.wide).day().month(.wide).year()
        )
    }

    static func shortDate(_ raw: String) -> String {
        guard let date = date(fromYMD: raw) else { return raw }
        return date.formatted(Date.FormatStyle(locale: locale).day().month(.abbreviated))
    }

    static func monthTitle(_ anchor: Date) -> String {
        let text = anchor.formatted(Date.FormatStyle(locale: locale).month(.wide).year())
        return text.prefix(1).uppercased() + text.dropFirst()
    }

    /// `new Date().toISOString()`: UTC con milisegundos. Es el formato que ya
    /// tienen los `createdAt` guardados y con el que se ordenan por texto.
    static func nowISO() -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter.string(from: Date())
    }
}

// MARK: - Utilidades de List

private extension View {
    /// Fila de `List` sin decoración del sistema: sin fondo, sin separador y con
    /// los márgenes de la pantalla.
    func plainRow(
        insets: EdgeInsets = EdgeInsets(
            top: AppSpacing.sm,
            leading: AppSpacing.lg,
            bottom: AppSpacing.sm,
            trailing: AppSpacing.lg
        )
    ) -> some View {
        listRowInsets(insets)
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
    }
}

// MARK: - Previews

#Preview("Tareas — claro") {
    NavigationStack { TasksView() }
        .studyOSTheme()
        .preferredColorScheme(.light)
}

#Preview("Tareas — oscuro") {
    NavigationStack { TasksView() }
        .studyOSTheme()
        .preferredColorScheme(.dark)
}
