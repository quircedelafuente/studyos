import SwiftUI

// MARK: - Contrato con AppSession
//
// El armazón solo usa estos cinco miembros de `AppSession` (que escribe el
// módulo de autenticación). Si allí cambia algún nombre, este fichero es el
// único sitio que hay que tocar:
//
//   @Published var isAuthenticated: Bool
//   func start() async                 // restaura sesión guardada y deja la
//                                      // cookie en SyncStore.setAuthCookieHeader
//   func signIn() async                // abre el flujo OAuth (SFSafariViewController)
//   func signOut() async
//   func handleOpenURL(_ url: URL)     // iestudio://auth-callback?tok=…

// MARK: - Pestañas

/// Secciones nativas. `webTabId` es el `MainTabId` equivalente de la web
/// (`src/types/dashboard.ts`), que usa el fallback embebido.
enum AppTab: String, CaseIterable, Identifiable, Sendable {
    case dashboard
    case calendario
    case fechas
    case tareas
    case habitos
    case arena

    var id: String { rawValue }

    var title: String {
        switch self {
        case .dashboard: "Dashboard"
        case .calendario: "Calendario"
        case .fechas: "Fechas"
        case .tareas: "Tareas"
        case .habitos: "Hábitos"
        case .arena: "Arena"
        }
    }

    var systemImage: String {
        switch self {
        case .dashboard: "square.grid.2x2"
        case .calendario: "calendar"
        case .fechas: "calendar.badge.exclamationmark"
        case .tareas: "checklist"
        case .habitos: "flame"
        case .arena: "timer"
        }
    }

    var webTabId: String {
        switch self {
        case .dashboard: "dashboard"
        case .calendario: "calendario"
        case .fechas: "fechas"
        case .tareas: "daily-tasks"
        case .habitos: "habits"
        case .arena: "study-arena"
        }
    }

    /// Nombre alternativo aceptado en los enlaces `iestudio://`, para poder
    /// abrir la app con el mismo id que usa la web.
    static func from(identifier raw: String) -> AppTab? {
        let key = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if let direct = AppTab(rawValue: key) { return direct }
        return AppTab.allCases.first { $0.webTabId == key }
    }
}

// MARK: - App

@main
@MainActor
struct IEStudioApp: App {

    @StateObject private var session = AppSession()
    @StateObject private var theme = ThemeWatcher()

    @Environment(\.scenePhase) private var scenePhase

    @State private var selection: AppTab = .dashboard
    @State private var didBootstrap = false

    var body: some Scene {
        WindowGroup {
            RootView(selection: $selection, didBootstrap: didBootstrap)
                .environmentObject(session)
                .studyOSTheme()
                .preferredColorScheme(theme.preferredColorScheme)
                .task { await bootstrap() }
                // En su propia tarea: `ThemeWatcher.start()` se queda
                // escuchando cambios y no vuelve nunca.
                .task { await theme.start() }
                .onOpenURL { open($0) }
                .onChange(of: scenePhase) { _, phase in
                    handle(phase: phase)
                }
        }
    }

    // MARK: Arranque y ciclo de vida

    private func bootstrap() async {
        guard !didBootstrap else { return }
        // La sesión va primero: hasta que no deja la cookie en SyncStore, el
        // GET de sincronización contestaría 401 y marcaría `.unauthorized`.
        await session.start()
        didBootstrap = true
        // Primero lo que hayan marcado los widgets interactivos: si se hiciera
        // después del refresh, la descarga lo sobrescribiría.
        await WidgetDataService.reconcileFromWidgets()
        await SyncStore.shared.refresh()
        await WidgetDataService.rebuild()
    }

