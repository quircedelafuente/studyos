import AuthenticationServices
import SwiftUI

/// Estado de autenticación y punto de entrada del login.
///
/// Implementa el contrato que documenta `IEStudioApp.swift`: `isAuthenticated`,
/// `start()`, `signIn()`, `signOut()` y `handleOpenURL(_:)`.
///
/// El flujo OAuth reutiliza los endpoints que ya existían para la app de
/// Capacitor, pero **sin WebView**: `ASWebAuthenticationSession` abre Safari,
/// devuelve `iestudio://auth-callback?tok=…` y el token se canjea por la cookie
/// de sesión. Nativo de principio a fin.
@MainActor
final class AppSession: NSObject, ObservableObject {
    enum Estado: Equatable, Sendable {
        case desconocido
        case anonimo
        case autenticado(email: String?)
    }

    @Published private(set) var estado: Estado = .desconocido
    @Published private(set) var iniciandoSesion = false
    @Published var ultimoError: String?

    var isAuthenticated: Bool {
        if case .autenticado = estado { return true }
        return false
    }

    var email: String? {
        if case .autenticado(let e) = estado { return e }
        return nil
    }

    private let api: APIClient
    private var pendingContinuation: CheckedContinuation<URL, Error>?

    init(api: APIClient = .shared) {
        self.api = api
        super.init()
    }

    // MARK: - Arranque

    /// Restaura la sesión guardada y deja la cookie a disposición de `SyncStore`.
    func start() async {
        await aplicarCookieAlStore()

        // Si no hay cookie no hace falta molestar a la red.
        guard api.authCookieHeader() != nil else {
            estado = .anonimo
            return
        }

        let valida = await api.validarSesion()
        if valida {
            estado = .autenticado(email: await api.emailDeSesion())
        } else {
            // La cookie existe pero el servidor ya no la acepta: limpiar evita
            // que cada arranque repita esta comprobación fallida.
            api.limpiarCookies()
            await SyncStore.shared.setAuthCookieHeader(nil)
            estado = .anonimo
        }
    }

    // MARK: - Login

    func signIn() async {
        guard !iniciandoSesion else { return }
        iniciandoSesion = true
        ultimoError = nil
        defer { iniciandoSesion = false }

        do {
            let callbackURL = try await autenticarEnSafari()
            try await canjear(callbackURL)
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            // Cancelar no es un fallo: no se enseña error.
            return
        } catch {
            ultimoError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    /// Abre el flujo en Safari y espera al callback del esquema `iestudio`.
    private func autenticarEnSafari() async throws -> URL {
        let start = await api.baseURL.appendingPathComponent("api/auth/mobile-start")

        return try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: start,
                callbackURLScheme: "iestudio"
            ) { url, error in
                if let error { continuation.resume(throwing: error) }
                else if let url { continuation.resume(returning: url) }
                else { continuation.resume(throwing: APIError.respuestaIlegible) }
            }
            session.presentationContextProvider = self
            // Cuenta ya iniciada en Safari: sin esto pediría credenciales de nuevo.
            session.prefersEphemeralWebBrowserSession = false
            if !session.start() {
                continuation.resume(throwing: APIError.sinRed(underlying: "no se pudo abrir Safari"))
            }
        }
    }

    /// Extrae `tok` del callback y lo cambia por la cookie de sesión.
    private func canjear(_ url: URL) async throws {
        guard
            let comps = URLComponents(url: url, resolvingAgainstBaseURL: false),
            let token = comps.queryItems?.first(where: { $0.name == "tok" })?.value,
            !token.isEmpty
        else {
            throw APIError.noAutenticado
        }

        let ok = try await api.exchangeSessionToken(token)
        guard ok else { throw APIError.noAutenticado }

        await aplicarCookieAlStore()
        estado = .autenticado(email: await api.emailDeSesion())

        // Primera descarga en cuanto hay sesión, para no abrir la app vacía.
        await SyncStore.shared.refresh()
    }

    /// Ruta alternativa: el sistema entrega el callback por `onOpenURL`.
    ///
    /// `ASWebAuthenticationSession` normalmente lo captura él, pero si Safari se
    /// abre fuera de la sesión (por ejemplo tras un cambio de app) el enlace
    /// llega por aquí y hay que atenderlo igual.
    func handleOpenURL(_ url: URL) {
        guard url.scheme == "iestudio", url.host == "auth-callback" else { return }
        Task { [weak self] in
            guard let self else { return }
            do {
                try await self.canjear(url)
            } catch {
                self.ultimoError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    // MARK: - Logout

    func signOut() async {
        api.limpiarCookies()
        await SyncStore.shared.setAuthCookieHeader(nil)
        // Vaciar el store: sin esto, otro usuario vería los datos del anterior
        // hasta que terminara la primera descarga.
        await SyncStore.shared.reset()
        estado = .anonimo
    }

    // MARK: - Privado

    private func aplicarCookieAlStore() async {
        await SyncStore.shared.setAuthCookieHeader(api.authCookieHeader())
    }
}

// MARK: - Presentación de la hoja de Safari

extension AppSession: ASWebAuthenticationPresentationContextProviding {
    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let escena = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .first { $0.activationState == .foregroundActive }
            return escena?.keyWindow ?? ASPresentationAnchor()
        }
    }
}
