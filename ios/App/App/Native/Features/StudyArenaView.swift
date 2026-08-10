import Combine
import SwiftUI

// MARK: - Constantes de la arena

/// Umbrales copiados de `StudyArenaProvider.tsx`. Van fuera del modelo porque
/// los modelos de datos (no aislados) también los necesitan.
enum ArenaRules {
    static let focusScoreStart: Double = 100
    static let focusScorePerDistraction: Double = 10
    /// Por debajo de 5 minutos la web pregunta si la sesión fue real.
    static let tooShortMs: Double = 5 * 60 * 1000
    /// Dos horas sin tocar nada: se pausa y se pregunta.
    static let noInteractionMs: Double = 2 * 60 * 60 * 1000
}

// MARK: - Sesión ofertada

/// Equivale a `StudyArenaSessionOption` de `StudyArenaProvider.tsx`: una sesión
/// del plan que hoy se puede arrancar.
struct ArenaSessionOption: Codable, Identifiable, Sendable, Hashable {
    /// `"<planId>::<YYYY-MM-DD>"`, tal cual la construye la web.
    var key: String
    var planId: String
    var planTitle: String
    var date: String
    var studyHours: Double
    var focus: String
    var sessionTitle: String?

    var id: String { key }

    var displayTitle: String {
        let trimmed = sessionTitle?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? "Sesión de estudio" : trimmed
    }

    /// Duración objetivo en milisegundos. Mínimo 1 ms para no dividir por cero
    /// al calcular el progreso.
    var totalDurationMs: Double { max(1, (studyHours * 3_600_000).rounded()) }
}

// MARK: - Sesión activa

/// Espejo de `StudyArenaActiveSession`. Vive dentro de
/// `iestudio-study-arena-state`, bajo la clave `activeSession`.
struct ArenaActiveSession: Codable, Sendable, Hashable {
    var key: String
    var planId: String
    var planTitle: String
    var date: String
    var studyHours: Double
    var focus: String
    var sessionTitle: String?

    var arenaRunId: String
    var totalDurationMs: Double
    var startedAtMs: Double
    /// Tiempo activo ya consolidado; excluye pausas.
    var elapsedActiveMs: Double
    /// Inicio del tramo en marcha. `nil` = pausada.
    var segmentStartMs: Double?
    var paused: Bool
    var distractionCount: Int
    var focusScore: Double
    var lastInteractionMs: Double

    private enum CodingKeys: String, CodingKey {
        case key, planId, planTitle, date, studyHours, focus, sessionTitle
        case arenaRunId, totalDurationMs, startedAtMs, elapsedActiveMs
        case segmentStartMs, paused, distractionCount, focusScore, lastInteractionMs
    }

    init(option: ArenaSessionOption, nowMs: Double) {
        key = option.key
        planId = option.planId
        planTitle = option.planTitle
        date = option.date
        studyHours = option.studyHours
        focus = option.focus
        sessionTitle = option.sessionTitle
        arenaRunId = ArenaClock.newRunId()
        totalDurationMs = option.totalDurationMs
        startedAtMs = nowMs
        elapsedActiveMs = 0
        segmentStartMs = nowMs
        paused = false
        distractionCount = 0
        focusScore = ArenaRules.focusScoreStart
        lastInteractionMs = nowMs
    }

    /// Réplica de `toActiveSession`: si falta cualquiera de los campos que la web
    /// exige, lanza y quien decodifica trata la sesión como inexistente.
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = try c.decode(String.self, forKey: .key)
        planId = try c.decode(String.self, forKey: .planId)
        planTitle = try c.decode(String.self, forKey: .planTitle)
        date = try c.decode(String.self, forKey: .date)
        studyHours = try ArenaNumber.finite(c.decode(Double.self, forKey: .studyHours))
        arenaRunId = try c.decode(String.self, forKey: .arenaRunId)
        totalDurationMs = try ArenaNumber.finite(c.decode(Double.self, forKey: .totalDurationMs))
        startedAtMs = try ArenaNumber.finite(c.decode(Double.self, forKey: .startedAtMs))
        elapsedActiveMs = try ArenaNumber.finite(c.decode(Double.self, forKey: .elapsedActiveMs))

        focus = c.lenientString(.focus) ?? ""
        let rawTitle = c.lenientString(.sessionTitle)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        sessionTitle = (rawTitle?.isEmpty ?? true) ? nil : rawTitle