    private func handle(phase: ScenePhase) {
        switch phase {
        case .active:
            // Al volver de segundo plano puede haber cambios hechos en el
            // portátil; el GET es condicional, así que un 304 no cuesta nada.
            guard didBootstrap else { return }
            Task { await SyncStore.shared.refresh(); await WidgetDataService.rebuild() }
        case .background:
            // Se sube lo pendiente y se vuelca a disco antes de que el sistema
            // pueda matar el proceso: `flush` solo no persiste lo no confirmado.
            Task {
                await SyncStore.shared.flush()
                await SyncStore.shared.persistNow()
            }
        default:
            break
        }
    }

    // MARK: Esquema iestudio://

    /// Rutas admitidas:
    /// - `iestudio://auth-callback?tok=…`  → lo resuelve `AppSession`.
    /// - `iestudio://open?tab=fechas`, `iestudio://tab/fechas`, `iestudio://fechas`
    ///   → selecciona esa pestaña.
    private func open(_ url: URL) {
        guard url.scheme?.lowercased() == "iestudio" else { return }
        let host = url.host()?.lowercased() ?? ""

        if host == "auth-callback" {
            session.handleOpenURL(url)
            return
        }

        if let tab = requestedTab(in: url, host: host) {
            selection = tab
        }
    }

    private func requestedTab(in url: URL, host: String) -> AppTab? {
        if let direct = AppTab.from(identifier: host) { return direct }
        guard host == "open" || host == "tab" else { return nil }

        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        if let value = components?.queryItems?.first(where: { $0.name == "tab" })?.value,
           let tab = AppTab.from(identifier: value) {
            return tab
        }
        // `iestudio://tab/fechas`: el id viaja como primer segmento de ruta.
        if let segment = url.pathComponents.first(where: { $0 != "/" }) {
            return AppTab.from(identifier: segment)
        }
        return nil
    }
}

// MARK: - Raíz

@MainActor
private struct RootView: View {

    @EnvironmentObject private var session: AppSession
    @Binding var selection: AppTab
    let didBootstrap: Bool

    var body: some View {
        Group {
            if !didBootstrap {
                LaunchView()
            } else if session.isAuthenticated {
                MainTabsView(selection: $selection)
            } else {
                LoginView()
            }
        }
        // Sin la animación el cambio de sesión hace saltar la interfaz entera
        // de golpe, que se lee como un fallo y no como una transición.
        .animation(.easeInOut(duration: 0.2), value: session.isAuthenticated)
        .animation(.easeInOut(duration: 0.2), value: didBootstrap)
    }
}

// MARK: - Pestañas

@MainActor
private struct MainTabsView: View {

    @EnvironmentObject private var session: AppSession
    @Binding var selection: AppTab

    var body: some View {
        TabView(selection: $selection) {
            ForEach(AppTab.allCases) { tab in
                NavigationStack {
                    content(for: tab)
                        .navigationTitle(tab.title)
                        .navigationBarTitleDisplayMode(tab == .dashboard ? .large : .inline)
                        .toolbar { accountMenu }
                        .canvasBackground()
                }
                .tabItem { Label(tab.title, systemImage: tab.systemImage) }
                .tag(tab)
            }
        }
    }

    @ViewBuilder
    private func content(for tab: AppTab) -> some View {
        switch tab {
        case .dashboard:
            DashboardView(onSelectTab: { selection = $0 })

        // INTEGRACIÓN: cada `PendingTab` se sustituye por su vista nativa
        // (una línea por pestaña) en cuanto exista. Mientras tanto cae en la
        // web embebida, que es lo que la app hacía entera hasta ahora.
        case .calendario:
            PendingTab(tab: tab)
        case .fechas:
            PendingTab(tab: tab)
        case .tareas:
            PendingTab(tab: tab)
        case .habitos:
            PendingTab(tab: tab)
        case .arena:
            PendingTab(tab: tab)
        }
    }

    @ToolbarContentBuilder
    private var accountMenu: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                Button {
                    Task { await SyncStore.shared.refresh(); await WidgetDataService.rebuild() }
                } label: {
                    Label("Sincronizar ahora", systemImage: "arrow.triangle.2.circlepath")
                }
                Divider()
                Button(role: .destructive) {
                    Task { await session.signOut() }
                } label: {
                    Label("Cerrar sesión", systemImage: "rectangle.portrait.and.arrow.right")
                }
            } label: {
                Image(systemName: "person.crop.circle")
                    .foregroundStyle(ThemeColor(.ink))
            }
        }
    }
}

