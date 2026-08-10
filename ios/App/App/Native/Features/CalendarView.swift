import Combine
import SwiftUI

// MARK: - Evento pintable

/// Un evento tal y como lo necesita la rejilla: fecha, rótulo y color.
///
/// Es deliberadamente independiente de su origen para que los eventos de Google
/// puedan entrar por el mismo sitio cuando exista el cliente nativo.
struct CalendarDayEvent: Identifiable, Sendable, Hashable {
    enum Source: Sendable, Hashable {
        /// «Exámenes y fechas» (`iestudio-important-deadlines`).
        case localDeadline
        /// Reservado para los eventos sincronizados de Google Calendar.
        case google
    }

    let id: String
    let source: Source
    let title: String
    /// Día local "YYYY-MM-DD".
    let ymd: String
    /// "HH:mm" o `nil` si es de todo el día.
    let time: String?
    let durationMinutes: Int
    let colorId: String
    let subject: String?
    let tagIds: [String]

    var isAllDay: Bool { time == nil }

    /// "9:30" a secas o "Todo el día".
    var timeLabel: String {
        guard let time else { return "Todo el día" }
        return time
    }

    /// Rango "9:30 – 10:30" para el detalle del día.
    func rangeLabel(calendar: Calendar) -> String {
        guard let time, let start = CalendarDate.date(fromYMD: ymd, time: time, calendar: calendar) else {
            return "Todo el día"
        }
        let end = calendar.date(byAdding: .minute, value: durationMinutes, to: start) ?? start
        return "\(time) – \(CalendarDate.hhmm(end, calendar: calendar))"
    }

    init(deadline: ImportantDeadline) {
        id = "\(StorageKeys.CalendarIDs.deadlineEventPrefix)\(deadline.id)"
        source = .localDeadline
        title = deadline.title.isEmpty ? "(Sin título)" : deadline.title
        ymd = deadline.date
        time = deadline.time
        durationMinutes = deadline.effectiveDurationMinutes
        colorId = EventColors.normalize(deadline.calendarColorId)
        subject = deadline.subject
        tagIds = deadline.tagIds
    }
}

// MARK: - Modelo

@MainActor
final class CalendarMonthModel: ObservableObject {

    /// Eventos indexados por día ("YYYY-MM-DD"), ya ordenados dentro de cada día.
    @Published private(set) var eventsByDay: [String: [CalendarDayEvent]] = [:]
    /// `id` de etiqueta → rótulo, para el detalle del día.
    @Published private(set) var tagLabels: [String: String] = [:]
    @Published private(set) var isLoaded = false

    private var observer: Task<Void, Never>?

    func onAppear() async {
        if observer == nil { observe() }
        await reload()
        isLoaded = true
    }

    private func observe() {
        observer = Task { [weak self] in
            for await keys in SyncBus.shared.changes() {
                guard let self else { return }
                guard keys.contains("*")
                        || keys.contains(StorageKeys.deadlines)
                        || keys.contains(StorageKeys.deadlineTags)
                else { continue }
                await self.reload()
            }
        }
    }

    private func reload() async {
        let deadlines = await SyncStore.shared.decoded(
            DeadlineList.self, forKey: StorageKeys.deadlines
        ) ?? DeadlineList()
        let tags = await SyncStore.shared.decoded(
            DeadlineTagList.self, forKey: StorageKeys.deadlineTags
        ) ?? DeadlineTagList()

        var buckets: [String: [CalendarDayEvent]] = [:]
        for deadline in deadlines.items where !deadline.date.isEmpty {
            buckets[deadline.date, default: []].append(CalendarDayEvent(deadline: deadline))
        }

        // TODO: eventos de Google Calendar. Cuando exista el cliente nativo,
        // construir un `CalendarDayEvent` con `source: .google` por cada
        // instancia (ojo: los de varios días hay que expandirlos a un evento por
        // jornada) y volcarlos en `buckets` antes de ordenar. El resto de la
        // vista no necesita cambios.

        // Copia de las claves: se está mutando `buckets` dentro del bucle.
        for day in Array(buckets.keys) {
            buckets[day] = (buckets[day] ?? []).sorted { a, b in
                // Los de todo el día van primero, luego por hora.
                if a.isAllDay != b.isAllDay { return a.isAllDay }
                return (a.time ?? "") < (b.time ?? "")
            }
        }

        eventsByDay = buckets
        tagLabels = Dictionary(tags.items.map { ($0.id, $0.label) }, uniquingKeysWith: { _, last in last })
    }

