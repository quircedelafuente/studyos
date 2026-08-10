import SwiftUI

// MARK: - Clave de asignatura

/// Cómo se agrupa un deadline por asignatura.
///
/// Se prefiere `subject` (viaja dentro del propio deadline) sobre `courseId`,
/// que apunta al registro de cursos y ese NO se sincroniza: en iOS es casi
/// siempre un id huérfano. Misma prioridad que `subjectKeyOf` de la web.
enum DeadlineSubjectKey: Hashable, Identifiable, Sendable {
    case subject(String)
    case course(String)
    case unassigned

    var id: String {
        switch self {
        case .subject(let value): "s:\(value)"
        case .course(let value): "c:\(value)"
        case .unassigned: ""
        }
    }

    static func of(_ deadline: ImportantDeadline) -> DeadlineSubjectKey {
        if let subject = deadline.subject, !subject.isEmpty { return .subject(subject) }
        if let courseId = deadline.courseId, !courseId.isEmpty { return .course(courseId) }
        return .unassigned
    }

    var label: String {
        switch self {
        case .subject(let value): value
        // El nombre del curso vive en `iestudio-manual-courses` / la caché de
        // Blackboard, que el servidor no sube: aquí solo se sabe que hay uno.
        case .course: "Asignatura sin sincronizar"
        case .unassigned: "Sin asignatura"
        }
    }
}

// MARK: - Formatos

enum DeadlineFormat {

    /// Se fija el español como en la web (`toLocaleDateString("es")`): la app es
    /// monolingüe y con la configuración del sistema en inglés se mezclarían.
    private static let spanish = Locale(identifier: "es_ES")

    static let longDay = Date.FormatStyle(locale: spanish)
        .weekday(.abbreviated)
        .day()
        .month(.wide)
        .year()

    static let shortDay = Date.FormatStyle(locale: spanish)
        .weekday(.abbreviated)
        .day()
        .month(.abbreviated)

    static let clock = Date.FormatStyle(date: .omitted, time: .shortened, locale: spanish)

    /// `toISOString()` del navegador: UTC y con milisegundos.
    private static let iso = Date.ISO8601FormatStyle(includingFractionalSeconds: true)

    static func isoNow() -> String { iso.format(Date()) }

    /// Fecha local → "YYYY-MM-DD". A mano, no con `DateFormatter`: los
    /// calendarios no gregorianos del sistema darían otro año.
    static func ymd(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    static func hhmm(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }

    /// Línea «mar, 5 de agosto de 2026 · 14:30 · Cálculo».
    static func summaryLine(for deadline: ImportantDeadline, subject: String?) -> String {
        var parts: [String] = []
        if let day = deadline.dayStart {
            parts.append(day.formatted(longDay))
        } else if !deadline.date.isEmpty {
            parts.append(deadline.date) // fecha corrupta: se enseña cruda antes que nada
        }
        if deadline.time != nil, let start = deadline.startDate {
            parts.append(start.formatted(clock))
        }
        if let subject, !subject.isEmpty { parts.append(subject) }
        return parts.joined(separator: " · ")
    }

    static func relativeLabel(for deadline: ImportantDeadline) -> String? {
        guard let days = deadline.daysFromToday else { return nil }
        return switch days {
        case 0: "Hoy"
        case 1: "Mañana"
        case -1: "Ayer"
        case let future where future > 1: "En \(future) días"
        default: "Hace \(-days) días"
        }
    }
}

// MARK: - Modelo de pantalla

@MainActor
final class DeadlinesModel: ObservableObject {

    /// Lista completa tal cual está guardada, INCLUIDOS los ítems generados por
    /// el Study Planner. Se conservan porque al guardar se reescribe el array
    /// entero: filtrarlos aquí los borraría de la web.
    @Published private(set) var storedItems: [ImportantDeadline] = []
    @Published private(set) var tagRegistry: [DeadlineTag] = []
    @Published private(set) var hasLoaded = false

    // Consultas de la lista. Viven en memoria: son filtros, no ajustes.
    @Published var sortAscending = true
    @Published var subjectFilter: DeadlineSubjectKey?
    @Published var tagFilter: String?
    @Published var hidePast = false

