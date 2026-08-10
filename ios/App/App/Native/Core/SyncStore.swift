import Combine
import Foundation

// MARK: - Estado publicado

/// Estado visible de la sincronización, para pintarlo en la interfaz.
public enum SyncStatus: Sendable, Equatable {
    case idle
    case syncing
    /// No hubo red o el servidor no contestó. Los datos locales siguen valiendo.
    case offline
    /// El servidor devolvió 401: hay que volver a autenticarse.
    case unauthorized
    /// El servidor respondió pero con error (5xx, JSON inválido…).
    case failed(String)
}

/// Puente entre el `SyncStore` (actor, fuera del hilo principal) y SwiftUI.
///
/// Existe porque un actor no puede ser `ObservableObject`: las vistas necesitan
/// que las notificaciones lleguen ya en el hilo principal.
@MainActor
public final class SyncBus: ObservableObject {

    public static let shared = SyncBus()

    /// Sube en cada cambio de datos. Sirve como `id` para forzar recargas.
    @Published public private(set) var revision: UInt64 = 0

    /// Claves modificadas en la última notificación.
    @Published public private(set) var lastChangedKeys: Set<String> = []

    @Published public private(set) var status: SyncStatus = .idle
    @Published public private(set) var lastSyncedAt: Date?

    /// Número de claves escritas y todavía no subidas.
    @Published public private(set) var pendingUploads: Int = 0

    private var continuations: [UUID: AsyncStream<Set<String>>.Continuation] = [:]

    private init() {}

    /// Flujo de claves modificadas, para observadores que no son vistas
    /// (por ejemplo recargar widgets o refrescar un caché derivado).
    ///
    /// Cada llamada crea un flujo independiente; se cierra solo al soltar el
    /// iterador. `bufferingNewest` evita que un consumidor lento acumule
    /// memoria: le interesan las últimas claves, no todo el histórico.
    public func changes() -> AsyncStream<Set<String>> {
        let (stream, continuation) = AsyncStream<Set<String>>.makeStream(
            bufferingPolicy: .bufferingNewest(32)
        )
        let id = UUID()
        continuations[id] = continuation
        continuation.onTermination = { _ in
            Task { @MainActor in SyncBus.shared.dropContinuation(id) }
        }
        return stream
    }

    private func dropContinuation(_ id: UUID) {
        continuations[id] = nil
    }

    /// ¿Cambió alguna de estas claves en la última notificación?
    /// Atajo para vistas que solo miran una parte del estado.
    public func didChange(any keys: some Sequence<String>) -> Bool {
        keys.contains { lastChangedKeys.contains($0) }
    }

    // MARK: Entradas desde SyncStore

    fileprivate func emit(changed keys: Set<String>) {
        guard !keys.isEmpty else { return }
        lastChangedKeys = keys
        revision &+= 1
        for continuation in continuations.values {
            continuation.yield(keys)
        }
    }

    fileprivate func update(status newStatus: SyncStatus, syncedAt: Date? = nil) {
        status = newStatus
        if let syncedAt { lastSyncedAt = syncedAt }
    }

    fileprivate func update(pendingUploads count: Int) {
        pendingUploads = count
    }
}

// MARK: - Almacén sincronizado