        segmentStartMs = c.lenientNumber(.segmentStartMs)
        paused = c.lenientBool(.paused) ?? false
        distractionCount = max(0, Int(c.lenientNumber(.distractionCount) ?? 0))
        focusScore = min(100, max(0, c.lenientNumber(.focusScore) ?? ArenaRules.focusScoreStart))
        lastInteractionMs = c.lenientNumber(.lastInteractionMs) ?? ArenaClock.nowMs()
    }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(key, forKey: .key)
        try c.encode(planId, forKey: .planId)
        try c.encode(planTitle, forKey: .planTitle)
        try c.encode(date, forKey: .date)
        try c.encode(studyHours, forKey: .studyHours)
        try c.encode(focus, forKey: .focus)
        try c.encodeIfPresent(sessionTitle, forKey: .sessionTitle)
        try c.encode(arenaRunId, forKey: .arenaRunId)
        try c.encode(totalDurationMs, forKey: .totalDurationMs)
        try c.encode(startedAtMs, forKey: .startedAtMs)
        try c.encode(elapsedActiveMs, forKey: .elapsedActiveMs)
        // La web distingue `null` (pausada) de ausente: se escribe siempre.
        try c.encode(segmentStartMs, forKey: .segmentStartMs)
        try c.encode(paused, forKey: .paused)
        try c.encode(distractionCount, forKey: .distractionCount)
        try c.encode(focusScore, forKey: .focusScore)
        try c.encode(lastInteractionMs, forKey: .lastInteractionMs)
    }

    var displayTitle: String {
        let trimmed = sessionTitle?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? "Sesión de estudio" : trimmed
    }

    var option: ArenaSessionOption {
        ArenaSessionOption(
            key: key,
            planId: planId,
            planTitle: planTitle,
            date: date,
            studyHours: studyHours,
            focus: focus,
            sessionTitle: sessionTitle
        )
    }

    func elapsedActive(at nowMs: Double) -> Double {
        guard !paused, let start = segmentStartMs else { return elapsedActiveMs }
        return elapsedActiveMs + max(0, nowMs - start)
    }

    func remaining(at nowMs: Double) -> Double {
        max(0, totalDurationMs - elapsedActive(at: nowMs))
    }

    func progress(at nowMs: Double) -> Double {
        min(1, max(0, elapsedActive(at: nowMs) / max(1, totalDurationMs)))
    }

    /// Congela el tiempo del tramo en curso y deja la sesión en pausa.
    /// No se llama `paused(at:)` porque chocaría con la propiedad `paused`.
    func pausing(at nowMs: Double, bumpInteraction: Bool) -> ArenaActiveSession {
        var copy = self
        copy.elapsedActiveMs = elapsedActive(at: nowMs)
        copy.paused = true
        copy.segmentStartMs = nil
        if bumpInteraction { copy.lastInteractionMs = nowMs }
        return copy
    }

    func resumed(at nowMs: Double) -> ArenaActiveSession {
        var copy = self
        copy.paused = false
        copy.segmentStartMs = nowMs
        copy.lastInteractionMs = nowMs
        return copy
    }

    /// Vuelve a empezar el mismo objetivo con un run nuevo: el anterior queda
    /// descartado y sus notas del Parking Lot no se mezclan con las nuevas.
    func restarted(at nowMs: Double) -> ArenaActiveSession {
        var copy = self
        copy.arenaRunId = ArenaClock.newRunId()
        copy.paused = false
        copy.segmentStartMs = nowMs
        copy.startedAtMs = nowMs
        copy.elapsedActiveMs = 0
        copy.distractionCount = 0
        copy.focusScore = ArenaRules.focusScoreStart
        copy.lastInteractionMs = nowMs
        return copy
    }
}

// MARK: - Aviso de sesión falsa

/// `FalseSessionPrompt` de la web: sesión sospechosamente corta o abandonada.
struct ArenaFalsePrompt: Codable, Sendable, Hashable {
    enum Reason: String, Codable, Sendable {
        case tooShort = "too_short"
        case tooLong = "too_long"
    }

    enum Mode: String, Codable, Sendable {
        case active
        case ended
    }

    var reason: Reason
    var mode: Mode
}

// MARK: - Estado persistido

/// Contenido completo de `iestudio-study-arena-state`.
struct ArenaStoredState: Codable, Sendable {
    var activeSession: ArenaActiveSession?
    var falseSessionPrompt: ArenaFalsePrompt?
    var suppressFloatingWidget: Bool
    /// `_updatedAt`: el servidor lo usa para elegir versión cuando dos
    /// dispositivos discrepan. Sin él, un móvil dormido puede pisar la sesión
    /// activa del otro.
    var updatedAtMs: Double

    private enum CodingKeys: String, CodingKey {
        case activeSession, falseSessionPrompt, suppressFloatingWidget
        case updatedAtMs = "_updatedAt"
    }

    init(
        activeSession: ArenaActiveSession? = nil,
        falseSessionPrompt: ArenaFalsePrompt? = nil,
        suppressFloatingWidget: Bool = false,
        updatedAtMs: Double = 0
    ) {
        self.activeSession = activeSession
        self.falseSessionPrompt = falseSessionPrompt
        self.suppressFloatingWidget = suppressFloatingWidget
        self.updatedAtMs = updatedAtMs
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // Una sesión mal formada equivale a «no hay sesión», nunca a error.
        activeSession = (try? c.decodeIfPresent(ArenaActiveSession.self, forKey: .activeSession)) ?? nil
        falseSessionPrompt = (try? c.decodeIfPresent(ArenaFalsePrompt.self, forKey: .falseSessionPrompt)) ?? nil
        suppressFloatingWidget = ((try? c.decodeIfPresent(Bool.self, forKey: .suppressFloatingWidget)) ?? nil) ?? false
        let raw = (try? c.decodeIfPresent(Double.self, forKey: .updatedAtMs)) ?? nil
        updatedAtMs = (raw?.isFinite ?? false) ? (raw ?? 0) : 0
    }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(activeSession, forKey: .activeSession)
        try c.encode(falseSessionPrompt, forKey: .falseSessionPrompt)
        try c.encode(suppressFloatingWidget, forKey: .suppressFloatingWidget)
        try c.encode(updatedAtMs, forKey: .updatedAtMs)
    }
}

// MARK: - Modelo

@MainActor
final class StudyArenaModel: ObservableObject {

    @Published private(set) var active: ArenaActiveSession?
    @Published private(set) var prompt: ArenaFalsePrompt?
    @Published private(set) var options: [ArenaSessionOption] = []
    @Published private(set) var completed: [CompletedSession] = []
    @Published private(set) var isLoaded = false
    /// Reloj de la vista. Se refresca cada 500 ms mientras haya sesión.
    @Published private(set) var nowMs: Double = ArenaClock.nowMs()

    private var suppressFloatingWidget = false
    /// `_updatedAt` del último estado que hemos aplicado o escrito. Sirve para
    /// descartar versiones más viejas que llegan de la nube.
    private var appliedUpdatedAtMs: Double = 0
    private var ticker: Task<Void, Never>?
    private var observer: Task<Void, Never>?
    /// Evita que dos finalizaciones simultáneas (temporizador + botón) guarden
    /// dos veces el mismo run.
    private var finalizing = false

    let todayYMD = ArenaClock.ymd(of: Date())

    // MARK: Derivados