    /// Los ítems que sí pertenecen a esta pantalla. La web los reconoce por el
    /// prefijo del id ("study-<planId>-<fecha>").
    var items: [ImportantDeadline] {
        storedItems.filter { !$0.id.hasPrefix("study-") }
    }

    var filtered: [ImportantDeadline] {
        let today = DeadlineFormat.ymd(Date())
        let ascending = sortAscending
        return items
            .filter { deadline in
                if let subjectFilter, DeadlineSubjectKey.of(deadline) != subjectFilter { return false }
                if let tagFilter, !deadline.tagIds.contains(tagFilter) { return false }
                // Comparación de cadenas: "YYYY-MM-DD" ordena igual que la fecha.
                if hidePast, deadline.date < today { return false }
                return true
            }
            .sorted { a, b in
                if a.date != b.date { return ascending ? a.date < b.date : a.date > b.date }
                let ta = a.time ?? ""
                let tb = b.time ?? ""
                if ta != tb { return ascending ? ta < tb : ta > tb }
                // El título solo desempata; nunca invierte con el orden.
                return a.title.localizedStandardCompare(b.title) == .orderedAscending
            }
    }

    /// Solo las asignaturas presentes en la lista: ofrecer filtros vacíos confunde.
    var subjectOptions: [DeadlineSubjectKey] {
        var seen = Set<String>()
        var out: [DeadlineSubjectKey] = []
        var hasUnassigned = false
        for deadline in items {
            let key = DeadlineSubjectKey.of(deadline)
            if key == .unassigned {
                hasUnassigned = true
                continue
            }
            if seen.insert(key.id).inserted { out.append(key) }
        }
        out.sort { $0.label.localizedStandardCompare($1.label) == .orderedAscending }
        if hasUnassigned { out.append(.unassigned) }
        return out
    }

    /// Etiquetas realmente en uso, por el mismo motivo.
    var tagOptions: [DeadlineTag] {
        let used = Set(items.flatMap(\.tagIds))
        return tagRegistry
            .filter { used.contains($0.id) }
            .sorted { $0.label.localizedStandardCompare($1.label) == .orderedAscending }
    }

    /// Asignaturas ya escritas alguna vez, para sugerirlas en el editor.
    var subjectSuggestions: [String] {
        var seen = Set<String>()
        var out: [String] = []
        for deadline in items {
            guard let subject = deadline.subject, !subject.isEmpty else { continue }
            if seen.insert(subject.lowercased()).inserted { out.append(subject) }
        }
        return out.sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    }

    var activeFilterCount: Int {
        (subjectFilter != nil ? 1 : 0) + (tagFilter != nil ? 1 : 0) + (hidePast ? 1 : 0)
    }

    var sortedTagRegistry: [DeadlineTag] {
        tagRegistry.sorted { $0.label.localizedStandardCompare($1.label) == .orderedAscending }
    }

    func resolvedTags(for deadline: ImportantDeadline) -> [DeadlineTag] {
        // Se respeta el orden de `tagIds`, no el del registro.
        deadline.tagIds.compactMap { id in tagRegistry.first { $0.id == id } }
    }

    func clearFilters() {
        subjectFilter = nil
        tagFilter = nil
        hidePast = false
    }

    // MARK: Carga y escritura

    func load() async {
        let list = await SyncStore.shared.decoded(DeadlineList.self, forKey: StorageKeys.deadlines)
        let tags = await SyncStore.shared.decoded(DeadlineTagList.self, forKey: StorageKeys.deadlineTags)
        storedItems = list?.items ?? []
        tagRegistry = tags?.items ?? []
        hasLoaded = true
    }

    /// Recarga solo si el cambio afecta a esta pantalla. Evita redecodificar
    /// meses de datos cada vez que se sincroniza cualquier otra clave.
    func reload(ifChanged keys: Set<String>) async {
        guard keys.contains(StorageKeys.deadlines)
            || keys.contains(StorageKeys.deadlineTags)
            || keys.contains("*")
        else { return }
        await load()
    }

    func save(_ deadline: ImportantDeadline) async {
        if let index = storedItems.firstIndex(where: { $0.id == deadline.id }) {
            storedItems[index] = deadline
        } else {
            storedItems.append(deadline)
        }
        await persistDeadlines()
    }

