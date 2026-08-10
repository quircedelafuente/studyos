import Combine
import Foundation
import SwiftUI

// MARK: - Pantalla de Hábitos

/// Equivalente nativo de `HabitTrackerPanel.tsx`: lista de hoy con marcado
/// rápido, progreso, calendario mensual coloreado y alta de hábitos.
///
/// No abre `NavigationStack` propio: se compone dentro del contenedor de la app
/// (pestaña o pila) y dibuja su propia cabecera, como hace el panel de la web.
@MainActor
struct HabitsView: View {

    @StateObject private var model = HabitsModel()
    @Environment(\.appPalette) private var palette

    @State private var creating = false
    @State private var habitPendingDeletion: HabitDefinition?
    @State private var amountHabit: HabitDefinition?
    @State private var amountText = ""
    /// Primer día del mes que muestra el calendario.
    @State private var visibleMonth = HabitCalendarMath.monthStart(of: Date())
    /// Si el usuario cruza medianoche con la app abierta, «hoy» y las claves de
    /// periodo cambian: hay que recalcular o marcaría en el día equivocado.
    @State private var today = Date()

    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        VStack(spacing: 0) {
            header
            Hairline()
            content
        }
        .canvasBackground()
        .task {
            await model.load()
            await observeSync()
        }
        // `NSCalendarDayChanged` se publica fuera del hilo principal.
        .onReceive(
            NotificationCenter.default
                .publisher(for: .NSCalendarDayChanged)
                .receive(on: DispatchQueue.main)
        ) { _ in
            today = Date()
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            today = Date()
            Task { await model.load() }
        }
        // Éxito solo cuando el toque completa el hábito; el resto, selección.
        .sensoryFeedback(.success, trigger: model.completionTick)
        .sensoryFeedback(.selection, trigger: model.selectionTick)
        .sheet(isPresented: $creating) {
            HabitEditorSheet { habit in
                Task { await model.create(habit) }
            }
            .studyOSTheme()
        }
        .confirmationDialog(
            "¿Eliminar el hábito?",
            isPresented: Binding(
                get: { habitPendingDeletion != nil },
                set: { if !$0 { habitPendingDeletion = nil } }
            ),
            presenting: habitPendingDeletion
        ) { habit in
            Button("Eliminar «\(habit.title)»", role: .destructive) {
                Task { await model.delete(habit) }
            }
            Button("Cancelar", role: .cancel) {}
        } message: { _ in
            Text("Se borrará el hábito. Los registros del calendario dejarán de contarlo.")
        }
        .alert(
            "Añadir cantidad",
            isPresented: Binding(
                get: { amountHabit != nil },
                set: { if !$0 { amountHabit = nil } }
            ),
            presenting: amountHabit
        ) { habit in
            TextField("Cantidad", text: $amountText)
                .keyboardType(.decimalPad)
            Button("Cancelar", role: .cancel) { amountHabit = nil }
            Button("Sumar") {
                if let delta = HabitNumber.parse(amountText), delta != 0 {
                    Task { await model.addMeasure(habit, delta: delta, on: today) }
                }
                amountHabit = nil
            }
        } message: { habit in
            Text(habit.unit.map { "Se sumará al total de hoy en \($0)." }
                ?? "Se sumará al total de hoy.")
        }
    }

    /// Un único observador para ambas claves: el bus emite las que cambian.
    /// Vive en un método aislado al `MainActor` porque el cierre de `.task` es
    /// `@Sendable` y desde ahí `SyncBus` no es accesible sin salto de actor.
    private func observeSync() async {
        let stream = SyncBus.shared.changes()
        for await keys in stream {
            if keys.contains(StorageKeys.habits)
                || keys.contains(StorageKeys.habitLogs)
                || keys.contains("*") {
                await model.load()
            }
        }
    }

    // MARK: Cabecera

    private var header: some View {
        HStack(alignment: .top, spacing: AppSpacing.md) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Hábitos")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(ThemeColor(.ink))
                Text("Frecuencia flexible y marcado rápido.")
                    .font(AppFont.caption)
                    .foregroundStyle(ThemeColor(.inkMuted))
            }
            Spacer(minLength: AppSpacing.sm)
            Button {
                creating = true
            } label: {
                Label("Nuevo", systemImage: "plus")
                    .font(.system(size: 14, weight: .bold))
                    .padding(.horizontal, AppSpacing.lg)
                    .frame(minHeight: 44)
                    .foregroundStyle(ThemeColor(.onAccent))
                    .background {
                        RoundedRectangle(cornerRadius: AppRadius.small, style: .continuous)
                            .fill(ThemeColor(.accent))
                    }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Nuevo hábito")
        }
        .padding(.horizontal, AppSpacing.lg)
        .padding(.vertical, AppSpacing.lg)
        .background(ThemeColor(.surface))
    }

    // MARK: Contenido

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AppSpacing.xl) {
                todaySection
                calendarSection
            }
            .padding(.horizontal, AppSpacing.lg)
            .padding(.vertical, AppSpacing.xl)
        }
        .refreshable {
            await SyncStore.shared.refresh()
            await model.load()
        }
    }

    // MARK: Hoy

    private var todaySection: some View {
        VStack(alignment: .leading, spacing: AppSpacing.md) {
            SectionHeader("Hoy", subtitle: HabitCalendarMath.longDayLabel(today)) {
                if let summary = todaySummary {
                    Pill(summary, style: .neutral)
                }
            }

            if model.habits.isEmpty {
                Card {
                    if model.loaded {
                        EmptyState(
                            systemImage: "checkmark.circle",
                            title: "Sin hábitos",
                            message: "Crea el primero y aparecerá aquí cada día que toque.",
                            actionTitle: "Nuevo hábito",
                            action: { creating = true }
                        )
                    } else {
                        EmptyState(systemImage: "clock", title: "Cargando…")
                    }
                }
            } else {
                ForEach(model.habits) { habit in
                    habitCard(habit)
                }
            }
        }
    }

    /// "2/5" contando solo lo que toca hoy; nil si hoy no toca nada.
    private var todaySummary: String? {
        let scheduled = model.habits.filter { $0.isScheduled(on: today) }
        guard !scheduled.isEmpty else { return nil }
        let done = scheduled.filter { model.isDone($0, on: today) }.count
        return "\(done)/\(scheduled.count)"
    }

    private func habitCard(_ habit: HabitDefinition) -> some View {
        let entry = model.entry(for: habit, on: today)
        let done = habit.isDone(entry)
        let scheduledToday = habit.isScheduled(on: today)

        return Card(padding: AppSpacing.lg, radius: AppRadius.medium) {
            VStack(alignment: .leading, spacing: AppSpacing.md) {
                HStack(alignment: .top, spacing: AppSpacing.sm) {
                    Text(habit.title)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(ThemeColor(.ink))
                        .lineLimit(2)
                    Spacer(minLength: AppSpacing.sm)
                    Button {
                        habitPendingDeletion = habit
                    } label: {
                        Image(systemName: "trash")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(HabitPalette.danger)
                            .frame(width: 36, height: 36)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Eliminar hábito \(habit.title)")
                }

                // Pastillas de contexto: frecuencia, tipo y aviso de «hoy no toca».
                HStack(spacing: AppSpacing.sm) {
                    Pill(schedulePillText(habit.schedule), style: .outline)
                    Pill(kindPillText(habit), style: .outline)
                    if !scheduledToday {
                        Pill("Hoy no toca", style: .neutral)
                    }
                    Spacer(minLength: 0)
                }

                progressBar(habit, entry: entry)

                actionRow(habit, done: done)
            }
        }
        .opacity(scheduledToday ? 1 : 0.72)
    }

    private func progressBar(_ habit: HabitDefinition, entry: HabitLogEntry?) -> some View {
        let fraction = habit.progress(entry)
        return VStack(alignment: .leading, spacing: 6) {
            Capsule(style: .continuous)
                .fill(ThemeColor(.ink).opacity(0.10))
                .frame(height: 8)
                .overlay(alignment: .leading) {
                    GeometryReader { geo in
                        Capsule(style: .continuous)
                            .fill(HabitPalette.progress)
                            .frame(width: max(0, geo.size.width * fraction))
                    }
                }
                .animation(.snappy(duration: 0.25), value: fraction)

            Text(progressLabel(habit, entry: entry))
                .font(AppFont.caption)
                .foregroundStyle(ThemeColor(.inkMuted))
                .monospacedDigit()
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Progreso")
        .accessibilityValue(progressLabel(habit, entry: entry))
    }

    private func actionRow(_ habit: HabitDefinition, done: Bool) -> some View {
        HStack(spacing: AppSpacing.sm) {
            if habit.kind == .measure {
                stepperButton(systemName: "minus", label: "Restar uno") {
                    Task { await model.addMeasure(habit, delta: -1, on: today) }
                }
                stepperButton(systemName: "plus", label: "Sumar uno") {
                    Task { await model.addMeasure(habit, delta: 1, on: today) }
                }
                Button {
                    amountText = ""
                    amountHabit = habit
                } label: {
                    Text("Cantidad…")
                        .font(.system(size: 13, weight: .semibold))
                        .padding(.horizontal, AppSpacing.md)
                        .frame(minHeight: 36)
                        .foregroundStyle(ThemeColor(.ink))
                        .background { outlineChip }
                }
                .buttonStyle(.plain)
            }

            Spacer(minLength: 0)

            Button {
                Task { await model.toggleDone(habit, on: today) }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: done ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 14, weight: .semibold))
                    Text(done ? "Hecho" : "Marcar")
                        .font(.system(size: 13, weight: .bold))
                }
                .padding(.horizontal, AppSpacing.md + 2)
                .frame(minHeight: 36)
                .foregroundStyle(done ? HabitPalette.successInk(palette) : palette.ink)
                .background {
                    RoundedRectangle(cornerRadius: AppRadius.small, style: .continuous)
                        .fill(done ? HabitPalette.successFill : Color.clear)
                        .overlay {
                            RoundedRectangle(cornerRadius: AppRadius.small, style: .continuous)
                                .strokeBorder(
                                    done ? HabitPalette.successRing : palette.border,
                                    lineWidth: AppMetrics.hairline
                                )
                        }
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel(done ? "Marcado como hecho" : "Marcar como hecho")
        }
    }

    private func stepperButton(
        systemName: String,
        label: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(ThemeColor(.ink))
                .frame(width: 44, height: 36)
                .background { outlineChip }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private var outlineChip: some View {
        RoundedRectangle(cornerRadius: AppRadius.small, style: .continuous)
            .fill(ThemeColor(.canvas))
            .overlay {
                RoundedRectangle(cornerRadius: AppRadius.small, style: .continuous)
                    .strokeBorder(ThemeColor(.border), lineWidth: AppMetrics.hairline)
            }
    }

    // MARK: Calendario

    private var calendarSection: some View {
        let cells = HabitCalendarMath.cells(forMonth: visibleMonth)
        let meta = model.calendarMeta(for: cells, today: today)

        return Card(padding: AppSpacing.lg, radius: AppRadius.medium) {
            VStack(alignment: .leading, spacing: AppSpacing.md) {
                HStack(alignment: .top, spacing: AppSpacing.sm) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Calendario")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(ThemeColor(.ink))
                        Text("Cada día se colorea según el % de hábitos que tocaban ese día.")
                            .font(AppFont.caption)
                            .foregroundStyle(ThemeColor(.inkMuted))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: AppSpacing.sm)
                    HStack(spacing: AppSpacing.xs) {
                        monthButton(systemName: "chevron.left", label: "Mes anterior", delta: -1)
                        monthButton(systemName: "chevron.right", label: "Mes siguiente", delta: 1)
                    }
                }

                HStack {
                    Text(HabitCalendarMath.monthLabel(visibleMonth))
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(ThemeColor(.ink))
                    Spacer()
                    if !HabitCalendarMath.isSameMonth(visibleMonth, today) {
                        Button("Hoy") {
                            withAnimation(.snappy(duration: 0.2)) {
                                visibleMonth = HabitCalendarMath.monthStart(of: today)
                            }
                        }
                        .font(AppFont.caption)
                        .foregroundStyle(ThemeColor(.inkMuted))
                    }
                }

                weekdayHeader

                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 7), spacing: 4) {
                    ForEach(cells) { cell in
                        dayCell(cell, meta: meta[cell.ymd] ?? .empty)
                    }
                }
                // El mes se cambia también arrastrando, como en cualquier
                // calendario de iOS. `simultaneousGesture` para no robarle el
                // arrastre vertical al ScrollView que lo contiene.
                .simultaneousGesture(
                    DragGesture(minimumDistance: 30)
                        .onEnded { value in
                            guard abs(value.translation.width) > abs(value.translation.height) * 1.5 else { return }
                            shiftMonth(value.translation.width < 0 ? 1 : -1)
                        }
                )

                legend
            }
        }
    }

    private func monthButton(systemName: String, label: String, delta: Int) -> some View {
        Button {
            shiftMonth(delta)
        } label: {
            Image(systemName: systemName)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(ThemeColor(.ink))
                .frame(width: 40, height: 36)
                .background { outlineChip }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func shiftMonth(_ delta: Int) {
        withAnimation(.snappy(duration: 0.2)) {
            visibleMonth = HabitCalendarMath.shiftMonth(visibleMonth, by: delta)
        }
    }

    private var weekdayHeader: some View {
        HStack(spacing: 4) {
            ForEach(["L", "M", "X", "J", "V", "S", "D"], id: \.self) { letter in
                Text(letter)
                    .font(.system(size: 11, weight: .bold))
                    .kerning(0.6)
                    .foregroundStyle(ThemeColor(.inkMuted))
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private func dayCell(_ cell: HabitCalendarMath.Cell, meta: HabitDayMeta) -> some View {
        let tone = meta.tone
        let isToday = cell.ymd == HabitCalendarMath.ymd(today)

        return VStack(spacing: 2) {
            Text("\(cell.day)")
                .font(.system(size: 14, weight: isToday ? .bold : .semibold))
                .monospacedDigit()
                .foregroundStyle(cell.inMonth ? palette.ink : palette.inkFaint)
            // El hueco se reserva siempre para que todas las celdas midan igual.
            Text(meta.total > 0 ? "\(meta.done)/\(meta.total)" : "·")
                .font(.system(size: 10, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(ThemeColor(.inkMuted))
                .opacity(meta.total > 0 ? 1 : 0)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 48)
        .background {
            RoundedRectangle(cornerRadius: AppRadius.small, style: .continuous)
                .fill(tone.fill(palette: palette, inMonth: cell.inMonth))
                .overlay {
                    RoundedRectangle(cornerRadius: AppRadius.small, style: .continuous)
                        .strokeBorder(
                            isToday ? palette.inkMuted.opacity(0.5) : tone.ring,
                            lineWidth: isToday ? 1 : AppMetrics.hairline
                        )
                }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(meta.accessibilityLabel(ymd: cell.ymd))
    }

    private var legend: some View {
        // Envuelto en scroll horizontal: en pantallas estrechas la leyenda no
        // cabe en una línea y no debe empujar el ancho de la tarjeta.
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: AppSpacing.md) {
                Text("Leyenda:")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(ThemeColor(.inkFaint))
                legendItem(.low, "0–33%")
                legendItem(.mid, "34–66%")
                legendItem(.high, "67–99%")
                legendItem(.full, "100%")
                legendItem(.empty, "sin hábitos")
            }
            .padding(.vertical, 2)
        }
    }

    private func legendItem(_ tone: HabitTone, _ text: String) -> some View {
        HStack(spacing: 5) {
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .fill(tone.fill(palette: palette, inMonth: true))
                .overlay {
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .strokeBorder(
                            tone == .empty ? palette.border : tone.ring,
                            lineWidth: AppMetrics.hairline
                        )
                }
                .frame(width: 12, height: 12)
            Text(text)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(ThemeColor(.inkMuted))
        }
    }

    // MARK: Textos

    private func schedulePillText(_ schedule: HabitSchedule) -> String {
        if let n = schedule.timesPerWeekValue { return "\(n)/sem" }
        return schedule.weekdayList.map(HabitCalendarMath.weekdayLabel).joined(separator: " ")
    }

    private func kindPillText(_ habit: HabitDefinition) -> String {
        guard habit.kind == .measure else { return "Check" }
        return habit.unit.map { "Medida · \($0)" } ?? "Medida"
    }

    /// Réplica de `progressMeta`: mismo texto que la web bajo la barra.
    private func progressLabel(_ habit: HabitDefinition, entry: HabitLogEntry?) -> String {
        if habit.kind == .check {
            return habit.isDone(entry) ? "Hecho" : "Pendiente"
        }
        let value = entry?.value ?? 0
        let unitSuffix = habit.unit.map { " \($0)" } ?? ""
        guard let target = habit.usableTarget else {
            return value > 0 ? "\(HabitNumber.format(value))\(unitSuffix)" : "0"
        }
        return "\(HabitNumber.format(value))\(unitSuffix) / \(HabitNumber.format(target))\(unitSuffix)"
    }
}

// MARK: - Modelo de pantalla

/// Estado de la pantalla. Guarda los ficheros completos (no solo los hábitos
/// activos) porque al escribir hay que devolver también los archivados.
@MainActor
final class HabitsModel: ObservableObject {

    @Published private(set) var file: HabitsFile
    @Published private(set) var logs: HabitLogsFile
    @Published private(set) var loaded = false

    /// Disparadores de `sensoryFeedback`: contadores separados porque el háptico
    /// de completar un hábito no es el mismo que el de un ajuste cualquiera.
    @Published private(set) var completionTick = 0
    @Published private(set) var selectionTick = 0

    init(file: HabitsFile = HabitsFile(), logs: HabitLogsFile = HabitLogsFile(), loaded: Bool = false) {
        self.file = file
        self.logs = logs
        self.loaded = loaded
    }

    var habits: [HabitDefinition] { file.active }

    func entry(for habit: HabitDefinition, on date: Date) -> HabitLogEntry? {
        logs.entry(for: habit, on: date)
    }

    func isDone(_ habit: HabitDefinition, on date: Date) -> Bool {
        habit.isDone(entry(for: habit, on: date))
    }

    func load() async {
        let habitsFile = await SyncStore.shared.decoded(HabitsFile.self, forKey: StorageKeys.habits)
        let logsFile = await SyncStore.shared.decoded(HabitLogsFile.self, forKey: StorageKeys.habitLogs)
        file = habitsFile ?? HabitsFile()
        logs = logsFile ?? HabitLogsFile()
        loaded = true
    }

    // MARK: Acciones sobre registros

    func toggleDone(_ habit: HabitDefinition, on date: Date) async {
        let willBeDone = !isDone(habit, on: date)
        haptic(completed: willBeDone)

        await mutateLogs { logs in
            let key = habit.periodKey(for: date)
            var entry = logs.entry(periodKey: key, habitId: habit.id) ?? HabitLogEntry()
            if habit.kind == .check {
                entry.done = willBeDone
            } else {
                // Igual que la web: al marcar se salta al objetivo (o a 1 si no
                // hay), y al desmarcar se vuelve a 0.
                entry.value = willBeDone ? (habit.usableTarget ?? 1) : 0
            }
            logs.set(entry, periodKey: key, habitId: habit.id)
        }
    }

    func addMeasure(_ habit: HabitDefinition, delta: Double, on date: Date) async {
        let wasDone = isDone(habit, on: date)
        await mutateLogs { logs in
            let key = habit.periodKey(for: date)
            var entry = logs.entry(periodKey: key, habitId: habit.id) ?? HabitLogEntry()
            entry.value = max(0, (entry.value ?? 0) + delta)
            logs.set(entry, periodKey: key, habitId: habit.id)
        }
        // El háptico se decide después: sumar puede completar el objetivo.
        haptic(completed: !wasDone && isDone(habit, on: date))
    }

    private func haptic(completed: Bool) {
        if completed { completionTick &+= 1 } else { selectionTick &+= 1 }
    }

    // MARK: Acciones sobre definiciones

    func create(_ habit: HabitDefinition) async {
        await mutateHabits { file in
            file.habits.append(habit)
        }
    }

    func delete(_ habit: HabitDefinition) async {
        await mutateHabits { file in
            file.habits.removeAll { $0.id == habit.id }
        }
    }

    // MARK: Escritura

    /// Aplica el cambio dos veces a propósito: primero sobre el estado local
    /// (respuesta inmediata) y después sobre lo último que hay en `SyncStore`,
    /// que es lo que se guarda. Así un cambio llegado de otro dispositivo entre
    /// la carga y el toque no se pierde al reescribir el fichero entero.
    private func mutateLogs(_ body: (inout HabitLogsFile) -> Void) async {
        body(&logs)
        var latest = await SyncStore.shared.decoded(HabitLogsFile.self, forKey: StorageKeys.habitLogs)
            ?? HabitLogsFile()
        body(&latest)
        logs = latest
        await SyncStore.shared.encode(latest, forKey: StorageKeys.habitLogs)
    }

    private func mutateHabits(_ body: (inout HabitsFile) -> Void) async {
        body(&file)
        var latest = await SyncStore.shared.decoded(HabitsFile.self, forKey: StorageKeys.habits)
            ?? HabitsFile()
        body(&latest)
        file = latest
        await SyncStore.shared.encode(latest, forKey: StorageKeys.habits)
    }

    // MARK: Calendario

    /// % de cumplimiento por día para las celdas visibles.
    func calendarMeta(for cells: [HabitCalendarMath.Cell], today: Date) -> [String: HabitDayMeta] {
        let calendar = Calendar.current
        let startOfToday = calendar.startOfDay(for: today)
        let active = habits
        var out: [String: HabitDayMeta] = [:]
        for cell in cells {
            let scheduled = active.filter { $0.isScheduled(on: cell.date) }
            // El futuro no se colorea: aún no ha pasado, no es un incumplimiento.
            let isFuture = calendar.startOfDay(for: cell.date) > startOfToday
            guard !scheduled.isEmpty, !isFuture else {
                out[cell.ymd] = isFuture ? .future : .empty
                continue
            }
            let done = scheduled.filter { habit in
                habit.isDone(logs.entry(for: habit, on: cell.date))
            }.count
            out[cell.ymd] = HabitDayMeta(
                done: done,
                total: scheduled.count,
                pct: Int((100 * Double(done) / Double(scheduled.count)).rounded()),
                isFuture: false
            )
        }
        return out
    }
}

// MARK: - Metadatos de día

struct HabitDayMeta: Sendable, Equatable {
    var done: Int = 0
    var total: Int = 0
    var pct: Int = 0
    var isFuture: Bool = false

    static let empty = HabitDayMeta()
    static let future = HabitDayMeta(isFuture: true)

    var tone: HabitTone {
        guard total > 0, !isFuture else { return .empty }
        if pct >= 100 { return .full }
        if pct >= 67 { return .high }
        if pct >= 34 { return .mid }
        return .low
    }

    func accessibilityLabel(ymd: String) -> String {
        if isFuture { return "\(ymd), aún no" }
        if total == 0 { return "\(ymd), sin hábitos" }
        return "\(ymd), \(done) de \(total), \(pct) por ciento"
    }
}

// MARK: - Tonos del calendario

enum HabitTone: Sendable, Equatable {
    case empty, low, mid, high, full

    /// Tinte translúcido + anillo, como en la web: sobre negro puro un color
    /// plano cantaría demasiado y en claro perdería el gris del lienzo.
    func fill(palette: AppPalette, inMonth: Bool) -> Color {
        switch self {
        case .empty:
            return inMonth
                ? palette.canvas.opacity(0.5)
                : palette.surfaceMuted.opacity(0.3)
        case .low: return HabitPalette.danger.opacity(0.12)
        case .mid: return HabitPalette.warning.opacity(0.14)
        case .high: return HabitPalette.success.opacity(0.12)
        case .full: return HabitPalette.success.opacity(0.20)
        }
    }

    var ring: Color {
        switch self {
        case .empty: return .clear
        case .low: return HabitPalette.danger.opacity(0.25)
        case .mid: return HabitPalette.warning.opacity(0.25)
        case .high: return HabitPalette.success.opacity(0.22)
        case .full: return HabitPalette.success.opacity(0.30)
        }
    }
}

/// Los tres semáforos no están en la paleta del tema (que es monocroma), así que
/// se replican aquí los mismos hex de Tailwind que usa la web.
enum HabitPalette {
    static let success = Color(hex: 0x10B981)   // emerald-500
    static let warning = Color(hex: 0xF59E0B)   // amber-500
    static let danger = Color(hex: 0xEF4444)    // red-500
    static let progress = Color(hex: 0x059669, opacity: 0.9)  // emerald-600/90

    static let successFill = success.opacity(0.16)
    static let successRing = success.opacity(0.35)

    /// En claro el verde oscuro es legible; en oscuro hay que subir el tono.
    static func successInk(_ palette: AppPalette) -> Color {
        palette.isDark ? Color(hex: 0x34D399) : Color(hex: 0x065F46)
    }
}

// MARK: - Fechas del calendario

/// Aritmética de fechas de la pantalla. `Habit.swift` tiene sus propias
/// utilidades pero son privadas de aquel fichero; aquí se replican con la misma
/// convención: semana que empieza en lunes y día de semana estilo JS (0 = domingo).
enum HabitCalendarMath {

    struct Cell: Identifiable, Hashable {
        let date: Date
        let ymd: String
        let day: Int
        let inMonth: Bool
        var id: String { ymd }
    }

    static let spanish = Locale(identifier: "es_ES")

    static func jsWeekday(of date: Date) -> Int {
        Calendar.current.component(.weekday, from: date) - 1
    }

    static func weekdayLabel(_ n: Int) -> String {
        let names = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"]
        guard n >= 0, n < names.count else { return String(n) }
        return names[n]
    }

    static func ymd(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    static func monthStart(of date: Date) -> Date {
        let cal = Calendar.current
        let c = cal.dateComponents([.year, .month], from: date)
        return cal.date(from: c) ?? cal.startOfDay(for: date)
    }

    static func shiftMonth(_ date: Date, by delta: Int) -> Date {
        Calendar.current.date(byAdding: .month, value: delta, to: date) ?? date
    }

    static func isSameMonth(_ a: Date, _ b: Date) -> Bool {
        Calendar.current.isDate(a, equalTo: b, toGranularity: .month)
    }

    /// 42 celdas (6 semanas) desde el lunes anterior o igual al día 1.
    static func cells(forMonth monthStart: Date) -> [Cell] {
        let cal = Calendar.current
        let first = self.monthStart(of: monthStart)
        let month = cal.component(.month, from: first)
        let pad = (jsWeekday(of: first) + 6) % 7
        guard let start = cal.date(byAdding: .day, value: -pad, to: first) else { return [] }
        return (0..<42).compactMap { offset in
            guard let date = cal.date(byAdding: .day, value: offset, to: start) else { return nil }
            return Cell(
                date: date,
                ymd: ymd(date),
                day: cal.component(.day, from: date),
                inMonth: cal.component(.month, from: date) == month
            )
        }
    }

    static func monthLabel(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = spanish
        f.setLocalizedDateFormatFromTemplate("MMMM yyyy")
        return capitalizedFirst(f.string(from: date))
    }

    static func longDayLabel(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = spanish
        f.setLocalizedDateFormatFromTemplate("EEEE d MMMM")
        return capitalizedFirst(f.string(from: date))
    }

    /// El español escribe los meses en minúscula; la web los capitaliza con CSS.
    private static func capitalizedFirst(_ text: String) -> String {
        guard let first = text.first else { return text }
        return first.uppercased() + text.dropFirst()
    }
}

// MARK: - Números

enum HabitNumber {
    /// Sin decimales cuando el valor es entero: "2 L", no "2,0 L".
    static func format(_ value: Double) -> String {
        guard value.isFinite else { return "0" }
        if value == value.rounded() && abs(value) < 1e9 {
            return String(Int(value))
        }
        return String(format: "%.2f", value)
            .replacingOccurrences(of: ".", with: ",")
    }

    /// Acepta coma decimal: el teclado numérico español la escribe por defecto.
    static func parse(_ text: String) -> Double? {
        let cleaned = text
            .trimmingCharacters(in: .whitespaces)
            .replacingOccurrences(of: ",", with: ".")
        guard let value = Double(cleaned), value.isFinite else { return nil }
        return value
    }
}

// MARK: - Hoja de creación

/// Alta de hábito. Construye el `HabitDefinition` completo y lo entrega; quien
/// la presenta decide dónde guardarlo.
@MainActor
struct HabitEditorSheet: View {

    let onCreate: (HabitDefinition) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.appPalette) private var palette

    @State private var title = ""
    @State private var kind: HabitKind = .check
    @State private var usesWeekdays = true
    @State private var weekdays: Set<Int> = [1, 2, 3, 4, 5]
    @State private var timesPerWeek = 3
    @State private var unit = "L"
    @State private var targetText = "2"
    @State private var reminderOn = false
    @State private var reminderTime = HabitEditorSheet.defaultReminderTime
    @State private var reminderMessage = ""
    @FocusState private var titleFocused: Bool

    private var canSave: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && (!usesWeekdays || !weekdays.isEmpty)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: AppSpacing.xl) {
                    field("Nombre") {
                        TextField("Ej. Beber agua, Meditar…", text: $title)
                            .textInputAutocapitalization(.sentences)
                            .focused($titleFocused)
                            .fieldBox()
                    }

                    field("Tipo") {
                        Picker("Tipo", selection: $kind) {
                            Text("Check").tag(HabitKind.check)
                            Text("Medida").tag(HabitKind.measure)
                        }
                        .pickerStyle(.segmented)
                        Text(kind == .check
                             ? "Hecho o no hecho."
                             : "Suma cantidades hasta el objetivo.")
                            .font(AppFont.caption)
                            .foregroundStyle(ThemeColor(.inkMuted))
                    }

                    if kind == .measure {
                        HStack(alignment: .top, spacing: AppSpacing.md) {
                            field("Unidad") {
                                TextField("L, min, páginas…", text: $unit)
                                    .textInputAutocapitalization(.never)
                                    .fieldBox()
                            }
                            field("Objetivo") {
                                TextField("Opcional", text: $targetText)
                                    .keyboardType(.decimalPad)
                                    .fieldBox()
                            }
                        }
                    }

                    field("Frecuencia") {
                        Picker("Frecuencia", selection: $usesWeekdays) {
                            Text("Días concretos").tag(true)
                            Text("Veces/semana").tag(false)
                        }
                        .pickerStyle(.segmented)
                    }

                    if usesWeekdays {
                        field("Días") {
                            weekdayChips
                            if weekdays.isEmpty {
                                Text("Elige al menos un día.")
                                    .font(AppFont.caption)
                                    .foregroundStyle(HabitPalette.danger)
                            }
                        }
                    } else {
                        field("Veces por semana") {
                            Stepper(value: $timesPerWeek, in: 1...7) {
                                Text("\(timesPerWeek) veces por semana")
                                    .font(AppFont.body)
                                    .foregroundStyle(ThemeColor(.ink))
                            }
                            Text("El registro es semanal: cuenta de lunes a domingo.")
                                .font(AppFont.caption)
                                .foregroundStyle(ThemeColor(.inkMuted))
                        }
                    }

                    reminderBlock
                }
                .padding(AppSpacing.lg)
            }
            .background(ThemeColor(.canvas))
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Nuevo hábito")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Crear") { save() }
                        .fontWeight(.bold)
                        .disabled(!canSave)
                }
            }
        }
        .presentationDragIndicator(.visible)
        .task {
            // El foco puesto en `onAppear` se pierde con la animación de
            // presentación de la hoja; hay que esperar a que termine.
            try? await Task.sleep(for: .milliseconds(400))
            titleFocused = true
        }
    }

    // MARK: Bloques

    private var weekdayChips: some View {
        // Orden de la semana española: lunes primero, domingo al final.
        HStack(spacing: 6) {
            ForEach([1, 2, 3, 4, 5, 6, 0], id: \.self) { day in
                let on = weekdays.contains(day)
                Button {
                    if on { weekdays.remove(day) } else { weekdays.insert(day) }
                } label: {
                    Text(HabitCalendarMath.weekdayLabel(day))
                        .font(.system(size: 12, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 38)
                        .foregroundStyle(on ? palette.onAccent : palette.ink)
                        .background {
                            RoundedRectangle(cornerRadius: AppRadius.small, style: .continuous)
                                .fill(on ? palette.accent : palette.surface)
                                .overlay {
                                    RoundedRectangle(cornerRadius: AppRadius.small, style: .continuous)
                                        .strokeBorder(
                                            on ? Color.clear : palette.border,
                                            lineWidth: AppMetrics.hairline
                                        )
                                }
                        }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(HabitCalendarMath.weekdayLabel(day))
                .accessibilityAddTraits(on ? [.isSelected] : [])
            }
        }
    }

    private var reminderBlock: some View {
        VStack(alignment: .leading, spacing: AppSpacing.md) {
            Toggle(isOn: $reminderOn) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Recordatorio")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(ThemeColor(.ink))
                    Text("Notificación local con tu mensaje.")
                        .font(AppFont.caption)
                        .foregroundStyle(ThemeColor(.inkMuted))
                }
            }

            if reminderOn {
                DatePicker(
                    "Hora",
                    selection: $reminderTime,
                    displayedComponents: .hourAndMinute
                )
                .font(AppFont.body)
                .foregroundStyle(ThemeColor(.ink))

                TextField("Ej. Vamos, 5 minutos y listo.", text: $reminderMessage)
                    .fieldBox()
            }
        }
        .padding(AppSpacing.lg)
        .background {
            RoundedRectangle(cornerRadius: AppRadius.medium, style: .continuous)
                .fill(ThemeColor(.surface))
                .overlay {
                    RoundedRectangle(cornerRadius: AppRadius.medium, style: .continuous)
                        .strokeBorder(ThemeColor(.border), lineWidth: AppMetrics.hairline)
                }
        }
    }

    private func field<Content: View>(
        _ label: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: AppSpacing.sm) {
            Text(label)
                .font(.system(size: 11, weight: .semibold))
                .textCase(.uppercase)
                .kerning(0.8)
                .foregroundStyle(ThemeColor(.inkMuted))
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Guardar

    private func save() {
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanTitle.isEmpty else { return }

        let schedule: HabitSchedule = usesWeekdays
            ? .weekdays(weekdays.sorted())
            : .timesPerWeek(min(7, max(1, timesPerWeek)))
        let now = HabitEditorSheet.isoNow()
        let cleanUnit = unit.trimmingCharacters(in: .whitespacesAndNewlines)

        let habit = HabitDefinition(
            id: UUID().uuidString,
            title: cleanTitle,
            kind: kind,
            schedule: schedule,
            unit: kind == .measure && !cleanUnit.isEmpty ? cleanUnit : nil,
            target: kind == .measure ? HabitNumber.parse(targetText) : nil,
            targetMode: kind == .measure ? .atLeast : nil,
            reminder: HabitReminder(
                enabled: reminderOn,
                timeLocal: HabitEditorSheet.hhmm(from: reminderTime),
                message: reminderMessage.trimmingCharacters(in: .whitespacesAndNewlines)
            ),
            createdAt: now,
            updatedAt: now,
            archived: false
        )
        onCreate(habit)
        dismiss()
    }

    private static var defaultReminderTime: Date {
        Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: Date()) ?? Date()
    }

    private static func hhmm(from date: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", c.hour ?? 9, c.minute ?? 0)
    }

    /// Mismo formato que `new Date().toISOString()` en la web: la lista se
    /// ordena por esta cadena, así que tiene que comparar igual en ambas.
    private static func isoNow() -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        f.timeZone = TimeZone(secondsFromGMT: 0)
        return f.string(from: Date())
    }
}

// MARK: - Estilo de campo

private struct FieldBoxModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(AppFont.body)
            .foregroundStyle(ThemeColor(.ink))
            .padding(.horizontal, AppSpacing.md)
            .frame(minHeight: 44)
            .background {
                RoundedRectangle(cornerRadius: AppRadius.small, style: .continuous)
                    .fill(ThemeColor(.surface))
                    .overlay {
                        RoundedRectangle(cornerRadius: AppRadius.small, style: .continuous)
                            .strokeBorder(ThemeColor(.border), lineWidth: AppMetrics.hairline)
                    }
            }
    }
}

extension View {
    fileprivate func fieldBox() -> some View {
        modifier(FieldBoxModifier())
    }
}

// MARK: - Previews

#Preview("Hábitos — claro") {
    HabitsPreview().studyOSTheme().preferredColorScheme(.light)
}

#Preview("Hábitos — oscuro") {
    HabitsPreview().studyOSTheme().preferredColorScheme(.dark)
}

private struct HabitsPreview: View {
    var body: some View {
        // La vista real lee de `SyncStore`; en el lienzo de Xcode no hay datos,
        // así que se ve el estado vacío. Es intencionado.
        HabitsView()
    }
}