    func events(on ymd: String) -> [CalendarDayEvent] { eventsByDay[ymd] ?? [] }

    func label(forTag id: String) -> String? { tagLabels[id] }
}

// MARK: - Vista

struct CalendarView: View {

    @StateObject private var model = CalendarMonthModel()
    @Environment(\.appPalette) private var palette

    /// Primer día del mes visible.
    @State private var monthAnchor: Date = CalendarDate.startOfMonth(Date(), calendar: CalendarDate.calendar)
    @State private var selectedYMD: String = CalendarDate.ymd(Date(), calendar: CalendarDate.calendar)

    private let calendar = CalendarDate.calendar
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 0), count: 7)

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AppSpacing.lg) {
                monthHeader
                weekdayRow
                grid
                dayDetail
            }
            .padding(.horizontal, AppSpacing.lg)
            .padding(.vertical, AppSpacing.lg)
        }
        // Variante «calendario»: en oscuro todas las superficies son negro puro,
        // así la rejilla no dibuja bandas grises sobre el lienzo.
        .studyOSTheme(calendar: true)
        .canvasBackground()
        .task { await model.onAppear() }
    }

    // MARK: Cabecera

    private var monthHeader: some View {
        HStack(spacing: AppSpacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(CalendarDate.monthTitle(monthAnchor, calendar: calendar))
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(ThemeColor(.ink))
                Text(monthSummary)
                    .font(AppFont.caption)
                    .foregroundStyle(ThemeColor(.inkMuted))
            }
            Spacer(minLength: AppSpacing.sm)
            navButton("chevron.left", label: "Mes anterior") { shiftMonth(-1) }
            Button { goToday() } label: {
                Text("Hoy")
                    .font(AppFont.pill)
                    .foregroundStyle(ThemeColor(.ink))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Capsule().fill(ThemeColor(.surfaceMuted)))
            }
            .buttonStyle(.plain)
            navButton("chevron.right", label: "Mes siguiente") { shiftMonth(1) }
        }
    }

    private var monthSummary: String {
        let days = CalendarDate.daysOfMonth(monthAnchor, calendar: calendar)
        let count = days.reduce(0) { $0 + model.events(on: CalendarDate.ymd($1, calendar: calendar)).count }
        if count == 0 { return "Sin fechas marcadas" }
        return count == 1 ? "1 fecha marcada" : "\(count) fechas marcadas"
    }

    private func navButton(_ systemName: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(ThemeColor(.ink))
                .frame(width: 32, height: 32)
                .background(Circle().fill(ThemeColor(.surfaceMuted)))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    // MARK: Rejilla

    private var weekdayRow: some View {
        HStack(spacing: 0) {
            ForEach(CalendarDate.weekdaySymbols(calendar: calendar), id: \.self) { symbol in
                Text(symbol)
                    .font(.system(size: 11, weight: .semibold))
                    .kerning(0.6)
                    .foregroundStyle(ThemeColor(.inkFaint))
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private var grid: some View {
        LazyVGrid(columns: columns, spacing: 0) {
            ForEach(CalendarDate.gridDays(monthAnchor, calendar: calendar), id: \.self) { day in
                dayCell(day)
            }
        }
        .background(
            RoundedRectangle(cornerRadius: AppRadius.medium, style: .continuous)
                .fill(ThemeColor(.surface))
        )
        .overlay {
            RoundedRectangle(cornerRadius: AppRadius.medium, style: .continuous)
                .strokeBorder(ThemeColor(.border), lineWidth: AppMetrics.hairline)
        }
        // El recorte va después del trazo para que las celdas de las esquinas no
        // se salgan del radio de la tarjeta.
        .clipShape(RoundedRectangle(cornerRadius: AppRadius.medium, style: .continuous))
        .gesture(
            DragGesture(minimumDistance: 40)
                .onEnded { value in
                    if value.translation.width < 0 { shiftMonth(1) }
                    if value.translation.width > 0 { shiftMonth(-1) }
                }
        )
    }

    private func dayCell(_ day: Date) -> some View {
        let ymd = CalendarDate.ymd(day, calendar: calendar)
        let events = model.events(on: ymd)
        let inMonth = calendar.isDate(day, equalTo: monthAnchor, toGranularity: .month)
        let isToday = calendar.isDateInToday(day)
        let isSelected = ymd == selectedYMD

        return VStack(alignment: .leading, spacing: 2) {
            Text("\(calendar.component(.day, from: day))")
                .font(.system(size: 12, weight: isToday ? .bold : .medium))
                .monospacedDigit()
                .foregroundStyle(isToday ? ThemeColor(.onAccent) : ThemeColor(inMonth ? .ink : .inkFaint))
                .frame(width: 20, height: 20)
                .background {
                    if isToday {
                        Circle().fill(ThemeColor(.accent))
                    }
                }

            ForEach(events.prefix(2)) { event in
                chip(event)
            }
            if events.count > 2 {
                Text("+\(events.count - 2)")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(ThemeColor(.inkMuted))
                    .padding(.leading, 2)
            }
            Spacer(minLength: 0)
        }
        .padding(4)
        .frame(height: 88, alignment: .topLeading)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(ThemeColor(isSelected ? .surfaceMuted : .surface))
        .overlay(alignment: .top) { Hairline() }
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(ThemeColor(.border))
                .frame(width: AppMetrics.hairline)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            selectedYMD = ymd
            // Tocar un día del mes contiguo salta a ese mes, como en la web.
            if !inMonth { monthAnchor = CalendarDate.startOfMonth(day, calendar: calendar) }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(CalendarDate.accessibleDay(day, calendar: calendar, eventCount: events.count))
    }

    private func chip(_ event: CalendarDayEvent) -> some View {
        let style = EventColors.style(for: event.colorId, palette: palette)
        return HStack(spacing: 3) {
            Rectangle()
                .fill(style.borderLeft)
                .frame(width: 2)
            Text(event.title)
                .font(.system(size: 9, weight: .semibold))
                .lineLimit(1)
                .foregroundStyle(style.text)
                .padding(.trailing, 2)
        }
        .frame(height: 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(style.background)
        .clipShape(RoundedRectangle(cornerRadius: 3, style: .continuous))
    }

    // MARK: Detalle del día

    private var dayDetail: some View {
        VStack(alignment: .leading, spacing: AppSpacing.md) {
            SectionHeader(CalendarDate.longDayLabel(selectedYMD, calendar: calendar)) {
                if !model.events(on: selectedYMD).isEmpty {
                    Pill("\(model.events(on: selectedYMD).count)")
                }
            }

            if model.events(on: selectedYMD).isEmpty {
                Card {
                    EmptyState(
                        systemImage: "calendar",
                        title: "Nada este día",
                        message: "Las entregas y exámenes que crees en «Exámenes y fechas» aparecerán aquí."
                    )
                }
            } else {
                ForEach(model.events(on: selectedYMD)) { event in
                    eventRow(event)
                }
            }
        }
    }

    private func eventRow(_ event: CalendarDayEvent) -> some View {
        let style = EventColors.style(for: event.colorId, palette: palette)
        return HStack(alignment: .top, spacing: AppSpacing.md) {
            VStack(alignment: .leading, spacing: 4) {
                Text(event.title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(ThemeColor(.ink))
                    .fixedSize(horizontal: false, vertical: true)
                Text(event.rangeLabel(calendar: calendar))
                    .font(AppFont.caption)
                    .foregroundStyle(style.textMuted)
                if let subject = event.subject {
                    Text(subject)
                        .font(AppFont.caption)
                        .foregroundStyle(ThemeColor(.inkMuted))
                }
                let labels = event.tagIds.compactMap { model.label(forTag: $0) }
                if !labels.isEmpty {
                    HStack(spacing: AppSpacing.xs) {
                        ForEach(labels, id: \.self) { Pill($0, style: .outline) }
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(AppSpacing.md)
        .eventChipBackground(style, radius: AppRadius.small)
    }

    // MARK: Navegación

    private func shiftMonth(_ delta: Int) {
        guard let next = calendar.date(byAdding: .month, value: delta, to: monthAnchor) else { return }
        withAnimation(.easeOut(duration: 0.18)) {
            monthAnchor = CalendarDate.startOfMonth(next, calendar: calendar)
        }
    }

    private func goToday() {
        let today = Date()
        withAnimation(.easeOut(duration: 0.18)) {
            monthAnchor = CalendarDate.startOfMonth(today, calendar: calendar)
            selectedYMD = CalendarDate.ymd(today, calendar: calendar)
        }
    }
}

// MARK: - Fechas del calendario

enum CalendarDate {

    /// La web pinta la semana de lunes a domingo; se fuerza aquí para que el
    /// móvil no cambie de disposición según la región del dispositivo.
    static var calendar: Calendar {
        var cal = Calendar.current
        cal.firstWeekday = 2
        return cal
    }

    static func ymd(_ date: Date, calendar: Calendar) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    static func date(fromYMD raw: String, calendar: Calendar) -> Date? {
        let parts = raw.split(separator: "-")
        guard parts.count == 3,
              let y = Int(parts[0]), let mo = Int(parts[1]), let d = Int(parts[2])
        else { return nil }
        var comps = DateComponents()
        comps.year = y
        comps.month = mo
        comps.day = d
        return calendar.date(from: comps)
    }

    /// Día + "HH:mm" en la zona local.
    static func date(fromYMD raw: String, time: String, calendar: Calendar) -> Date? {
        guard let day = date(fromYMD: raw, calendar: calendar) else { return nil }
        let parts = time.split(separator: ":")
        guard parts.count == 2, let h = Int(parts[0]), let m = Int(parts[1]) else { return day }
        return calendar.date(bySettingHour: h, minute: m, second: 0, of: day)
    }

    static func hhmm(_ date: Date, calendar: Calendar) -> String {
        let c = calendar.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }

    static func startOfMonth(_ date: Date, calendar: Calendar) -> Date {
        let comps = calendar.dateComponents([.year, .month], from: date)
        return calendar.date(from: comps) ?? date
    }

    static func daysOfMonth(_ anchor: Date, calendar: Calendar) -> [Date] {
        let start = startOfMonth(anchor, calendar: calendar)
        guard let range = calendar.range(of: .day, in: .month, for: start) else { return [] }
        return range.compactMap { calendar.date(byAdding: .day, value: $0 - 1, to: start) }
    }

    /// Días de la rejilla: semanas completas que cubren el mes. El número de
    /// filas se calcula, no se fija a 6, para no dejar una fila vacía abajo.
    static func gridDays(_ anchor: Date, calendar: Calendar) -> [Date] {
        let start = startOfMonth(anchor, calendar: calendar)
        let weekday = calendar.component(.weekday, from: start)
        let leading = (weekday - calendar.firstWeekday + 7) % 7
        let dayCount = calendar.range(of: .day, in: .month, for: start)?.count ?? 30
        let cells = Int((Double(leading + dayCount) / 7).rounded(.up)) * 7
        guard let first = calendar.date(byAdding: .day, value: -leading, to: start) else { return [] }
        return (0..<cells).compactMap { calendar.date(byAdding: .day, value: $0, to: first) }
    }

    /// "L M X J V S D" en el orden que marca `firstWeekday`.
    static func weekdaySymbols(calendar: Calendar) -> [String] {
        let symbols = calendar.veryShortWeekdaySymbols
        guard symbols.count == 7 else { return symbols }
        let shift = calendar.firstWeekday - 1
        return Array(symbols[shift...] + symbols[..<shift]).map { $0.uppercased() }
    }

    /// "agosto de 2026", con la inicial en mayúscula.
    static func monthTitle(_ date: Date, calendar: Calendar) -> String {
        let raw = date.formatted(.dateTime.month(.wide).year().locale(calendar.locale ?? .current))
        return raw.prefix(1).uppercased() + raw.dropFirst()
    }

    static func longDayLabel(_ ymd: String, calendar: Calendar) -> String {
        guard let date = date(fromYMD: ymd, calendar: calendar) else { return ymd }
        return date.formatted(
            .dateTime.weekday(.wide).day().month(.wide).locale(calendar.locale ?? .current)
        )
    }

    static func accessibleDay(_ date: Date, calendar: Calendar, eventCount: Int) -> String {
        let day = date.formatted(.dateTime.weekday(.wide).day().month(.wide).locale(calendar.locale ?? .current))
        if eventCount == 0 { return day }
        return eventCount == 1 ? "\(day), 1 evento" : "\(day), \(eventCount) eventos"
    }
}

// MARK: - Previews

#Preview("Calendario — oscuro") {
    CalendarView().studyOSTheme().preferredColorScheme(.dark)
}

#Preview("Calendario — claro") {
    CalendarView().studyOSTheme().preferredColorScheme(.light)
}