    func delete(id: String) async {
        storedItems.removeAll { $0.id == id }
        await persistDeadlines()
    }

    func setColor(_ colorId: String, for id: String) async {
        guard let index = storedItems.firstIndex(where: { $0.id == id }) else { return }
        storedItems[index].calendarColorId = EventColors.normalize(colorId)
        await persistDeadlines()
    }

    /// Equivale a `findOrCreateDeadlineTag`: reutiliza la etiqueta si ya existe
    /// ignorando mayúsculas, y si no la crea y la persiste.
    @discardableResult
    func findOrCreateTag(_ rawLabel: String) async -> DeadlineTag? {
        let label = DeadlinesModel.normalizeTagLabel(rawLabel)
        guard !label.isEmpty else { return nil }
        if let existing = tagRegistry.first(where: { $0.label.lowercased() == label.lowercased() }) {
            return existing
        }
        let tag = DeadlineTag(
            id: UUID().uuidString.lowercased(),
            label: label,
            createdAt: DeadlineFormat.isoNow()
        )
        tagRegistry.append(tag)
        await SyncStore.shared.encode(DeadlineTagList(items: tagRegistry), forKey: StorageKeys.deadlineTags)
        return tag
    }

    private func persistDeadlines() async {
        await SyncStore.shared.encode(DeadlineList(items: storedItems), forKey: StorageKeys.deadlines)
    }

    /// Recorta espacios, colapsa los internos y limita a 48 caracteres, igual
    /// que `normalizeLabel` en `deadline-tags-storage.ts`.
    static func normalizeTagLabel(_ raw: String) -> String {
        let collapsed = raw.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        return String(collapsed.prefix(48))
    }
}

// MARK: - Pantalla

/// «Exámenes y fechas»: réplica nativa de `DeadlinesPanel.tsx`.
///
/// No monta su propio `NavigationStack` para poder anidarse en el contenedor de
/// la app; por eso los controles (nuevo, orden, filtros) van en el contenido y
/// no en la barra de navegación, que puede no existir.
struct DeadlinesView: View {

    @StateObject private var model = DeadlinesModel()
    @State private var editorTarget: DeadlineEditorTarget?
    @State private var pendingDeletion: ImportantDeadline?

    var body: some View {
        VStack(spacing: 0) {
            header
            Hairline()
            content
        }
        .canvasBackground()
        .navigationTitle("Exámenes y fechas")
        .studyOSTheme()
        .task {
            guard !model.hasLoaded else { return }
            await model.load()
        }
        .onReceive(SyncBus.shared.$lastChangedKeys) { keys in
            Task { await model.reload(ifChanged: keys) }
        }
        .sheet(item: $editorTarget) { target in
            DeadlineEditor(model: model, existing: target.deadline)
        }
        .confirmationDialog(
            "¿Eliminar esta fecha?",
            isPresented: Binding(
                get: { pendingDeletion != nil },
                set: { if !$0 { pendingDeletion = nil } }
            ),
            titleVisibility: .visible,
            presenting: pendingDeletion
        ) { deadline in
            Button("Eliminar", role: .destructive) {
                Task { await model.delete(id: deadline.id) }
            }
            Button("Cancelar", role: .cancel) {}
        } message: { deadline in
            Text(deadline.title)
        }
    }

    // MARK: Cabecera

