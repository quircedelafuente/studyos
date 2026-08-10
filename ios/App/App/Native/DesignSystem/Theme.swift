import SwiftUI

// MARK: - Color desde hex

extension Color {
    /// `Color(hex: 0xFAFAFA)`. Espacio sRGB explícito: los tokens de la web son
    /// sRGB y con el espacio por defecto de SwiftUI (display P3) los grises se
    /// desplazan lo justo para que el negro puro deje de coincidir con el web view.
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}

// MARK: - Tokens

/// Los tokens CSS de `globals.css` (`:root` y `[data-theme="dark"]`).
public enum ThemeToken: String, CaseIterable, Sendable {
    case canvas
    case sidebar
    case surface
    case surfaceMuted
    case ink
    case inkMuted
    case inkFaint
    case border
    case borderStrong
    case accent
    /// Color legible ENCIMA de `ink` / `accent`, que se invierten entre temas.
    case onAccent
}

/// Una resolución concreta de todos los tokens para un `ColorScheme`.
public struct AppPalette: Sendable, Equatable {
    public let canvas: Color
    public let sidebar: Color
    public let surface: Color
    public let surfaceMuted: Color
    public let ink: Color
    public let inkMuted: Color
    public let inkFaint: Color
    public let border: Color
    public let borderStrong: Color
    public let accent: Color
    public let onAccent: Color
    /// Qué rama del tema es. La necesitan las tablas que no se pueden derivar de
    /// los tokens (la rampa de colores de evento tiene hex propios por tema).
    public let isDark: Bool

    public static let light = AppPalette(
        canvas: Color(hex: 0xFAFAFA),
        sidebar: Color(hex: 0xFFFFFF),
        surface: Color(hex: 0xFFFFFF),
        surfaceMuted: Color(hex: 0xF4F4F5),
        ink: Color(hex: 0x0A0A0A),
        inkMuted: Color(hex: 0x52525B),
        inkFaint: Color(hex: 0xA1A1AA),
        border: Color(hex: 0xE4E4E7),
        borderStrong: Color(hex: 0x18181B),
        accent: Color(hex: 0x0A0A0A),
        onAccent: Color(hex: 0xFFFFFF),
        isDark: false
    )

    /// Oscuro = negro puro. El lienzo es el tono más bajo y las superficies
    /// SUBEN (al revés que en claro, donde bajan), así las tarjetas destacan sin
    /// necesitar sombra.
    public static let dark = AppPalette(
        canvas: Color(hex: 0x000000),
        sidebar: Color(hex: 0x0A0A0A),
        surface: Color(hex: 0x101010),
        surfaceMuted: Color(hex: 0x1C1C1C),
        ink: Color(hex: 0xFAFAFA),
        inkMuted: Color(hex: 0xA3A3A3),
        inkFaint: Color(hex: 0x6B6B6B),
        border: Color(hex: 0x262626),
        borderStrong: Color(hex: 0x525252),
        accent: Color(hex: 0xFAFAFA),
        onAccent: Color(hex: 0x000000),
        isDark: true
    )

    /// Variante del calendario: negro plano hasta en las superficies, para que no
    /// aparezcan bandas grises entre la rejilla y el fondo (equivale a
    /// `[data-calendar-dark]` en la web).
    public static let darkCalendar = AppPalette(
        canvas: .black,
        sidebar: .black,
        surface: .black,
        surfaceMuted: .black,
        ink: Color(hex: 0xFFFFFF),
        inkMuted: Color(hex: 0xD4D4D4),
        inkFaint: Color(hex: 0x8A8A8A),
        border: Color(hex: 0x242424),
        borderStrong: Color(hex: 0x525252),
        accent: Color(hex: 0xFFFFFF),
        onAccent: .black,
        isDark: true
    )

    public static func forScheme(_ scheme: ColorScheme) -> AppPalette {
        scheme == .dark ? .dark : .light
    }

    public func color(_ token: ThemeToken) -> Color {
        switch token {
        case .canvas: canvas
        case .sidebar: sidebar
        case .surface: surface
        case .surfaceMuted: surfaceMuted
        case .ink: ink
        case .inkMuted: inkMuted
        case .inkFaint: inkFaint
        case .border: border
        case .borderStrong: borderStrong
        case .accent: accent
        case .onAccent: onAccent
        }
    }
}

// MARK: - Acceso estático por esquema

extension Color {
    public static func canvas(_ scheme: ColorScheme) -> Color { AppPalette.forScheme(scheme).canvas }
    public static func sidebar(_ scheme: ColorScheme) -> Color { AppPalette.forScheme(scheme).sidebar }
    public static func surface(_ scheme: ColorScheme) -> Color { AppPalette.forScheme(scheme).surface }
    public static func surfaceMuted(_ scheme: ColorScheme) -> Color { AppPalette.forScheme(scheme).surfaceMuted }
    public static func ink(_ scheme: ColorScheme) -> Color { AppPalette.forScheme(scheme).ink }
    public static func inkMuted(_ scheme: ColorScheme) -> Color { AppPalette.forScheme(scheme).inkMuted }
    public static func inkFaint(_ scheme: ColorScheme) -> Color { AppPalette.forScheme(scheme).inkFaint }
    public static func border(_ scheme: ColorScheme) -> Color { AppPalette.forScheme(scheme).border }
    public static func borderStrong(_ scheme: ColorScheme) -> Color { AppPalette.forScheme(scheme).borderStrong }
    public static func accent(_ scheme: ColorScheme) -> Color { AppPalette.forScheme(scheme).accent }
    public static func onAccent(_ scheme: ColorScheme) -> Color { AppPalette.forScheme(scheme).onAccent }
}

