import Foundation

/// Errores de red con los que la interfaz puede decidir qué enseñar.
enum APIError: LocalizedError, Sendable {
    case noAutenticado
    case sinRed(underlying: String)
    case servidor(status: Int, detalle: String?)
    case respuestaIlegible

    var errorDescription: String? {
        switch self {
        case .noAutenticado:
            "Sesión caducada. Vuelve a iniciar sesión."
        case .sinRed(let underlying):
            "Sin conexión (\(underlying))"
        case .servidor(let status, let detalle):
            detalle.map { "Error del servidor \(status): \($0)" } ?? "Error del servidor \(status)"
        case .respuestaIlegible:
            "El servidor devolvió algo que no se pudo leer."
        }
    }

    /// Un 401/403 significa que hay que reautenticar; el resto no.
    var requiereLogin: Bool {
        if case .noAutenticado = self { return true }
        if case .servidor(let status, _) = self { return status == 401 || status == 403 }
        return false
    }
}

/// Cliente HTTP mínimo contra la API de la web.
///
/// `SyncStore` habla directamente con `/api/user-sync` porque necesita gestionar
/// su propio ETag y su cola de subida. Este cliente cubre el resto: el canje de
/// sesión y las llamadas puntuales que las pantallas puedan necesitar.
actor APIClient {
    static let shared = APIClient()

    /// Misma resolución que `SyncStore`: `Info.plist` primero, producción después.
    static func defaultBaseURL() -> URL {
        if let raw = Bundle.main.object(forInfoDictionaryKey: "StudyOSBaseURL") as? String,
           let url = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
           url.scheme != nil {
            return url
        }
        return URL(string: "https://studyos-delta.vercel.app")!
    }

    private(set) var baseURL: URL
    private let session: URLSession

    init(baseURL: URL? = nil, session: URLSession? = nil) {
        self.baseURL = baseURL ?? APIClient.defaultBaseURL()
        self.session = session ?? APIClient.makeSession()
    }

    /// Sesión con cookies persistentes: la de Auth.js debe sobrevivir a cierres
    /// de la app, o habría que reautenticar en cada arranque.
    private static func makeSession() -> URLSession {
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = HTTPCookieStorage.shared
        config.httpCookieAcceptPolicy = .always
        config.httpShouldSetCookies = true
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 30
        config.waitsForConnectivity = true
        return URLSession(configuration: config)
    }

    func setBaseURL(_ url: URL) { baseURL = url }

    // MARK: - Sesión

    /// Canjea el token de `iestudio://auth-callback?tok=…` por la cookie de sesión.
    ///
    /// El endpoint responde con un 302 a `/` y la cookie en `Set-Cookie`. Nos
    /// interesa el efecto secundario (la cookie entra en `HTTPCookieStorage`),
    /// no el cuerpo, así que no seguimos la redirección.
    func exchangeSessionToken(_ token: String) async throws -> Bool {
        var comps = URLComponents(url: baseURL.appendingPathComponent("api/auth/mobile-exchange"),
                                  resolvingAgainstBaseURL: false)
        comps?.queryItems = [URLQueryItem(name: "tok", value: token)]
        guard let url = comps?.url else { throw APIError.respuestaIlegible }

        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        req.setValue("application/json", forHTTPHeaderField: "Accept")

        do {
            let (_, response) = try await session.data(for: req)
            guard let http = response as? HTTPURLResponse else { throw APIError.respuestaIlegible }
            // 2xx o 3xx: el Set-Cookie ya se ha aplicado al almacén.
            guard (200..<400).contains(http.statusCode) else {
                throw APIError.servidor(status: http.statusCode, detalle: nil)
            }
            return authCookieHeader() != nil
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.sinRed(underlying: error.localizedDescription)
        }
    }

    /// Cookies de Auth.js en formato cabecera, o `nil` si no hay sesión.
    ///
    /// Se filtran por prefijo en vez de por nombre exacto porque Auth.js cambia
    /// el nombre según el entorno: en HTTPS antepone `__Secure-`.
    nonisolated func authCookieHeader() -> String? {
        let url = APIClient.defaultBaseURL()
        guard let cookies = HTTPCookieStorage.shared.cookies(for: url), !cookies.isEmpty else {
            return nil
        }
        let relevantes = cookies.filter { c in
            c.name.contains("authjs.session-token")
                || c.name.contains("next-auth.session-token")
                || c.name.contains("app-gate")
        }
        guard !relevantes.isEmpty else { return nil }
        return relevantes.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
    }

    /// Comprueba si la cookie guardada sigue siendo válida en el servidor.
    func validarSesion() async -> Bool {
        let url = baseURL.appendingPathComponent("api/auth/session")
        var req = URLRequest(url: url)
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        guard let (data, response) = try? await session.data(for: req),
              let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            return false
        }
        // Auth.js devuelve `{}` cuando no hay sesión, no un 401.
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return false
        }
        return obj["user"] != nil
    }

    /// Email de la sesión activa, para enseñarlo en ajustes.
    func emailDeSesion() async -> String? {
        let url = baseURL.appendingPathComponent("api/auth/session")
        guard let (data, _) = try? await session.data(from: url),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let user = obj["user"] as? [String: Any] else { return nil }
        return user["email"] as? String
    }

    /// Borra todas las cookies del dominio. Sin esto, cerrar sesión dejaría la
    /// cookie viva y el siguiente inicio entraría con la cuenta anterior.
    nonisolated func limpiarCookies() {
        let store = HTTPCookieStorage.shared
        let url = APIClient.defaultBaseURL()
        store.cookies(for: url)?.forEach { store.deleteCookie($0) }
        if let host = url.host {
            store.cookies?
                .filter { $0.domain.contains(host) || host.contains($0.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))) }
                .forEach { store.deleteCookie($0) }
        }
    }
}