    private var header: some View {
        VStack(alignment: .leading, spacing: AppSpacing.md) {
            SectionHeader("Tu lista", subtitle: countLabel) {
                Button {
                    editorTarget = .create
                } label: {
                    Label("Nuevo", systemImage: "plus")
                        .font(AppFont.pill)
                        .padding(.horizontal, AppSpacing.md)
                        .padding(.vertical, AppSpacing.sm)
                        .foregroundStyle(ThemeColor(.onAccent))
                        .background(Capsule(style: .continuous).fill(ThemeColor(.accent)))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Añadir fecha o examen")
            }
            .padding(.horizontal, AppSpacing.lg)

            filterBar
        }
        .padding(.top, AppSpacing.md)
        .padding(.bottom, AppSpacing.md)
    }

    /// "N de M" cuando hay filtros; solo "N" cuando se ve todo (como la web).
    private var countLabel: String {
        let shown = model.filtered.count
        let total = model.items.count
        return shown == total ? "\(shown)" : "\(shown) de \(total)"
    }

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: AppSpacing.sm) {
                Button {
                    model.sortAscending.toggle()
                } label: {
                    FilterChipLabel(
                        title: model.sortAscending ? "Más próximas" : "Más lejanas",
                        systemImage: model.sortAscending ? "arrow.up" : "arrow.down",
                        isActive: false
                    )
                }
                .buttonStyle(.plain)
                .accessibilityLabel(
                    model.sortAscending
                        ? "Ordenando de más próxima a más lejana"
                        : "Ordenando de más lejana a más próxima"
                )

                if !model.subjectOptions.isEmpty {
                    Menu {
                        // El `Picker` dentro del menú pinta la marca de selección
                        // sin tener que construirla a mano en cada fila.
                        Picker("Asignatura", selection: $model.subjectFilter) {
                            Text("Todas las asignaturas").tag(DeadlineSubjectKey?.none)
                            ForEach(model.subjectOptions) { option in
                                Text(option.label).tag(DeadlineSubjectKey?.some(option))
                            }
                        }
                    } label: {
                        FilterChipLabel(
                            title: model.subjectFilter?.label ?? "Asignatura",
                            systemImage: "book.closed",
                            isActive: model.subjectFilter != nil
                        )
                    }
                }

                if !model.tagOptions.isEmpty {
                    Menu {
                        Picker("Etiqueta", selection: $model.tagFilter) {
                            Text("Todas las etiquetas").tag(String?.none)
                            ForEach(model.tagOptions) { tag in
                                Text(tag.label).tag(String?.some(tag.id))
                            }
                        }
                    } label: {
                        FilterChipLabel(
                            title: currentTagLabel ?? "Etiqueta",
                            systemImage: "tag",
                            isActive: model.tagFilter != nil
                        )
                    }
                }

                Button {
                    model.hidePast.toggle()
                } label: {
                    FilterChipLabel(
                        title: "Ocultar pasadas",
                        systemImage: model.hidePast ? "eye.slash.fill" : "eye.slash",
                        isActive: model.hidePast
                    )
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(model.hidePast ? .isSelected : [])

                if model.activeFilterCount > 0 {
                    Button("Quitar filtros") { model.clearFilters() }
                        .font(AppFont.pill)
                        .foregroundStyle(ThemeColor(.inkMuted))
                        .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, AppSpacing.lg)
        }
    }

    private var currentTagLabel: String? {
        guard let id = model.tagFilter else { return nil }
        return model.tagRegistry.first { $0.id == id }?.label
    }

    // MARK: Contenido

    @ViewBuilder
    private var content: some View {
        if !model.hasLoaded {
            VStack {
                Spacer()
                ProgressView()
                Spacer()
            }
            .frame(maxWidth: .infinity)
        } else if model.filtered.isEmpty {
            ScrollView {
                EmptyState(
                    systemImage: model.items.isEmpty ? "calendar.badge.plus" : "line.3.horizontal.decrease",
                    title: model.items.isEmpty ? "Sin fechas guardadas" : "Ningún resultado",
                    message: model.items.isEmpty
                        ? "Añade exámenes, entregas y otros deadlines. Aparecerán también en el calendario."
                        : "Ninguna fecha coincide con estos filtros.",
                    actionTitle: model.items.isEmpty ? "Añadir la primera" : "Quitar filtros",
                    action: {
                        if model.items.isEmpty {
                            editorTarget = .create
                        } else {
                            model.clearFilters()
                        }
                    }
                )
                .padding(.top, AppSpacing.xl)
            }
            .refreshable { await SyncStore.shared.refresh() }
        } else {
            list
        }
    }