// MARK: - Token dinámico como ShapeStyle

/// Token que se resuelve solo contra el `colorScheme` del entorno.
///
/// SwiftUI no ofrece un `Color` dinámico sin catálogo de assets ni UIKit, pero
/// `ShapeStyle.resolve(in:)` (iOS 17) sí ve el entorno: con esto
/// `.foregroundStyle(.ink)` o `.background(.surface)` cambian de tema sin que
/// cada vista tenga que leer `@Environment(\.colorScheme)`.
public struct ThemeColor: ShapeStyle, Sendable {
    private let token: ThemeToken
    private let alpha: Double

    public init(_ token: ThemeToken, opacity: Double = 1) {
        self.token = token
        self.alpha = opacity
    }

    public func opacity(_ value: Double) -> ThemeColor {
        ThemeColor(token, opacity: alpha * value)
    }

    public func resolve(in environment: EnvironmentValues) -> Color.Resolved {
        environment.appPalette
            .color(token)
            .opacity(alpha)
            .resolve(in: environment)
    }
}

extension ShapeStyle where Self == ThemeColor {
    public static var canvas: ThemeColor { .init(.canvas) }
    public static var sidebar: ThemeColor { .init(.sidebar) }
    public static var surface: ThemeColor { .init(.surface) }
    public static var surfaceMuted: ThemeColor { .init(.surfaceMuted) }
    public static var ink: ThemeColor { .init(.ink) }
    public static var inkMuted: ThemeColor { .init(.inkMuted) }
    public static var inkFaint: ThemeColor { .init(.inkFaint) }
    public static var hairline: ThemeColor { .init(.border) }
    public static var borderStrong: ThemeColor { .init(.borderStrong) }
    public static var accent: ThemeColor { .init(.accent) }
    public static var onAccent: ThemeColor { .init(.onAccent) }
}

// MARK: - Paleta en el entorno

private struct AppPaletteKey: EnvironmentKey {
    static let defaultValue: AppPalette = .light
}

extension EnvironmentValues {
    public var appPalette: AppPalette {
        get { self[AppPaletteKey.self] }
        set { self[AppPaletteKey.self] = newValue }
    }
}

private struct StudyOSThemeModifier: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    let calendarVariant: Bool

    func body(content: Content) -> some View {
        let palette: AppPalette = colorScheme == .dark
            ? (calendarVariant ? .darkCalendar : .dark)
            : .light
        content
            .environment(\.appPalette, palette)
            .tint(palette.accent)
    }
}

extension View {
    /// Inyecta la paleta correspondiente al esquema actual. Va en la raíz de la
    /// app y, con `calendar: true`, en el subárbol del calendario.
    public func studyOSTheme(calendar: Bool = false) -> some View {
        modifier(StudyOSThemeModifier(calendarVariant: calendar))
    }

    /// Fondo de pantalla completo con el lienzo del tema.
    public func canvasBackground() -> some View {
        background(Rectangle().fill(ThemeColor(.canvas)).ignoresSafeArea())
    }
}

// MARK: - Métricas

/// Radios calcados de los que más aparecen en la web (Tailwind):
/// `rounded-xl` = 12, `rounded-2xl` = 16, `rounded-3xl` = 24.
public enum AppRadius {
    public static let small: CGFloat = 12
    public static let medium: CGFloat = 16
    public static let large: CGFloat = 24
    /// Alias semántico: las tarjetas grandes van al radio máximo.
    public static let card: CGFloat = large
}

public enum AppSpacing {
    public static let xs: CGFloat = 4
    public static let sm: CGFloat = 8
    public static let md: CGFloat = 12
    public static let lg: CGFloat = 16
    public static let xl: CGFloat = 24
    public static let xxl: CGFloat = 32
}

public enum AppMetrics {
    /// Los bordes de la web son 1px y su papel es separar, no dibujar; a 1pt en
    /// pantalla Retina se ven más gruesos que en el navegador, de ahí el 0.75.
    public static let hairline: CGFloat = 0.75
    public static let accentBar: CGFloat = 3
}

// MARK: - Tipografía

public enum AppFont {
    public static let sectionTitle = Font.system(size: 13, weight: .semibold)
    public static let cardTitle = Font.system(size: 17, weight: .semibold)
    public static let body = Font.system(size: 15, weight: .regular)
    public static let caption = Font.system(size: 12, weight: .medium)
    public static let pill = Font.system(size: 12, weight: .semibold)
    public static let mono = Font.system(size: 13, weight: .regular, design: .monospaced)
}
