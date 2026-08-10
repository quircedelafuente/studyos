import SwiftUI
import WebKit

// MARK: - Fallback web

/// Vista puente para las secciones que todavía no son nativas (NotebookLM,
/// Class Notes, Assignments/Blackboard): dependen de scraping o de IA en el
/// servidor, así que se muestran con la misma web de producción embebida.
///
/// Comparte el almacén de cookies **por defecto** de WebKit a propósito: es el
/// mismo que usa el WebView de Capacitor, de modo que la sesión de Auth.js ya
/// establecida vale aquí sin volver a autenticarse.
struct WebFallbackView: View {

    /// Ruta relativa dentro de la app web (por ejemplo `/`).
    let path: String
    /// `MainTabId` de la web. Viaja como `?tab=`; hoy la web ignora el
    /// parámetro (la pestaña vive en estado de React), pero es el sitio natural
    /// donde añadir el soporte y así el enlace ya queda escrito.
    let webTabId: String?

    @State private var isLoading = true
    @State private var failure: String?
    @State private var reloadToken = 0

    init(path: String = "/", webTabId: String? = nil) {
        self.path = path
        self.webTabId = webTabId
    }

    var body: some View {
        ZStack {
            if let failure {
                EmptyState(
                    systemImage: "wifi.exclamationmark",
                    title: "No se pudo cargar",
                    message: failure,
                    actionTitle: "Reintentar",
                    action: retry
                )
            } else {
                WebFallbackRepresentable(
                    url: url,
                    reloadToken: reloadToken,
                    onLoadingChanged: { isLoading = $0 },
                    onFailure: { failure = $0 }
                )
                .opacity(isLoading ? 0 : 1)

                if isLoading {
                    ProgressView()
                        .tint(ThemeColor(.inkFaint))
                }
            }
        }
        .canvasBackground()
    }

    private func retry() {
        failure = nil
        isLoading = true
        reloadToken += 1
    }

    private var url: URL {
        var components = URLComponents(
            url: WebFallbackEnvironment.baseURL.appending(path: path),
            resolvingAgainstBaseURL: false
        )
        if let webTabId {
            components?.queryItems = [URLQueryItem(name: "tab", value: webTabId)]
        }
        return components?.url ?? WebFallbackEnvironment.baseURL
    }
}

// MARK: - Entorno

enum WebFallbackEnvironment {
    /// Misma resolución que `SyncStore`: `StudyOSBaseURL` del Info.plist y, si
    /// no está, el dominio de producción.
    static let baseURL: URL = {
        let configured = Bundle.main.object(forInfoDictionaryKey: "StudyOSBaseURL") as? String
        return configured.flatMap(URL.init(string:))
            ?? URL(string: "https://studyos-delta.vercel.app")!
    }()
}

// MARK: - Puente a WKWebView

/// UIKit aquí es inevitable: no existe equivalente SwiftUI de `WKWebView`.
private struct WebFallbackRepresentable: UIViewRepresentable {

    let url: URL
    let reloadToken: Int
    let onLoadingChanged: (Bool) -> Void
    let onFailure: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onLoadingChanged: onLoadingChanged, onFailure: onFailure)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        // Sin fondo opaco propio: el lienzo del tema se ve por detrás mientras
        // carga y no aparece el fogonazo blanco entre navegaciones.
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // Solo se recarga cuando cambia la URL o el usuario pide reintentar:
        // `updateUIView` se llama en cada redibujado y recargar siempre dejaría
        // la página en un bucle de carga.
        if context.coordinator.loadedURL != url || context.coordinator.reloadToken != reloadToken {
            context.coordinator.loadedURL = url
            context.coordinator.reloadToken = reloadToken
            webView.load(URLRequest(url: url))
        }
    }

    /// Sin `@MainActor` a propósito: WebKit ya invoca al delegado en el hilo
    /// principal, y anotarlo choca con la aislación que el SDK declara en
    /// `WKNavigationDelegate` según la versión de Xcode.
    final class Coordinator: NSObject, WKNavigationDelegate {
        var loadedURL: URL?
        var reloadToken = 0

        private let onLoadingChanged: (Bool) -> Void
        private let onFailure: (String) -> Void

        init(onLoadingChanged: @escaping (Bool) -> Void, onFailure: @escaping (String) -> Void) {
            self.onLoadingChanged = onLoadingChanged
            self.onFailure = onFailure
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            onLoadingChanged(true)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            onLoadingChanged(false)
        }

        func webView(
            _ webView: WKWebView,
            didFail navigation: WKNavigation!,
            withError error: any Error
        ) {
            report(error)
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: any Error
        ) {
            report(error)
        }

        private func report(_ error: any Error) {
            onLoadingChanged(false)
            // -999 es "cancelada": pasa en cada navegación encadenada y no es
            // un error que deba ver el usuario.
            if (error as NSError).code == NSURLErrorCancelled { return }
            onFailure(error.localizedDescription)
        }
    }
}