    var elapsedActiveMs: Double { active?.elapsedActive(at: nowMs) ?? 0 }
    var remainingMs: Double { active?.remaining(at: nowMs) ?? 0 }
    var progress: Double { active?.progress(at: nowMs) ?? 0 }
    var focusScore: Int { Int((active?.focusScore ?? ArenaRules.focusScoreStart).rounded()) }
    var distractionCount: Int { active?.distractionCount ?? 0 }
    var isPaused: Bool { active?.paused ?? false }

    /// Sesiones de hoy que aún no se han completado.
    var pendingOptions: [ArenaSessionOption] {
        let doneToday = Set(completed.filter { $0.date == todayYMD }.map(\.key))
        return options.filter { !doneToday.contains($0.key) }
    }

    // MARK: Ciclo de vida

    func onAppear() async {
        if observer == nil { observe() }
        await reloadAll()
        isLoaded = true
        syncTicker()
    }

    func onDisappear() {
        ticker?.cancel()
        ticker = nil
    }

    private func observe() {
        observer = Task { [weak self] in
            for await keys in SyncBus.shared.changes() {
                guard let self else { return }
                let all = keys.contains("*")
                if all || keys.contains(StorageKeys.studyPlans) {
                    await self.reloadOptions()
                }
                if all
                    || keys.contains(StorageKeys.studyArenaCompleted)
                    || keys.contains(StorageKeys.studyArenaCompletedDeleted) {
                    await self.reloadCompleted()
                }
                if all || keys.contains(StorageKeys.studyArenaState) {
                    await self.reloadArenaState()
                    self.syncTicker()
                }
            }
        }
    }

    private func reloadAll() async {
        await reloadArenaState()
        await reloadOptions()
        await reloadCompleted()
    }