/// Pestaña sin vista nativa todavía: enseña la web dentro de la app.
private struct PendingTab: View {
    let tab: AppTab

    var body: some View {
        WebFallbackView(webTabId: tab.webTabId)
    }
}

// MARK: - Arranque

private struct LaunchView: View {
    var body: some View {
        VStack(spacing: AppSpacing.lg) {
            Image(systemName: "graduationcap.fill")
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(ThemeColor(.ink))
            ProgressView()
                .tint(ThemeColor(.inkFaint))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .canvasBackground()
    }
}

// MARK: - Login

@MainActor
private struct LoginView: View {

    @EnvironmentObject private var session: AppSession
    @State private var isSigningIn = false

    var body: some View {
        VStack(spacing: AppSpacing.xxl) {
            Spacer(minLength: 0)

            VStack(spacing: AppSpacing.md) {
                Image(systemName: "graduationcap.fill")
                    .font(.system(size: 34, weight: .light))
                    .foregroundStyle(ThemeColor(.onAccent))
                    .frame(width: 76, height: 76)
                    .background(
                        RoundedRectangle(cornerRadius: AppRadius.large, style: .continuous)
                            .fill(ThemeColor(.accent))
                    )

                Text("IEStudio")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(ThemeColor(.ink))

                Text("Tu calendario, tus entregas y tus hábitos, sincronizados en todos tus dispositivos.")
                    .font(AppFont.body)
                    .foregroundStyle(ThemeColor(.inkMuted))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, AppSpacing.lg)
            }

            Spacer(minLength: 0)

            VStack(spacing: AppSpacing.md) {
                Button {
                    guard !isSigningIn else { return }
                    isSigningIn = true
                    Task {
                        await session.signIn()
                        isSigningIn = false
                    }
                } label: {
                    HStack(spacing: AppSpacing.sm) {
                        if isSigningIn {
                            ProgressView().tint(ThemeColor(.onAccent))
                        } else {
                            Image(systemName: "person.badge.key.fill")
                        }
                        Text(isSigningIn ? "Abriendo Google…" : "Continuar con Google")
                            .font(.system(size: 16, weight: .semibold))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, AppSpacing.lg)
                    .foregroundStyle(ThemeColor(.onAccent))
                    .background(
                        RoundedRectangle(cornerRadius: AppRadius.medium, style: .continuous)
                            .fill(ThemeColor(.accent))
                    )
                }
                .buttonStyle(.plain)
                .disabled(isSigningIn)

                Text("El inicio de sesión se abre en Safari y vuelve a la app al terminar.")
                    .font(AppFont.caption)
                    .foregroundStyle(ThemeColor(.inkFaint))
                    .multilineTextAlignment(.center)
            }
        }
        .padding(AppSpacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .canvasBackground()
    }
}

// MARK: - Tema

/// Sigue la preferencia guardada en `iestudio-theme`, que se sincroniza con la
/// web: el tema elegido en el portátil llega al teléfono sin tocar nada.
@MainActor
private final class ThemeWatcher: ObservableObject {

    @Published private(set) var preference: String = "system"

    var preferredColorScheme: ColorScheme? {
        switch preference {
        case "dark": .dark
        case "light": .light
        default: nil   // "system": manda el ajuste de iOS
        }
    }

    func start() async {
        await reload()
        for await keys in SyncBus.shared.changes() {
            guard keys.contains(StorageKeys.theme) || keys.contains("*") else { continue }
            await reload()
        }
    }

    private func reload() async {
        let raw = await SyncStore.shared.decoded(String.self, forKey: StorageKeys.theme)
        let value = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "system"
        preference = ["light", "dark", "system"].contains(value) ? value : "system"
    }
}