    private var list: some View {
        List {
            ForEach(model.filtered) { deadline in
                DeadlineRow(
                    deadline: deadline,
                    subject: subjectLabel(for: deadline),
                    tags: model.resolvedTags(for: deadline),
                    onPickColor: { colorId in
                        Task { await model.setColor(colorId, for: deadline.id) }
                    }
                )
                .contentShape(RoundedRectangle(cornerRadius: AppRadius.small, style: .continuous))
                .onTapGesture { editorTarget = .edit(deadline) }
                .listRowInsets(EdgeInsets(
                    top: AppSpacing.xs,
                    leading: AppSpacing.lg,
                    bottom: AppSpacing.xs,
                    trailing: AppSpacing.lg
                ))
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button(role: .destructive) {
                        pendingDeletion = deadline
                    } label: {
                        Label("Eliminar", systemImage: "trash")
                    }
                    Button {
                        editorTarget = .edit(deadline)
                    } label: {
                        Label("Editar", systemImage: "pencil")
                    }
                    .tint(.gray)
                }
                .contextMenu {
                    Button("Editar", systemImage: "pencil") { editorTarget = .edit(deadline) }
                    Menu("Color", systemImage: "paintpalette") {
                        ForEach(EventColors.deadlineIds, id: \.self) { colorId in
                            Button {
                                Task { await model.setColor(colorId, for: deadline.id) }
                            } label: {
                                if EventColors.normalize(deadline.calendarColorId) == colorId {
                                    Label(EventColors.label(for: colorId), systemImage: "checkmark")
                                } else {
                                    Text(EventColors.label(for: colorId))
                                }
                            }
                        }
                    }
                    Button("Eliminar", systemImage: "trash", role: .destructive) {
                        pendingDeletion = deadline
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .environment(\.defaultMinListRowHeight, 0)
        .refreshable { await SyncStore.shared.refresh() }
    }

    private func subjectLabel(for deadline: ImportantDeadline) -> String? {
        switch DeadlineSubjectKey.of(deadline) {
        case .subject(let value): value
        case .course(let value): DeadlineSubjectKey.course(value).label
        case .unassigned: nil
        }
    }
}

// MARK: - Fila

private struct DeadlineRow: View {

    let deadline: ImportantDeadline
    let subject: String?
    let tags: [DeadlineTag]
    let onPickColor: (String) -> Void

    @Environment(\.appPalette) private var palette

    var body: some View {
        let style = EventColors.style(for: deadline.calendarColorId, palette: palette)

        Card(padding: AppSpacing.md, radius: AppRadius.small) {
            HStack(alignment: .top, spacing: AppSpacing.md) {
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(style.borderLeft)
                    .frame(width: AppMetrics.accentBar)
                    .frame(maxHeight: .infinity)

                VStack(alignment: .leading, spacing: AppSpacing.sm) {
                    HStack(alignment: .firstTextBaseline, spacing: AppSpacing.sm) {
                        Text(deadline.title.isEmpty ? "Sin título" : deadline.title)
                            .font(AppFont.cardTitle)
                            .foregroundStyle(ThemeColor(.ink))
                            .lineLimit(2)
                        Spacer(minLength: AppSpacing.xs)
                        if let relative = DeadlineFormat.relativeLabel(for: deadline) {
                            Pill(relative, style: deadline.isToday ? .solid : .neutral)
                                .opacity(deadline.isPast ? 0.6 : 1)
                        }
                    }

                    Text(DeadlineFormat.summaryLine(for: deadline, subject: subject))
                        .font(AppFont.body)
                        .foregroundStyle(ThemeColor(.inkMuted))
                        .lineLimit(2)

                    if !tags.isEmpty {
                        // `Layout` propio sería lo ideal, pero para 2-3 etiquetas
                        // el scroll horizontal evita romper la altura de la fila.
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: AppSpacing.xs) {
                                ForEach(tags) { tag in
                                    Pill(tag.label, systemImage: "tag.fill", style: .neutral)
                                }
                            }
                        }
                    }
                }

                colorMenu(style: style)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func colorMenu(style: EventColorStyle) -> some View {
        Menu {
            ForEach(EventColors.deadlineIds, id: \.self) { colorId in
                Button {
                    onPickColor(colorId)
                } label: {
                    if EventColors.normalize(deadline.calendarColorId) == colorId {
                        Label(EventColors.label(for: colorId), systemImage: "checkmark")
                    } else {
                        Text(EventColors.label(for: colorId))
                    }
                }
            }
        } label: {
            Circle()
                .fill(style.borderLeft)
                .frame(width: 18, height: 18)
                .overlay {
                    Circle().strokeBorder(ThemeColor(.border), lineWidth: AppMetrics.hairline)
                }
                // Área táctil de 44pt sin agrandar el punto de color.
                .frame(width: 44, height: 44, alignment: .center)
                .contentShape(Rectangle())
        }
        .accessibilityLabel("Color: \(EventColors.label(for: deadline.calendarColorId))")
    }
}

// MARK: - Chip de filtro

private struct FilterChipLabel: View {
    let title: String
    let systemImage: String
    let isActive: Bool

    @Environment(\.appPalette) private var palette

    var body: some View {
        HStack(spacing: AppSpacing.xs) {
            Image(systemName: systemImage)
                .font(.system(size: 11, weight: .semibold))
            Text(title)
                .font(AppFont.pill)
                .lineLimit(1)
        }
        .padding(.horizontal, AppSpacing.md)
        .padding(.vertical, AppSpacing.sm)
        .foregroundStyle(isActive ? palette.onAccent : palette.ink)
        .background(
            Capsule(style: .continuous)
                .fill(isActive ? palette.accent : palette.surface)
        )
        .overlay {
            Capsule(style: .continuous)
                .strokeBorder(isActive ? Color.clear : palette.border, lineWidth: AppMetrics.hairline)
        }
        .fixedSize(horizontal: true, vertical: false)
    }
}

// MARK: - Destino del editor

private enum DeadlineEditorTarget: Identifiable {
    case create
    case edit(ImportantDeadline)

    var id: String {
        switch self {
        case .create: "__nuevo__"
        case .edit(let deadline): deadline.id
        }
    }

    var deadline: ImportantDeadline? {
        switch self {
        case .create: nil
        case .edit(let deadline): deadline
        }
    }
}

// MARK: - Editor

private struct DeadlineEditor: View {

    @ObservedObject var model: DeadlinesModel
    let existing: ImportantDeadline?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.appPalette) private var palette

    @State private var title: String
    @State private var day: Date
    @State private var hasTime: Bool
    @State private var timeOfDay: Date
    @State private var subject: String
    @State private var tagIds: [String]
    @State private var colorId: String
    @State private var newTagDraft = ""
    @State private var confirmDelete = false
    @FocusState private var titleFocused: Bool

    init(model: DeadlinesModel, existing: ImportantDeadline?) {
        _model = ObservedObject(wrappedValue: model)
        self.existing = existing
        _title = State(initialValue: existing?.title ?? "")
        _day = State(initialValue: existing?.dayStart ?? Calendar.current.startOfDay(for: Date()))
        _hasTime = State(initialValue: existing?.time != nil)
        _timeOfDay = State(initialValue: existing?.startDate ?? DeadlineEditor.defaultTime())
        _subject = State(initialValue: existing?.subject ?? "")
        _tagIds = State(initialValue: existing?.tagIds ?? [])
        _colorId = State(initialValue: existing?.calendarColorId ?? EventColors.defaultDeadlineColorId)
    }

    /// Hora por defecto de un evento nuevo: 9:00 del día en curso.
    private static func defaultTime() -> Date {
        Calendar.current.date(
            bySettingHour: 9, minute: 0, second: 0, of: Date()
        ) ?? Date()
    }

    private var canSave: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: AppSpacing.xl) {
                    titleField
                    dateFields
                    subjectField
                    tagsField
                    colorField
                    if existing != nil { deleteButton }
                }
                .padding(AppSpacing.lg)
            }
            .canvasBackground()
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(existing == nil ? "Nueva fecha" : "Editar fecha")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Guardar") { save() }
                        .fontWeight(.semibold)
                        .disabled(!canSave)
                }
            }
            .confirmationDialog(
                "¿Eliminar esta fecha?",
                isPresented: $confirmDelete,
                titleVisibility: .visible
            ) {
                Button("Eliminar", role: .destructive) {
                    guard let existing else { return }
                    Task { await model.delete(id: existing.id) }
                    dismiss()
                }
                Button("Cancelar", role: .cancel) {}
            }
        }
        .studyOSTheme()
        .onAppear {
            // Solo al crear: al editar, el foco automático tapa el formulario
            // con el teclado antes de que se vea qué se está editando.
            if existing == nil { titleFocused = true }
        }
    }

    // MARK: Campos

    private var titleField: some View {
        VStack(alignment: .leading, spacing: AppSpacing.sm) {
            FieldLabel("Título")
            FieldShell {
                TextField("Ej. Examen parcial, Entrega TPC…", text: $title)
                    .font(AppFont.body)
                    .foregroundStyle(ThemeColor(.ink))
                    .textInputAutocapitalization(.sentences)
                    .submitLabel(.done)
                    .focused($titleFocused)
            }
        }
    }

    private var dateFields: some View {
        VStack(alignment: .leading, spacing: AppSpacing.sm) {
            FieldLabel("Fecha")
            FieldShell {
                DatePicker("Fecha", selection: $day, displayedComponents: .date)
                    .datePickerStyle(.compact)
                    .labelsHidden()
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Toggle(isOn: $hasTime) {
                Text("Con hora")
                    .font(AppFont.body)
                    .foregroundStyle(ThemeColor(.ink))
            }
            .padding(.top, AppSpacing.xs)

            if hasTime {
                FieldShell {
                    DatePicker("Hora", selection: $timeOfDay, displayedComponents: .hourAndMinute)
                        .datePickerStyle(.compact)
                        .labelsHidden()
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    private var subjectField: some View {
        VStack(alignment: .leading, spacing: AppSpacing.sm) {
            HStack {
                FieldLabel("Asignatura")
                Spacer()
                if !model.subjectSuggestions.isEmpty {
                    Menu {
                        Button("Sin asignatura") { subject = "" }
                        ForEach(model.subjectSuggestions, id: \.self) { name in
                            Button(name) { subject = name }
                        }
                    } label: {
                        Label("Usar existente", systemImage: "chevron.down")
                            .font(AppFont.caption)
                            .foregroundStyle(ThemeColor(.inkMuted))
                    }
                }
            }
            FieldShell {
                // Se edita `subject` y no `courseId`: el registro de cursos no
                // se sincroniza, así que aquí un id de curso no diría nada.
                TextField("Sin asignatura", text: $subject)
                    .font(AppFont.body)
                    .foregroundStyle(ThemeColor(.ink))
                    .textInputAutocapitalization(.words)
            }
        }
    }

    private var tagsField: some View {
        VStack(alignment: .leading, spacing: AppSpacing.sm) {
            FieldLabel("Etiquetas")

            FieldShell {
                HStack(spacing: AppSpacing.sm) {
                    TextField("Crear nueva etiqueta…", text: $newTagDraft)
                        .font(AppFont.body)
                        .foregroundStyle(ThemeColor(.ink))
                        .submitLabel(.done)
                        .onSubmit { commitNewTag() }
                    Button("Añadir", action: commitNewTag)
                        .font(AppFont.pill)
                        .buttonStyle(.plain)
                        .foregroundStyle(ThemeColor(.ink))
                        .disabled(DeadlinesModel.normalizeTagLabel(newTagDraft).isEmpty)
                }
            }

            if model.sortedTagRegistry.isEmpty {
                Text("Aún no hay etiquetas. Escribe arriba y pulsa Añadir para crear la primera.")
                    .font(AppFont.caption)
                    .foregroundStyle(ThemeColor(.inkFaint))
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(model.sortedTagRegistry.enumerated()), id: \.element.id) { index, tag in
                        if index > 0 { Hairline() }
                        Button {
                            toggle(tag.id)
                        } label: {
                            HStack {
                                Text(tag.label)
                                    .font(AppFont.body)
                                    .foregroundStyle(ThemeColor(.ink))
                                Spacer()
                                if tagIds.contains(tag.id) {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(ThemeColor(.ink))
                                }
                            }
                            .padding(.horizontal, AppSpacing.md)
                            .padding(.vertical, 10)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .background(
                    RoundedRectangle(cornerRadius: AppRadius.small, style: .continuous)
                        .fill(ThemeColor(.surface))
                )
                .overlay {
                    RoundedRectangle(cornerRadius: AppRadius.small, style: .continuous)
                        .strokeBorder(ThemeColor(.border), lineWidth: AppMetrics.hairline)
                }
            }
        }
    }

    private var colorField: some View {
        VStack(alignment: .leading, spacing: AppSpacing.sm) {
            FieldLabel("Color en el calendario")
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 44), spacing: AppSpacing.sm)],
                spacing: AppSpacing.sm
            ) {
                ForEach(EventColors.deadlineIds, id: \.self) { id in
                    let selected = EventColors.normalize(colorId) == id
                    Button {
                        colorId = id
                    } label: {
                        Circle()
                            .fill(EventColors.swatch(for: id, palette: palette))
                            .frame(width: 28, height: 28)
                            .padding(4)
                            .overlay {
                                // Anillo en vez de check: sobre los tonos claros
                                // (lima, aguamarina) una marca blanca no se ve.
                                Circle().strokeBorder(
                                    selected ? palette.ink : Color.clear,
                                    lineWidth: 2
                                )
                            }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(EventColors.label(for: id))
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
            Text(EventColors.label(for: colorId))
                .font(AppFont.caption)
                .foregroundStyle(ThemeColor(.inkMuted))
        }
    }

    private var deleteButton: some View {
        Button(role: .destructive) {
            confirmDelete = true
        } label: {
            Label("Eliminar fecha", systemImage: "trash")
                .font(AppFont.body)
                .frame(maxWidth: .infinity)
                .padding(.vertical, AppSpacing.md)
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.red)
        .background(
            RoundedRectangle(cornerRadius: AppRadius.small, style: .continuous)
                .fill(ThemeColor(.surface))
        )
        .overlay {
            RoundedRectangle(cornerRadius: AppRadius.small, style: .continuous)
                .strokeBorder(ThemeColor(.border), lineWidth: AppMetrics.hairline)
        }
    }

    // MARK: Acciones

    private func toggle(_ tagId: String) {
        if let index = tagIds.firstIndex(of: tagId) {
            tagIds.remove(at: index)
        } else {
            tagIds.append(tagId)
        }
    }

    private func commitNewTag() {
        let draft = newTagDraft
        newTagDraft = ""
        Task {
            guard let tag = await model.findOrCreateTag(draft) else { return }
            if !tagIds.contains(tag.id) { tagIds.append(tag.id) }
        }
    }

    private func save() {
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanTitle.isEmpty else { return }
        let cleanSubject = subject.trimmingCharacters(in: .whitespacesAndNewlines)
        // Una etiqueta borrada en otro dispositivo dejaría un id colgando.
        let known = Set(model.tagRegistry.map(\.id))

        var next = existing ?? ImportantDeadline(
            id: UUID().uuidString.lowercased(),
            title: cleanTitle,
            date: DeadlineFormat.ymd(day),
            createdAt: DeadlineFormat.isoNow()
        )
        next.title = cleanTitle
        next.date = DeadlineFormat.ymd(day)
        next.time = hasTime ? DeadlineFormat.hhmm(timeOfDay) : nil
        next.subject = cleanSubject.isEmpty ? nil : cleanSubject
        next.tagIds = tagIds.filter { known.contains($0) }
        next.calendarColorId = EventColors.normalize(colorId)

        Task { await model.save(next) }
        dismiss()
    }
}

// MARK: - Piezas de formulario

private struct FieldLabel: View {
    private let text: String

    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .semibold))
            .textCase(.uppercase)
            .kerning(0.8)
            .foregroundStyle(ThemeColor(.inkMuted))
    }
}

/// Marco de los campos: fondo lienzo y trazo fino, como los `input` de la web.
private struct FieldShell<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) { self.content = content() }

    var body: some View {
        content
            .padding(.horizontal, AppSpacing.md)
            .padding(.vertical, 10)
            .frame(minHeight: 44)
            .background(
                RoundedRectangle(cornerRadius: AppRadius.small, style: .continuous)
                    .fill(ThemeColor(.canvas))
            )
            .overlay {
                RoundedRectangle(cornerRadius: AppRadius.small, style: .continuous)
                    .strokeBorder(ThemeColor(.border), lineWidth: AppMetrics.hairline)
            }
    }
}

// MARK: - Previews

#Preview("Exámenes — claro") {
    NavigationStack { DeadlinesView() }
        .preferredColorScheme(.light)
}

#Preview("Exámenes — oscuro") {
    NavigationStack { DeadlinesView() }
        .preferredColorScheme(.dark)
}