    /// Arranca o para el reloj según haya sesión. Un `Task` en vez de `Timer`
    /// para que se cancele solo al salir de la pantalla.
    private func syncTicker() {
        if active == nil {
            ticker?.cancel()
            ticker = nil
            return
        }
        guard ticker == nil else { return }
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(500))
                guard !Task.isCancelled, let self else { return }
                self.nowMs = ArenaClock.nowMs()
                self.evaluateAutomatics()
            }
        }
    }

    // MARK: Carga

    private func reloadArenaState() async {
        guard let stored = await SyncStore.shared.decoded(
            ArenaStoredState.self, forKey: StorageKeys.studyArenaState
        ) else { return }
        // Lo que llega de la nube solo gana si es igual o más reciente que lo
        // último que aplicamos: si no, un GET a media sesión la retrocedería.
        guard stored.updatedAtMs >= appliedUpdatedAtMs else { return }
        appliedUpdatedAtMs = stored.updatedAtMs
        active = stored.activeSession
        prompt = stored.falseSessionPrompt
        suppressFloatingWidget = stored.suppressFloatingWidget
    }

    private func reloadOptions() async {
        let plans = await SyncStore.shared.decoded(
            ArenaPlanList.self, forKey: StorageKeys.studyPlans
        ) ?? ArenaPlanList()
        options = plans.todayOptions(today: todayYMD)
    }

    private func reloadCompleted() async {
        let (raw, deleted) = await Self.loadCompletedRaw()
        completed = CompletedSession.visible(raw: raw, deleted: deleted)
    }

    private static func loadCompletedRaw() async -> ([CompletedSession], Set<String>) {
        let list = await SyncStore.shared.decoded(
            CompletedSessionList.self, forKey: CompletedSession.storageKey
        ) ?? CompletedSessionList()
        let tombs = await SyncStore.shared.decoded(
            CompletedSessionTombstones.self, forKey: CompletedSession.deletedStorageKey
        ) ?? CompletedSessionTombstones()
        return (list.items, tombs.ids)
    }

    // MARK: Escritura del estado

    private func persistArenaState() {
        let stamp = ArenaClock.nowMs()
        appliedUpdatedAtMs = stamp
        let state = ArenaStoredState(
            activeSession: active,
            falseSessionPrompt: prompt,
            suppressFloatingWidget: suppressFloatingWidget,
            updatedAtMs: stamp
        )
        Task { await SyncStore.shared.encode(state, forKey: StorageKeys.studyArenaState) }
    }

    // MARK: Acciones

    func start(_ option: ArenaSessionOption) {
        let now = ArenaClock.nowMs()
        nowMs = now
        prompt = nil
        active = ArenaActiveSession(option: option, nowMs: now)
        persistArenaState()
        syncTicker()
    }

    func togglePause() {
        guard prompt == nil, let current = active else { return }
        let now = ArenaClock.nowMs()
        nowMs = now
        active = current.paused ? current.resumed(at: now) : current.pausing(at: now, bumpInteraction: true)
        persistArenaState()
    }

    func addDistraction() {
        guard prompt == nil, let current = active else { return }
        var next = current
        next.distractionCount += 1
        next.focusScore = min(100, max(0, current.focusScore - ArenaRules.focusScorePerDistraction))
        next.lastInteractionMs = ArenaClock.nowMs()
        active = next
        persistArenaState()
    }

    /// Termina a petición del usuario. La sesión se guarda siempre; si fue muy
    /// corta se deja el aviso abierto para que confirme o la reinicie.
    func finalize() {
        guard prompt == nil, let current = active, !finalizing else { return }
        finalizing = true
        defer { finalizing = false }

        let now = ArenaClock.nowMs()
        nowMs = now
        let elapsed = current.elapsedActive(at: now)
        let short = elapsed < ArenaRules.tooShortMs

        saveCompleted(from: current, elapsedMs: elapsed)

        if short {
            var frozen = current.pausing(at: now, bumpInteraction: false)
            frozen.elapsedActiveMs = current.totalDurationMs
            active = frozen
            prompt = ArenaFalsePrompt(reason: .tooShort, mode: .ended)
        } else {
            active = nil
            prompt = nil
        }
        persistArenaState()
        syncTicker()
    }

    /// Cierra el aviso: en modo `active` reanuda, en modo `ended` cierra la sesión.
    func confirmPrompt() {
        guard let current = prompt else { return }
        let now = ArenaClock.nowMs()
        nowMs = now
        prompt = nil
        if current.mode == .active {
            active = active?.resumed(at: now)
        } else {
            active = nil
        }
        persistArenaState()
        syncTicker()
    }

    func restartFromPrompt() {
        let now = ArenaClock.nowMs()
        nowMs = now
        prompt = nil
        active = active?.restarted(at: now)
        persistArenaState()
        syncTicker()
    }

    /// Detección automática igual que en la web: abandono a las 2 h sin tocar
    /// nada y fin cuando el tiempo activo alcanza el objetivo.
    private func evaluateAutomatics() {
        guard prompt == nil, let current = active, !finalizing else { return }
        let now = nowMs

        if now - current.lastInteractionMs >= ArenaRules.noInteractionMs {
            active = current.pausing(at: now, bumpInteraction: false)
            prompt = ArenaFalsePrompt(reason: .tooLong, mode: .active)
            persistArenaState()
            return
        }

        let elapsed = current.elapsedActive(at: now)
        guard elapsed >= current.totalDurationMs else { return }

        finalizing = true
        defer { finalizing = false }

        if elapsed < ArenaRules.tooShortMs {
            var frozen = current.pausing(at: now, bumpInteraction: false)
            frozen.elapsedActiveMs = current.totalDurationMs
            active = frozen
            prompt = ArenaFalsePrompt(reason: .tooShort, mode: .ended)
        } else {
            saveCompleted(from: current, elapsedMs: elapsed)
            active = nil
            prompt = nil
        }
        persistArenaState()
        syncTicker()
    }

    // MARK: Historial

    private func saveCompleted(from session: ArenaActiveSession, elapsedMs: Double) {
        let record = CompletedSession(
            completionId: ArenaClock.newRunId(),
            completedAt: ArenaClock.isoNow(),
            arenaRunId: session.arenaRunId,
            key: session.key,
            planId: session.planId,
            planTitle: session.planTitle,
            date: session.date,
            studyHours: session.studyHours,
            focus: session.focus,
            sessionTitle: session.sessionTitle,
            focusScore: session.focusScore,
            distractionCount: session.distractionCount,
            elapsedActiveMs: elapsedMs,
            totalDurationMs: session.totalDurationMs,
            startedAtMs: session.startedAtMs
        )
        Task { [weak self] in
            var (raw, _) = await Self.loadCompletedRaw()
            // Deduplicar por run: si el otro dispositivo ya guardó esta
            // ejecución, no se añade un clon.
            guard !raw.contains(where: { $0.arenaRunId == record.arenaRunId }) else { return }
            raw.insert(record, at: 0)
            if raw.count > CompletedSession.maxStored {
                raw = Array(raw.prefix(CompletedSession.maxStored))
            }
            await SyncStore.shared.encode(
                CompletedSessionList(items: raw), forKey: CompletedSession.storageKey
            )
            await self?.reloadCompleted()
        }
    }

    /// Borra una sesión del historial.
    ///
    /// Se marcan como lápida el `completionId` **y** el `arenaRunId`: la fusión
    /// en la nube es una unión de ids, así que del mismo run pueden existir
    /// varios registros con `completionId` distinto. Marcando solo uno, los
    /// clones sobreviven y la sesión reaparece al recargar.
    func delete(_ session: CompletedSession) {
        // Optimista: la lista se actualiza antes de que vuelva el almacén.
        completed.removeAll { $0.completionId == session.completionId || $0.arenaRunId == session.arenaRunId }
        Task { [weak self] in
            let (raw, deleted) = await Self.loadCompletedRaw()
            var tombs = deleted
            tombs.insert(session.completionId)
            tombs.insert(session.arenaRunId)
            let remaining = raw.filter {
                $0.completionId != session.completionId && $0.arenaRunId != session.arenaRunId
            }
            await SyncStore.shared.encode(
                CompletedSessionTombstones(ids: tombs), forKey: CompletedSession.deletedStorageKey
            )
            await SyncStore.shared.encode(
                CompletedSessionList(items: remaining), forKey: CompletedSession.storageKey
            )
            await self?.reloadCompleted()
        }
    }

    /// Repite una sesión ya completada con los mismos datos del plan.
    func redo(_ session: CompletedSession) {
        start(
            ArenaSessionOption(
                key: session.key,
                planId: session.planId,
                planTitle: session.planTitle,
                date: session.date,
                studyHours: session.studyHours,
                focus: session.focus,
                sessionTitle: session.sessionTitle
            )
        )
    }

    /// Historial agrupado por día **del plan** (no por día de finalización),
    /// igual que `CompletedSessionsSection`.
    var historyByPlanDay: [ArenaHistoryGroup] {
        var buckets: [String: [CompletedSession]] = [:]
        for session in completed {
            let day = session.date.trimmingCharacters(in: .whitespaces)
            buckets[day.isEmpty ? "—" : day, default: []].append(session)
        }
        return buckets
            .map { ArenaHistoryGroup(date: $0.key, items: $0.value.sorted { $0.completedAt > $1.completedAt }) }
            .sorted { a, b in
                if a.date == "—" { return false }
                if b.date == "—" { return true }
                return a.date > b.date
            }
    }
}

/// Un día del historial con sus sesiones.
struct ArenaHistoryGroup: Identifiable, Sendable {
    let date: String
    let items: [CompletedSession]
    var id: String { date }
}

// MARK: - Vista

struct StudyArenaView: View {