/// Espejo nativo del `localStorage` de la web.
///
/// El estado real es un diccionario `clave -> STRING con JSON dentro`, igual que
/// en el navegador. Nunca se guarda el objeto ya decodificado: así una clave que
/// la app nativa no entiende viaja intacta de vuelta al servidor en lugar de
/// perderse al reserializar.
public actor SyncStore {

    public static let shared = SyncStore()

    // MARK: Estado

    private var entries: [String: String] = [:]
    /// Claves escritas en local y todavía no confirmadas por el servidor.
    private var dirty: Set<String> = []
    private var etag: String?
    private var didLoadFromDisk = false

    private var debounceTask: Task<Void, Never>?
    private var persistTask: Task<Void, Never>?
    private var inFlightFlush: Task<Void, Never>?
    private var consecutiveFlushFailures = 0

    private var baseURL: URL
    private var session: URLSession
    private var cookieHeader: String?

    /// El servidor las descarta de todo payload: son ficheros de este
    /// dispositivo. Tampoco se podan al recibir la nube, o desaparecerían.
    private static let cloudExcluded: Set<String> = [StorageKeys.manualCourses]

    private static let debounceSeconds: Double = 2

    private init() {
        let configured = Bundle.main.object(forInfoDictionaryKey: "StudyOSBaseURL") as? String
        baseURL = configured.flatMap(URL.init(string:))
            ?? URL(string: "https://studyos-delta.vercel.app")!
        session = SyncStore.makeSession(usingExplicitCookieHeader: false)
    }

    // MARK: - Configuración

    /// Permite a `AppSession` apuntar a otro entorno o inyectar su propia sesión.
    public func configure(baseURL newBaseURL: URL? = nil, session newSession: URLSession? = nil) {
        if let newBaseURL { baseURL = newBaseURL }
        if let newSession { session = newSession }
    }

    /// Cookie de sesión de Auth.js en formato cabecera (`nombre=valor; otra=…`).
    ///
    /// Hace falta porque la cookie vive en el `WKHTTPCookieStore` del WebView de
    /// Capacitor, que no comparte almacén con `URLSession`. `AppSession` la
    /// extrae del WebView y la deja aquí.
    public func setAuthCookieHeader(_ header: String?) {
        let changed = (header != nil) != (cookieHeader != nil)
        cookieHeader = header?.isEmpty == true ? nil : header
        if changed {
            // Con cookie explícita hay que desactivar el manejo automático o
            // URLSession sobreescribe la cabecera con su propio almacén (vacío).
            session = SyncStore.makeSession(usingExplicitCookieHeader: cookieHeader != nil)
        }
    }

    private static func makeSession(usingExplicitCookieHeader explicit: Bool) -> URLSession {
        let config = URLSessionConfiguration.default
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        config.timeoutIntervalForRequest = 30
        config.waitsForConnectivity = false
        if explicit {
            config.httpShouldSetCookies = false
            config.httpCookieAcceptPolicy = .never
            config.httpCookieStorage = nil
        }
        return URLSession(configuration: config)
    }

    private var endpoint: URL {
        baseURL.appending(path: "api/user-sync")
    }

    // MARK: - Lectura y escritura

    /// Decodifica el JSON guardado bajo `key`. Devuelve `nil` si la clave no
    /// existe o si el JSON no encaja con `T`; nunca lanza.
    ///
    /// `nonisolated` a propósito: el trabajo de JSON ocurre fuera del actor y
    /// por la frontera de aislamiento solo cruza un `String`. Así `T` no
    /// necesita ser `Sendable` y no se bloquea el actor decodificando.
    public nonisolated func decoded<T: Decodable>(_ type: T.Type, forKey key: String) async -> T? {
        guard let raw = await rawString(forKey: key) else { return nil }
        return SyncStore.decode(type, from: raw)
    }

    /// Codifica `value` a JSON y lo guarda. Programa la subida con debounce.
    public nonisolated func encode<T: Encodable>(_ value: T, forKey key: String) async {
        guard let raw = SyncStore.encodeToString(value) else { return }
        await setRawString(raw, forKey: key)
    }

    /// Valor crudo tal cual lo guardó la web (JSON serializado, o texto plano
    /// en claves como `iestudio-theme`).
    public func rawString(forKey key: String) -> String? {
        ensureLoaded()
        return entries[key]
    }

    public func setRawString(_ value: String, forKey key: String) {
        ensureLoaded()
        guard entries[key] != value else { return }
        entries[key] = value
        dirty.insert(key)
        schedulePersist()
        scheduleFlush()
        let pending = dirty.count
        Task { @MainActor in
            SyncBus.shared.emit(changed: [key])
            SyncBus.shared.update(pendingUploads: pending)
        }
    }

    /// Claves presentes que empiezan por `prefix`. Necesario para las claves
    /// dinámicas de Blackboard (`iestudio-bb-gb-<courseId>`).
    public func keys(withPrefix prefix: String) -> [String] {
        ensureLoaded()
        return entries.keys.filter { $0.hasPrefix(prefix) }.sorted()
    }

    /// Copia del diccionario completo. Para depuración o exportación.
    public func snapshot() -> [String: String] {
        ensureLoaded()
        return entries
    }

    public func hasPendingChanges() -> Bool {
        ensureLoaded()
        return !dirty.isEmpty
    }

    // MARK: - Descarga

    /// GET condicional. Con 304 no toca nada: ni disco, ni caché, ni bus.
    public func refresh() async {
        ensureLoaded()
        await MainActor.run { SyncBus.shared.update(status: .syncing) }

        var request = URLRequest(url: endpoint)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if let etag { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }
        applyAuth(to: &request)

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                await report(.failed("Respuesta no HTTP"))
                return
            }
            switch http.statusCode {
            case 304:
                await report(.idle, syncedAt: Date())
            case 200:
                if let tag = http.value(forHTTPHeaderField: "ETag") { etag = tag }
                let incoming = SyncStore.parseEntries(data)
                let changed = merge(incoming: incoming)
                persistNow()
                let pending = dirty.count
                await MainActor.run {
                    SyncBus.shared.emit(changed: changed)
                    SyncBus.shared.update(pendingUploads: pending)
                    SyncBus.shared.update(status: .idle, syncedAt: Date())
                }
            case 401:
                await report(.unauthorized)
            case 503:
                // Nube desactivada (sin base de datos). No es un fallo del cliente.
                await report(.idle)
            default:
                await report(.failed("HTTP \(http.statusCode)"))
            }
        } catch {
            await report(.offline)
        }
    }

    /// Funde lo recibido con lo local y devuelve las claves que cambiaron.
    ///
    /// Lo pendiente de subir (`dirty`) gana siempre: si no, un `refresh` a mitad
    /// del debounce revertiría lo que el usuario acaba de escribir.
    private func merge(incoming: [String: String]) -> Set<String> {
        var changed: Set<String> = []
        for (key, value) in incoming {
            guard !dirty.contains(key) else { continue }
            if entries[key] != value {
                entries[key] = value
                changed.insert(key)
            }
        }
        // Poda de claves borradas en otro dispositivo. Solo si el servidor trajo
        // algo: un payload vacío suele ser cuenta nueva o error, y borrar meses
        // de datos por eso no tiene vuelta atrás.
        if !incoming.isEmpty {
            // Copia de las claves: se está mutando `entries` dentro del bucle.
            for key in Array(entries.keys)
            where incoming[key] == nil
                && !dirty.contains(key)
                && !SyncStore.cloudExcluded.contains(key) {
                entries.removeValue(forKey: key)
                changed.insert(key)
            }
        }
        return changed
    }

    // MARK: - Subida

    /// Sube lo pendiente. Serializa con la subida en curso para no mandar dos
    /// PUT a la vez (el servidor fusiona, y dos merges cruzados descuadran).
    public func flush() async {
        ensureLoaded()
        debounceTask?.cancel()
        debounceTask = nil

        if let running = inFlightFlush {
            await running.value
        }
        guard !dirty.isEmpty else { return }

        let task = Task { await self.performFlush() }
        inFlightFlush = task
        await task.value
        if inFlightFlush == task { inFlightFlush = nil }
    }

    private func performFlush() async {
        let sending = dirty.subtracting(SyncStore.cloudExcluded)
        guard !sending.isEmpty else {
            dirty.subtract(SyncStore.cloudExcluded)
            return
        }
        var payload: [String: String] = [:]
        for key in sending {
            payload[key] = entries[key]
        }
        guard let body = try? JSONEncoder().encode(UploadBody(entries: payload)) else {
            dirty.subtract(sending)
            return
        }

        await MainActor.run { SyncBus.shared.update(status: .syncing) }

        var request = URLRequest(url: endpoint)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = body
        applyAuth(to: &request)

        // Reintento corto: 3 intentos con espera creciente. Más que eso ya no es
        // un fallo transitorio y conviene dejarlo al siguiente debounce.
        for attempt in 0..<3 {
            if Task.isCancelled { return }
            do {
                let (_, response) = try await session.data(for: request)
                guard let http = response as? HTTPURLResponse else {
                    await report(.failed("Respuesta no HTTP"))
                    break
                }
                switch http.statusCode {
                case 200..<300:
                    confirmUpload(payload)
                    await report(.idle, syncedAt: Date())
                    return
                case 401:
                    await report(.unauthorized)
                    return
                case 500..<600:
                    break // reintentable
                default:
                    // 4xx: el payload no le gusta al servidor. Reintentar no
                    // arregla nada, pero tampoco tiramos los datos locales.
                    await report(.failed("HTTP \(http.statusCode)"))
                    scheduleRetryAfterFailure()
                    return
                }
            } catch {
                await report(.offline)
            }
            if attempt < 2 {
                try? await Task.sleep(for: .seconds(attempt == 0 ? 1 : 3))
            }
        }
        scheduleRetryAfterFailure()
    }

    private func confirmUpload(_ sent: [String: String]) {
        consecutiveFlushFailures = 0
        // Solo se limpian las claves cuyo valor sigue siendo el que se envió:
        // si el usuario escribió durante el PUT, esa clave sigue pendiente.
        for (key, value) in sent where entries[key] == value {
            dirty.remove(key)
        }
        // El servidor fusiona lo subido con lo que ya tenía, así que la versión
        // buena está en la nube, no aquí: invalidar el ETag fuerza un GET
        // completo en el próximo refresh en vez de un 304 engañoso.
        etag = nil
        persistNow()
        let pending = dirty.count
        Task { @MainActor in SyncBus.shared.update(pendingUploads: pending) }
    }

    // MARK: - Programación

    private func scheduleFlush() {
        debounceTask?.cancel()
        debounceTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(SyncStore.debounceSeconds))
            guard !Task.isCancelled else { return }
            await self?.flush()
        }
    }

    private func scheduleRetryAfterFailure() {
        consecutiveFlushFailures += 1
        // Espera creciente hasta 60 s: sin techo, un dispositivo sin red estaría
        // despertando la radio cada 2 s indefinidamente.
        let delay = min(60, 5 * Double(consecutiveFlushFailures))
        debounceTask?.cancel()
        debounceTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            await self?.flush()
        }
    }

    private func report(_ status: SyncStatus, syncedAt: Date? = nil) async {
        await MainActor.run { SyncBus.shared.update(status: status, syncedAt: syncedAt) }
    }

    private func applyAuth(to request: inout URLRequest) {
        if let cookieHeader {
            request.setValue(cookieHeader, forHTTPHeaderField: "Cookie")
        }
    }

    // MARK: - Persistencia local

    private static let diskFileName = "sync-store.json"

    private static var diskURL: URL? {
        guard let support = FileManager.default.urls(
            for: .applicationSupportDirectory, in: .userDomainMask
        ).first else { return nil }
        let folder = support.appending(path: "StudyOS", directoryHint: .isDirectory)
        if !FileManager.default.fileExists(atPath: folder.path(percentEncoded: false)) {
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        }
        return folder.appending(path: diskFileName)
    }

    private struct DiskSnapshot: Codable {
        var entries: [String: String]
        var dirty: [String]
        var etag: String?
        var savedAt: Date?
    }

    private struct UploadBody: Encodable {
        let entries: [String: String]
    }

    /// Carga síncrona la primera vez. Bloquea el actor unas decenas de ms con el
    /// fichero típico (~500 KB), a cambio de que cualquier lectura posterior sea
    /// inmediata y la app arranque con datos sin esperar a la red.
    private func ensureLoaded() {
        guard !didLoadFromDisk else { return }
        didLoadFromDisk = true
        guard let url = SyncStore.diskURL,
              let data = try? Data(contentsOf: url),
              let snapshot = try? JSONDecoder().decode(DiskSnapshot.self, from: data)
        else { return }
        entries = snapshot.entries
        dirty = Set(snapshot.dirty)
        etag = snapshot.etag
        if !dirty.isEmpty {
            // Quedaron escrituras sin subir de la sesión anterior.
            scheduleFlush()
            let pending = dirty.count
            Task { @MainActor in SyncBus.shared.update(pendingUploads: pending) }
        }
    }

    private func schedulePersist() {
        persistTask?.cancel()
        persistTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(500))
            guard !Task.isCancelled else { return }
            await self?.persistNow()
        }
    }

    /// Vuelca el estado a disco. Llamar al pasar a segundo plano.
    public func persistNow() {
        persistTask?.cancel()
        persistTask = nil
        guard let url = SyncStore.diskURL else { return }
        let snapshot = DiskSnapshot(
            entries: entries,
            dirty: Array(dirty),
            etag: etag,
            savedAt: Date()
        )
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        try? data.write(to: url, options: .atomic)
    }

    /// Borra el estado local. Para el cierre de sesión: si no, el siguiente
    /// usuario vería los datos del anterior antes del primer `refresh`.
    public func reset() {
        debounceTask?.cancel()
        persistTask?.cancel()
        debounceTask = nil
        persistTask = nil
        entries = [:]
        dirty = []
        etag = nil
        consecutiveFlushFailures = 0
        didLoadFromDisk = true
        if let url = SyncStore.diskURL {
            try? FileManager.default.removeItem(at: url)
        }
        Task { @MainActor in
            SyncBus.shared.update(pendingUploads: 0)
            SyncBus.shared.update(status: .idle)
            SyncBus.shared.emit(changed: ["*"])
        }
    }
}