    @StateObject private var model = StudyArenaModel()
    @Environment(\.appPalette) private var palette
    @State private var detail: CompletedSession?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AppSpacing.lg) {
                header
                if model.active != nil {
                    activeSection
                } else {
                    idleSection
                }
            }
            .padding(AppSpacing.lg)
        }
        .canvasBackground()
        .sheet(item: $detail) { session in
            ArenaSessionDetailSheet(
                session: session,
                onRedo: {
                    detail = nil
                    model.redo(session)
                },
                onDelete: {
                    detail = nil
                    model.delete(session)
                }
            )
        }
        .task { await model.onAppear() }
        .onDisappear { model.onDisappear() }
        .alert(
            model.prompt?.reason == .tooShort ? "Sesión muy corta" : "¿Sigues ahí?",
            isPresented: promptIsPresented,
            presenting: model.prompt
        ) { prompt in
            Button(prompt.mode == .active ? "Reanudar" : "Aceptar") { model.confirmPrompt() }
            Button("Reiniciar", role: .cancel) { model.restartFromPrompt() }
        } message: { prompt in
            Text(prompt.reason == .tooShort
                 ? "Ha durado menos de 5 minutos. ¿La damos por buena o la repites?"
                 : "Llevas dos horas sin interactuar y la sesión está en pausa.")
        }
    }

    // MARK: Cabecera

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Study Arena")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(ThemeColor(.ink))
            Text(ArenaClock.longDayLabel(model.todayYMD))
                .font(AppFont.caption)
                .foregroundStyle(ThemeColor(.inkMuted))
        }
    }

    // MARK: Sesión en marcha

    @ViewBuilder
    private var activeSection: some View {
        if let session = model.active {
            VStack(alignment: .leading, spacing: AppSpacing.lg) {
                Card {
                    VStack(alignment: .leading, spacing: AppSpacing.md) {
                        HStack(spacing: AppSpacing.sm) {
                            Pill(session.planTitle)
                            Text(ArenaClock.hoursLabel(session.studyHours))
                                .font(AppFont.caption)
                                .foregroundStyle(ThemeColor(.inkMuted))
                            Spacer(minLength: 0)
                            VStack(alignment: .trailing, spacing: 0) {
                                Text("Focus score")
                                    .font(AppFont.caption)
                                    .foregroundStyle(ThemeColor(.inkMuted))
                                Text("\(model.focusScore)")
                                    .font(.system(size: 18, weight: .bold))
                                    .monospacedDigit()
                                    .foregroundStyle(ThemeColor(.ink))
                            }
                        }
                        Text(session.displayTitle)
                            .font(AppFont.cardTitle)
                            .foregroundStyle(ThemeColor(.ink))
                        focusScoreBar
                    }
                }

                Card {
                    VStack(spacing: AppSpacing.lg) {
                        VStack(spacing: 2) {
                            Text("Tiempo restante")
                                .font(AppFont.caption)
                                .foregroundStyle(ThemeColor(.inkMuted))
                            Text(ArenaClock.countdown(model.remainingMs))
                                .font(.system(size: 34, weight: .bold, design: .rounded))
                                .monospacedDigit()
                                .foregroundStyle(ThemeColor(.ink))
                        }
                        timerRing
                        Text(model.isPaused
                             ? "Reanuda para seguir contando el tiempo activo."
                             : "Toca el anillo para pausar.")
                            .font(AppFont.caption)
                            .foregroundStyle(ThemeColor(.inkFaint))
                    }
                    .frame(maxWidth: .infinity)
                }

                distractionCard
                focusListCard(session)

                Button(role: .destructive) { model.finalize() } label: {
                    Text("Finalizar sesión")
                        .font(.system(size: 15, weight: .bold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, AppSpacing.md)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color(hex: 0xDC2626))
                .background(
                    RoundedRectangle(cornerRadius: AppRadius.medium, style: .continuous)
                        .fill(Color(hex: 0xDC2626, opacity: palette.isDark ? 0.16 : 0.08))
                )
                .overlay {
                    RoundedRectangle(cornerRadius: AppRadius.medium, style: .continuous)
                        .strokeBorder(Color(hex: 0xDC2626, opacity: 0.35), lineWidth: AppMetrics.hairline)
                }
            }
        }
    }

    private var timerRing: some View {
        ZStack {
            Circle()
                .stroke(ThemeColor(.surfaceMuted), lineWidth: 12)
            Circle()
                .trim(from: 0, to: model.progress)
                .stroke(ThemeColor(.ink).opacity(model.isPaused ? 0.5 : 1),
                        style: StrokeStyle(lineWidth: 12, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.easeOut(duration: 0.3), value: model.progress)
            Image(systemName: model.isPaused ? "play.fill" : "pause.fill")
                .font(.system(size: 44, weight: .medium))
                .foregroundStyle(ThemeColor(.ink))
        }
        .frame(maxWidth: 240)
        .aspectRatio(1, contentMode: .fit)
        .contentShape(Circle())
        .onTapGesture { model.togglePause() }
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel(model.isPaused ? "Reanudar" : "Pausar")
    }

    /// Barra continua verde → naranja → rojo, como la de la web.
    private var focusScoreBar: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(ThemeColor(.surfaceMuted))
                Capsule()
                    .fill(ArenaClock.focusColor(Double(model.focusScore)))
                    // En 0 se deja un trocito rojo visible: una barra vacía no
                    // comunica «has perdido el foco», parece un fallo de pintado.
                    .frame(width: max(6, geo.size.width * max(0.04, Double(model.focusScore) / 100)))
                    .animation(.easeOut(duration: 0.3), value: model.focusScore)
            }
        }
        .frame(height: 10)
    }

    private var distractionCard: some View {
        Card {
            VStack(alignment: .leading, spacing: AppSpacing.sm) {
                Text("Distracciones")
                    .font(AppFont.caption)
                    .foregroundStyle(ThemeColor(.inkMuted))
                Text("Registra cuando pierdas el foco.")
                    .font(AppFont.caption)
                    .foregroundStyle(ThemeColor(.inkFaint))
                Button { model.addDistraction() } label: {
                    HStack {
                        Text("Registrar distracción")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(ThemeColor(.ink))
                        Spacer()
                        Text("\(model.distractionCount)")
                            .font(AppFont.pill)
                            .monospacedDigit()
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .foregroundStyle(Color(hex: 0x92400E))
                            .background(Capsule().fill(Color(hex: 0xFDE68A)))
                    }
                    .padding(AppSpacing.md)
                    .background(
                        RoundedRectangle(cornerRadius: AppRadius.medium, style: .continuous)
                            .fill(ThemeColor(.surfaceMuted))
                    )
                }
                .buttonStyle(.plain)
                .padding(.top, AppSpacing.xs)
            }
        }
    }

    @ViewBuilder
    private func focusListCard(_ session: ArenaActiveSession) -> some View {
        let items = ArenaClock.focusItems(session.focus)
        if !items.isEmpty {
            Card {
                VStack(alignment: .leading, spacing: AppSpacing.sm) {
                    SectionHeader("Contenido de hoy")
                    ForEach(Array(items.enumerated()), id: \.offset) { _, line in
                        HStack(alignment: .top, spacing: AppSpacing.sm) {
                            Circle()
                                .fill(ThemeColor(.inkFaint))
                                .frame(width: 4, height: 4)
                                .padding(.top, 7)
                            Text(line)
                                .font(AppFont.body)
                                .foregroundStyle(ThemeColor(.ink))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        }
    }

    // MARK: Sin sesión

    private var idleSection: some View {
        VStack(alignment: .leading, spacing: AppSpacing.lg) {
            Card {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Selecciona tu sesión de hoy")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(ThemeColor(.ink))
                    Text("Solo aparecen las sesiones programadas para \(model.todayYMD).")
                        .font(AppFont.caption)
                        .foregroundStyle(ThemeColor(.inkMuted))
                }
            }

            if model.pendingOptions.isEmpty {
                Card {
                    EmptyState(
                        systemImage: "calendar.badge.clock",
                        title: "No hay sesiones para hoy",
                        message: "Crea o guarda un plan en «Study Planner» y asegúrate de que incluya la fecha de hoy."
                    )
                }
            } else {
                ForEach(model.pendingOptions) { option in
                    optionCard(option)
                }
            }

            historySection
        }
    }

    private func optionCard(_ option: ArenaSessionOption) -> some View {
        Card {
            VStack(alignment: .leading, spacing: AppSpacing.md) {
                HStack {
                    Pill(option.planTitle)
                    Spacer(minLength: AppSpacing.sm)
                    Text(ArenaClock.hoursLabel(option.studyHours))
                        .font(AppFont.caption)
                        .foregroundStyle(ThemeColor(.inkMuted))
                }
                Text(option.displayTitle)
                    .font(AppFont.cardTitle)
                    .foregroundStyle(ThemeColor(.ink))
                let summary = ArenaClock.focusItems(option.focus).prefix(2).joined(separator: " · ")
                if !summary.isEmpty {
                    Text(summary)
                        .font(AppFont.caption)
                        .foregroundStyle(ThemeColor(.inkMuted))
                        .lineLimit(2)
                }
                Button { model.start(option) } label: {
                    Text("Empezar sesión")
                        .font(.system(size: 15, weight: .bold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, AppSpacing.md)
                        .foregroundStyle(ThemeColor(.onAccent))
                        .background(
                            RoundedRectangle(cornerRadius: AppRadius.medium, style: .continuous)
                                .fill(ThemeColor(.accent))
                        )
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: Historial

    private var historySection: some View {
        VStack(alignment: .leading, spacing: AppSpacing.md) {
            SectionHeader("Historial de sesiones") {
                Pill("\(model.completed.count)")
            }

            if model.completed.isEmpty {
                Card {
                    EmptyState(
                        systemImage: "clock.arrow.circlepath",
                        title: "Aún no hay sesiones completadas",
                        message: "Cuando termines una sesión aparecerá aquí, agrupada por el día del plan."
                    )
                }
            } else {
                ForEach(model.historyByPlanDay) { group in
                    VStack(alignment: .leading, spacing: AppSpacing.sm) {
                        Text(group.date == "—" ? "Sin fecha de plan" : ArenaClock.longDayLabel(group.date))
                            .font(AppFont.caption)
                            .textCase(.uppercase)
                            .kerning(0.8)
                            .foregroundStyle(ThemeColor(.inkMuted))
                        ForEach(group.items) { session in
                            historyRow(session)
                        }
                    }
                }
            }
        }
    }

    private func historyRow(_ session: CompletedSession) -> some View {
        Button { detail = session } label: {
            Card(padding: AppSpacing.md) {
                VStack(alignment: .leading, spacing: AppSpacing.sm) {
                    HStack {
                        Pill(session.planTitle)
                        Spacer(minLength: AppSpacing.sm)
                        Text(ArenaClock.shortStamp(session.completedAtDate))
                            .font(AppFont.caption)
                            .foregroundStyle(ThemeColor(.inkFaint))
                    }
                    Text(session.displayTitle)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(ThemeColor(.ink))
                        .lineLimit(1)
                    HStack(spacing: AppSpacing.md) {
                        HStack(spacing: 5) {
                            Circle()
                                .fill(ArenaClock.focusColor(session.focusScore))
                                .frame(width: 8, height: 8)
                            Text("\(Int(session.focusScore.rounded()))")
                                .font(AppFont.caption)
                                .monospacedDigit()
                        }
                        Text(session.activeDurationLabel)
                            .font(AppFont.caption)
                        Text("\(ArenaClock.completionPct(session)) %")
                            .font(AppFont.caption)
                            .monospacedDigit()
                        if session.distractionCount > 0 {
                            Text("\(session.distractionCount) dist.")
                                .font(AppFont.caption)
                                .foregroundStyle(ThemeColor(.inkFaint))
                        }
                    }
                    .foregroundStyle(ThemeColor(.inkMuted))
                }
            }
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("Repetir sesión", systemImage: "arrow.clockwise") { model.redo(session) }
            Button("Eliminar", systemImage: "trash", role: .destructive) { model.delete(session) }
        }
    }

    // MARK: Aviso de sesión falsa

    /// Los dos botones del aviso ya limpian el prompt en el modelo; el `set` solo
    /// existe porque `alert` exige un binding de escritura.
    private var promptIsPresented: Binding<Bool> {
        Binding(get: { model.prompt != nil }, set: { _ in })
    }
}

// MARK: - Detalle de una sesión completada

private struct ArenaSessionDetailSheet: View {
    let session: CompletedSession
    let onRedo: () -> Void
    let onDelete: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var confirmingDelete = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: AppSpacing.lg) {
                    Card {
                        VStack(alignment: .leading, spacing: AppSpacing.sm) {
                            Pill(session.planTitle)
                            Text(session.displayTitle)
                                .font(AppFont.cardTitle)
                                .foregroundStyle(ThemeColor(.ink))
                            Text(ArenaClock.longDayLabel(session.date))
                                .font(AppFont.caption)
                                .foregroundStyle(ThemeColor(.inkMuted))
                        }
                    }

                    Card {
                        VStack(spacing: AppSpacing.sm) {
                            metric("Tiempo activo", session.activeDurationLabel)
                            Hairline()
                            metric("Completado", "\(ArenaClock.completionPct(session)) %")
                            Hairline()
                            metric("Focus score", "\(Int(session.focusScore.rounded()))")
                            Hairline()
                            metric("Distracciones", "\(session.distractionCount)")
                            Hairline()
                            metric("Finalizada", ArenaClock.shortStamp(session.completedAtDate))
                        }
                    }

                    let items = ArenaClock.focusItems(session.focus)
                    if !items.isEmpty {
                        Card {
                            VStack(alignment: .leading, spacing: AppSpacing.sm) {
                                SectionHeader("Contenido")
                                ForEach(Array(items.enumerated()), id: \.offset) { _, line in
                                    Text("· \(line)")
                                        .font(AppFont.body)
                                        .foregroundStyle(ThemeColor(.ink))
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                        }
                    }

                    Button(action: onRedo) {
                        Text("Repetir sesión")
                            .font(.system(size: 15, weight: .bold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, AppSpacing.md)
                            .foregroundStyle(ThemeColor(.onAccent))
                            .background(
                                RoundedRectangle(cornerRadius: AppRadius.medium, style: .continuous)
                                    .fill(ThemeColor(.accent))
                            )
                    }
                    .buttonStyle(.plain)

                    Button(role: .destructive) { confirmingDelete = true } label: {
                        Text("Eliminar del historial")
                            .font(.system(size: 15, weight: .semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, AppSpacing.md)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Color(hex: 0xDC2626))
                }
                .padding(AppSpacing.lg)
            }
            .canvasBackground()
            .navigationTitle("Sesión")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cerrar") { dismiss() }
                }
            }
            .confirmationDialog(
                "¿Eliminar esta sesión del historial?",
                isPresented: $confirmingDelete,
                titleVisibility: .visible
            ) {
                Button("Eliminar", role: .destructive, action: onDelete)
                Button("Cancelar", role: .cancel) {}
            } message: {
                Text("También se elimina en el resto de dispositivos.")
            }
        }
    }

    private func metric(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .font(AppFont.caption)
                .foregroundStyle(ThemeColor(.inkMuted))
            Spacer()
            Text(value)
                .font(.system(size: 14, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(ThemeColor(.ink))
        }
    }
}

// MARK: - Planes de estudio (solo lo que necesita la arena)

/// Lectura mínima de `iestudio-study-plans`: la arena solo necesita los días del
/// calendario guardado para ofrecer las sesiones de hoy.
private struct ArenaPlanList: Decodable, Sendable {
    var plans: [ArenaPlan] = []

    init() {}

    init(from decoder: any Decoder) throws {
        var c = try decoder.unkeyedContainer()
        var out: [ArenaPlan] = []
        while !c.isAtEnd {
            if let one = try? c.decode(ArenaPlan.self) {
                out.append(one)
            } else {
                _ = try? c.decode(ArenaSkip.self)
            }
        }
        plans = out
    }

    func todayOptions(today: String) -> [ArenaSessionOption] {
        var out: [ArenaSessionOption] = []
        for plan in plans {
            // Sin `savedAt` el calendario es un borrador que la web tampoco ofrece.
            guard let schedule = plan.aiSchedule,
                  !(schedule.savedAt ?? "").trimmingCharacters(in: .whitespaces).isEmpty
            else { continue }
            for day in schedule.days where day.date == today {
                out.append(
                    ArenaSessionOption(
                        key: "\(plan.id)::\(day.date)",
                        planId: plan.id,
                        planTitle: plan.title,
                        date: day.date,
                        studyHours: day.studyHours,
                        focus: day.focus,
                        sessionTitle: day.sessionTitle
                    )
                )
            }
        }
        return out
    }
}

private struct ArenaPlan: Decodable, Sendable {
    let id: String
    let title: String
    let aiSchedule: ArenaPlanSchedule?

    private enum CodingKeys: String, CodingKey { case id, title, aiSchedule }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        let rawTitle = ((try? c.decodeIfPresent(String.self, forKey: .title)) ?? nil) ?? ""
        title = rawTitle.trimmingCharacters(in: .whitespaces).isEmpty ? "(Sin título)" : rawTitle
        aiSchedule = (try? c.decodeIfPresent(ArenaPlanSchedule.self, forKey: .aiSchedule)) ?? nil
    }
}

private struct ArenaPlanSchedule: Decodable, Sendable {
    let savedAt: String?
    let days: [ArenaPlanDay]

    private enum CodingKeys: String, CodingKey { case savedAt, days }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        savedAt = (try? c.decodeIfPresent(String.self, forKey: .savedAt)) ?? nil
        if var list = try? c.nestedUnkeyedContainer(forKey: .days) {
            var out: [ArenaPlanDay] = []
            while !list.isAtEnd {
                if let one = try? list.decode(ArenaPlanDay.self) {
                    out.append(one)
                } else {
                    _ = try? list.decode(ArenaSkip.self)
                }
            }
            days = out
        } else {
            days = []
        }
    }
}

private struct ArenaPlanDay: Decodable, Sendable {
    let date: String
    let studyHours: Double
    let focus: String
    let sessionTitle: String?

    private enum CodingKeys: String, CodingKey { case date, studyHours, focus, sessionTitle }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        date = try c.decode(String.self, forKey: .date)
        // Mismos límites que `normalizeAiSchedule`: 0,25 h – 24 h, 2 h por defecto.
        let raw = ((try? c.decodeIfPresent(Double.self, forKey: .studyHours)) ?? nil)
            ?? Double(((try? c.decodeIfPresent(String.self, forKey: .studyHours)) ?? nil) ?? "")
        studyHours = (raw?.isFinite ?? false) ? min(24, max(0.25, raw ?? 2)) : 2
        focus = ((try? c.decodeIfPresent(String.self, forKey: .focus)) ?? nil) ?? ""
        let rawTitle = ((try? c.decodeIfPresent(String.self, forKey: .sessionTitle)) ?? nil)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        sessionTitle = (rawTitle?.isEmpty ?? true) ? nil : rawTitle
    }
}

/// Comodín para saltar elementos rotos sin dejar el contenedor a medias.
private struct ArenaSkip: Decodable {
    init(from decoder: any Decoder) throws {
        _ = try decoder.singleValueContainer()
    }
}

// MARK: - Utilidades

private extension KeyedDecodingContainer {
    func lenientString(_ key: Key) -> String? {
        (try? decodeIfPresent(String.self, forKey: key)) ?? nil
    }

    func lenientBool(_ key: Key) -> Bool? {
        (try? decodeIfPresent(Bool.self, forKey: key)) ?? nil
    }

    func lenientNumber(_ key: Key) -> Double? {
        guard let v = ((try? decodeIfPresent(Double.self, forKey: key)) ?? nil), v.isFinite else {
            return nil
        }
        return v
    }
}

private enum ArenaNumber {
    /// Un NaN o un infinito propagados a los cálculos dejan el cronómetro
    /// congelado sin error visible: mejor tratarlo como registro inválido.
    static func finite(_ value: Double) throws -> Double {
        guard value.isFinite else {
            throw DecodingError.dataCorrupted(
                .init(codingPath: [], debugDescription: "Número no finito")
            )
        }
        return value
    }
}

enum ArenaClock {

    static func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }

    /// `crypto.randomUUID()` genera minúsculas; se replica para que los ids
    /// nativos y los de la web sean indistinguibles al ojo en el historial.
    static func newRunId() -> String { UUID().uuidString.lowercased() }

    /// Mismo formato que `new Date().toISOString()`: UTC con milisegundos.
    /// `ISO8601FormatStyle` es un struct `Sendable`; `ISO8601DateFormatter`, al
    /// ser clase, no cabe en un `static let` bajo Swift 6.
    private static let iso = Date.ISO8601FormatStyle(includingFractionalSeconds: true)

    static func isoNow() -> String { iso.format(Date()) }

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

    /// "lunes, 5 de agosto".
    static func longDayLabel(_ ymd: String) -> String {
        guard let date = date(fromYMD: ymd) else { return ymd }
        return date.formatted(
            .dateTime.weekday(.wide).day().month(.wide).locale(Locale(identifier: "es_ES"))
        )
    }

    static func shortStamp(_ date: Date?) -> String {
        guard let date else { return "—" }
        return date.formatted(
            .dateTime.day().month(.abbreviated).hour().minute().locale(Locale(identifier: "es_ES"))
        )
    }

    /// "1:05:03" con horas, "05:03" sin ellas.
    static func countdown(_ ms: Double) -> String {
        let total = Int(max(0, ms) / 1000)
        let h = total / 3600
        let m = (total % 3600) / 60
        let s = total % 60
        if h > 0 { return String(format: "%d:%02d:%02d", h, m, s) }
        return String(format: "%02d:%02d", m, s)
    }

    static func hoursLabel(_ hours: Double) -> String {
        let rounded = (hours * 10).rounded() / 10
        return rounded == rounded.rounded()
            ? "\(Int(rounded)) h"
            : String(format: "%.1f h", rounded)
    }

    static func completionPct(_ session: CompletedSession) -> Int {
        Int(min(100, (session.elapsedActiveMs / max(1, session.totalDurationMs) * 100).rounded()))
    }

    /// `splitFocusIntoItems`: separa por ";", "·" o salto de línea.
    static func focusItems(_ focus: String) -> [String] {
        let trimmed = focus.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }
        let parts = trimmed
            .split(whereSeparator: { $0 == ";" || $0 == "·" || $0.isNewline })
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        return parts.isEmpty ? [trimmed] : parts
    }

    /// Verde (100) → naranja → rojo (0), igual que `hsl(hue 82% 42%)` en la web.
    /// SwiftUI trabaja en HSB, así que se convierte: v = L + S·min(L,1−L) y
    /// s_hsb = 2·(1 − L/v).
    static func focusColor(_ score: Double) -> Color {
        let s = min(100, max(0, score))
        let hue = (s / 100) * 120 / 360
        let lightness = 0.42
        let saturationHSL = 0.82
        let brightness = lightness + saturationHSL * min(lightness, 1 - lightness)
        let saturation = brightness == 0 ? 0 : 2 * (1 - lightness / brightness)
        return Color(hue: hue, saturation: saturation, brightness: brightness)
    }
}

// MARK: - Previews

#Preview("Study Arena — oscuro") {
    StudyArenaView().studyOSTheme().preferredColorScheme(.dark)
}

#Preview("Study Arena — claro") {
    StudyArenaView().studyOSTheme().preferredColorScheme(.light)
}