// MARK: - JSON tolerante

extension SyncStore {

    /// Decodificador permisivo: los datos llevan meses acumulándose y hay
    /// fechas guardadas de tres formas distintas según la versión de la web.
    static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { nested in
            let container = try nested.singleValueContainer()
            if let text = try? container.decode(String.self),
               let date = parseDate(text) {
                return date
            }
            if let number = try? container.decode(Double.self) {
                // Los timestamps de JS son milisegundos; los de Unix, segundos.
                return Date(timeIntervalSince1970: number > 100_000_000_000 ? number / 1000 : number)
            }
            throw DecodingError.dataCorruptedError(
                in: container, debugDescription: "Fecha no reconocida"
            )
        }
        return decoder
    }

    static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        // Salida estable: sin esto el mismo contenido genera strings distintos y
        // el servidor recibiría cambios donde no los hay.
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return encoder
    }

    private static func parseDate(_ text: String) -> Date? {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = iso.date(from: text) { return date }
        iso.formatOptions = [.withInternetDateTime]
        if let date = iso.date(from: text) { return date }
        // `2026-08-05` a secas: lo escribe la web para fechas sin hora.
        let plain = DateFormatter()
        plain.locale = Locale(identifier: "en_US_POSIX")
        plain.timeZone = TimeZone(secondsFromGMT: 0)
        plain.dateFormat = "yyyy-MM-dd"
        return plain.date(from: text)
    }

    static func decode<T: Decodable>(_ type: T.Type, from raw: String) -> T? {
        let data = Data(raw.utf8)
        if let value = try? makeDecoder().decode(T.self, from: data) {
            return value
        }
        // Claves como `iestudio-theme` guardan texto plano sin comillas: no es
        // JSON válido, pero para la web sí es un valor legítimo.
        if T.self == String.self {
            return raw as? T
        }
        return nil
    }

    static func encodeToString<T: Encodable>(_ value: T) -> String? {
        guard let data = try? makeEncoder().encode(value) else { return nil }
        return String(decoding: data, as: UTF8.self)
    }

    /// Extrae `entries` de la respuesta del servidor.
    ///
    /// Se usa `JSONSerialization` en vez de `Codable` por tolerancia: si algún
    /// valor llegara como objeto en lugar de string (payload viejo o corrupto),
    /// se reserializa a texto en vez de tumbar toda la descarga.
    static func parseEntries(_ data: Data) -> [String: String] {
        guard
            let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let rawEntries = root["entries"] as? [String: Any]
        else { return [:] }

        var out: [String: String] = [:]
        for (key, value) in rawEntries {
            guard key.hasPrefix(StorageKeys.syncPrefix) else { continue }
            if let text = value as? String {
                out[key] = text
            } else if let reserialized = try? JSONSerialization.data(
                withJSONObject: value, options: [.fragmentsAllowed]
            ) {
                out[key] = String(decoding: reserialized, as: UTF8.self)
            }
        }
        return out
    }
}
