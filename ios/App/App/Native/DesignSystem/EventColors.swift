import SwiftUI

// MARK: - Estilo de un color de evento

/// Equivale a `GoogleEventColorStyle` de `src/lib/google-calendar-event-colors.ts`.
public struct EventColorStyle: Sendable, Equatable {
    /// Fondo suave del bloque.
    public let background: Color
    /// Borde general (en la web es el color base con alfa).
    public let border: Color
    /// Barra de acento del lado izquierdo: el color «puro», sin atenuar.
    public let borderLeft: Color
    /// Texto principal.
    public let text: Color
    /// Texto secundario (la hora en los chips del calendario).
    public let textMuted: Color

    public init(
        background: Color,
        border: Color,
        borderLeft: Color,
        text: Color,
        textMuted: Color
    ) {
        self.background = background
        self.border = border
        self.borderLeft = borderLeft
        self.text = text
        self.textMuted = textMuted
    }
}

// MARK: - Tabla de la paleta

/// Fila cruda de la paleta. Se guarda en hex + alfa (en vez de `Color` ya
/// construido) porque la web define los bordes como `rgba(base, alfa)` y así la
/// correspondencia con el CSS es literal y revisable.
private struct EventColorSpec: Sendable {
    let bg: UInt32
    let borderBase: UInt32
    let borderAlpha: Double
    let borderLeft: UInt32
    let text: UInt32
    let textMuted: UInt32

    func style() -> EventColorStyle {
        EventColorStyle(
            background: Color(hex: bg),
            border: Color(hex: borderBase, opacity: borderAlpha),
            borderLeft: Color(hex: borderLeft),
            text: Color(hex: text),
            textMuted: Color(hex: textMuted)
        )
    }
}

public enum EventColors {

    // MARK: Ids

    /// Los únicos que acepta la API de Google.
    public static let googleIds: [String] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]

    /// Colores propios de la app. **Solo valen para eventos locales** («Exámenes
    /// y fechas»): si se mandaran a Google, se perderían en silencio al guardar.
    public static let localOnlyIds: [String] = ["12", "13", "14", "15", "16", "17"]

    /// Orden de la rueda de color al crear un deadline local.
    public static let deadlineIds: [String] = googleIds + localOnlyIds

    /// Fucsia. Preseleccionado al crear un deadline.
    public static let defaultDeadlineColorId = "12"

    /// Neutro. Es el de los eventos que llegan de Google **sin** `colorId`, que
    /// son la mayoría de los sincronizados.
    public static let defaultColorId = "18"

    // MARK: Ramas claro / oscuro

    /// Valores por defecto del CSS (`--evc-N-*` sin sobrescribir), tema claro.
    private static let light: [String: EventColorSpec] = [
        "1": .init(bg: 0xE8F0FE, borderBase: 0x1A73E8, borderAlpha: 0.35, borderLeft: 0x1A73E8, text: 0x174EA6, textMuted: 0x1967D2),
        "2": .init(bg: 0xE6F4EA, borderBase: 0x34A853, borderAlpha: 0.35, borderLeft: 0x0F9D58, text: 0x137333, textMuted: 0x188038),
        "3": .init(bg: 0xF3E8FD, borderBase: 0x8E44AD, borderAlpha: 0.35, borderLeft: 0xA142F4, text: 0x6A1B9A, textMuted: 0x8430CE),
        "4": .init(bg: 0xFCE8E6, borderBase: 0xEA4335, borderAlpha: 0.35, borderLeft: 0xEA4335, text: 0xC5221F, textMuted: 0xD93025),
        "5": .init(bg: 0xFEF7E0, borderBase: 0xFBBC04, borderAlpha: 0.45, borderLeft: 0xF9AB00, text: 0xB06000, textMuted: 0xE37400),
        "6": .init(bg: 0xFFF3E0, borderBase: 0xF57C00, borderAlpha: 0.40, borderLeft: 0xF4511E, text: 0xB53D00, textMuted: 0xE65100),
        "7": .init(bg: 0xE0F7FA, borderBase: 0x0097A7, borderAlpha: 0.35, borderLeft: 0x00838F, text: 0x006064, textMuted: 0x00838F),
        "8": .init(bg: 0xF1F3F4, borderBase: 0x5F6368, borderAlpha: 0.35, borderLeft: 0x5F6368, text: 0x3C4043, textMuted: 0x5F6368),
        "9": .init(bg: 0xE8F0FE, borderBase: 0x4285F4, borderAlpha: 0.40, borderLeft: 0x4285F4, text: 0x185ABC, textMuted: 0x1A73E8),
        "10": .init(bg: 0xE6F4EA, borderBase: 0x34A853, borderAlpha: 0.40, borderLeft: 0x34A853, text: 0x0D652D, textMuted: 0x188038),
        "11": .init(bg: 0xFCE8E6, borderBase: 0xDB4437, borderAlpha: 0.40, borderLeft: 0xDB4437, text: 0xA50E0E, textMuted: 0xC5221F),
        "12": .init(bg: 0xFEE7FA, borderBase: 0xF700D1, borderAlpha: 0.45, borderLeft: 0xF700D1, text: 0xC700A8, textMuted: 0xF000CB),
        "13": .init(bg: 0xE7F2FE, borderBase: 0x027FF7, borderAlpha: 0.45, borderLeft: 0x027FF7, text: 0x0268CA, textMuted: 0x027DF3),
        "14": .init(bg: 0xF4FEE7, borderBase: 0x92F705, borderAlpha: 0.45, borderLeft: 0x92F705, text: 0x4A7D03, textMuted: 0x62A503),
        "15": .init(bg: 0xF6E7FE, borderBase: 0xB130F7, borderAlpha: 0.45, borderLeft: 0xB130F7, text: 0x8208C4, textMuted: 0x9C09EC),
        "16": .init(bg: 0xE7FEF8, borderBase: 0x00F6BD, borderAlpha: 0.45, borderLeft: 0x00F6BD, text: 0x008062, textMuted: 0x00A881),
        "17": .init(bg: 0xFEF7E7, borderBase: 0xF7AD02, borderAlpha: 0.45, borderLeft: 0xF7AD02, text: 0x936701, textMuted: 0xBB8302),
    ]

    /// Rampa oscura (`calendar-colors-dark.css`). No es el claro con opacidad: el
    /// fondo baja a un tinte casi negro y el texto SUBE de luminosidad, porque
    /// sobre negro el texto oscuro del tema claro sería ilegible.
    private static let dark: [String: EventColorSpec] = [
        "1": .init(bg: 0x111E2E, borderBase: 0x1A73E8, borderAlpha: 0.55, borderLeft: 0x1A73E8, text: 0x3885EB, textMuted: 0x66A1F0),
        "2": .init(bg: 0x10241A, borderBase: 0x0F9D58, borderAlpha: 0.55, borderLeft: 0x0F9D58, text: 0x2EEB8F, textMuted: 0x5CEFA8),
        "3": .init(bg: 0x241730, borderBase: 0xA142F4, borderAlpha: 0.55, borderLeft: 0xA142F4, text: 0xAE5BF5, textMuted: 0xC58BF8),
        "4": .init(bg: 0x2F1715, borderBase: 0xEA4335, borderAlpha: 0.55, borderLeft: 0xEA4335, text: 0xEB4F42, textMuted: 0xF07A70),
        "5": .init(bg: 0x31260E, borderBase: 0xF9AB00, borderAlpha: 0.55, borderLeft: 0xF9AB00, text: 0xFFB71A, textMuted: 0xFFC74D),
        "6": .init(bg: 0x301912, borderBase: 0xF4511E, borderAlpha: 0.55, borderLeft: 0xF4511E, text: 0xF45624, textMuted: 0xF77B55),
        "7": .init(bg: 0x0E2022, borderBase: 0x00838F, borderAlpha: 0.55, borderLeft: 0x00838F, text: 0x1AECFF, textMuted: 0x4DF0FF),
        "8": .init(bg: 0x1B1C1C, borderBase: 0x5F6368, borderAlpha: 0.55, borderLeft: 0x5F6368, text: 0x878C91, textMuted: 0xA2A5AA),
        "9": .init(bg: 0x172030, borderBase: 0x4285F4, borderAlpha: 0.55, borderLeft: 0x4285F4, text: 0x4386F4, textMuted: 0x73A5F7),
        "10": .init(bg: 0x152519, borderBase: 0x34A853, borderAlpha: 0.55, borderLeft: 0x34A853, text: 0x50C970, textMuted: 0x77D590),
        "11": .init(bg: 0x2C1715, borderBase: 0xDB4437, borderAlpha: 0.55, borderLeft: 0xDB4437, text: 0xDF594E, textMuted: 0xE78279),
        "12": .init(bg: 0x300E2B, borderBase: 0xF700D1, borderAlpha: 0.55, borderLeft: 0xF700D1, text: 0xFF1ADC, textMuted: 0xFF4DE4),
        "13": .init(bg: 0x0E2030, borderBase: 0x027FF7, borderAlpha: 0.55, borderLeft: 0x027FF7, text: 0x1B8FFD, textMuted: 0x4EA8FE),
        "14": .init(bg: 0x22300E, borderBase: 0x92F705, borderAlpha: 0.55, borderLeft: 0x92F705, text: 0x9EFA1E, textMuted: 0xB4FB50),
        "15": .init(bg: 0x271430, borderBase: 0xB130F7, borderAlpha: 0.55, borderLeft: 0xB130F7, text: 0xBC4EF8, textMuted: 0xCF7FFA),
        "16": .init(bg: 0x0E3028, borderBase: 0x00F6BD, borderAlpha: 0.55, borderLeft: 0x00F6BD, text: 0x1AFFCA, textMuted: 0x4DFFD6),
        "17": .init(bg: 0x30260E, borderBase: 0xF7AD02, borderAlpha: 0.55, borderLeft: 0xF7AD02, text: 0xFDB91B, textMuted: 0xFEC94E),
    ]

    // MARK: Resolución

    /// Cualquier id desconocido, vacío o nulo cae en el neutro. Los datos llevan
    /// meses acumulándose y hay eventos con `colorId` de calendarios ajenos.
    public static func normalize(_ colorId: String?) -> String {
        guard let raw = colorId?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else {
            return defaultColorId
        }
        if raw == defaultColorId || light[raw] != nil { return raw }
        return defaultColorId
    }

    /// Estilo completo de un `colorId` contra una paleta ya resuelta.
    public static func style(for colorId: String?, palette: AppPalette) -> EventColorStyle {
        let id = normalize(colorId)
        // El "18" no tiene hex propio: se apoya en los tokens del tema, así que en
        // claro es pastilla blanca sobre gris y en oscuro (y dentro del
        // calendario, donde `surface` es negro puro) pastilla negra con trazo blanco.
        guard id != defaultColorId else {
            return EventColorStyle(
                background: palette.surface,
                border: palette.border,
                borderLeft: palette.ink,
                text: palette.ink,
                textMuted: palette.inkMuted
            )
        }
        let table = palette.isDark ? dark : light
        guard let spec = table[id] else {
            return style(for: defaultColorId, palette: palette)
        }
        return spec.style()
    }

    public static func style(for colorId: String?, scheme: ColorScheme) -> EventColorStyle {
        style(for: colorId, palette: .forScheme(scheme))
    }

    /// Atajo para pintar un chip: fondo, borde y texto de un `colorId`.
    public static func triplet(
        for colorId: String?,
        palette: AppPalette
    ) -> (background: Color, border: Color, text: Color) {
        let s = style(for: colorId, palette: palette)
        return (s.background, s.border, s.text)
    }

    /// Color sólido para las muestras del selector, donde no hay fondo suave que
    /// mirar: es el acento puro, idéntico en claro y oscuro salvo el neutro.
    public static func swatch(for colorId: String?, palette: AppPalette) -> Color {
        style(for: colorId, palette: palette).borderLeft
    }

    /// Nombres en español, como en `GOOGLE_EVENT_COLOR_LABELS`.
    public static let labels: [String: String] = [
        "1": "Azul",
        "2": "Verde",
        "3": "Morado",
        "4": "Coral",
        "5": "Amarillo",
        "6": "Naranja",
        "7": "Turquesa",
        "8": "Gris",
        "9": "Azul intenso",
        "10": "Verde bosque",
        "11": "Rojo",
        "12": "Fucsia",
        "13": "Azul eléctrico",
        "14": "Verde lima",
        "15": "Violeta",
        "16": "Aguamarina",
        "17": "Ámbar",
        "18": "Neutro",
    ]

    public static func label(for colorId: String?) -> String {
        labels[normalize(colorId)] ?? "Neutro"
    }
}

// MARK: - Ayudas de vista

extension View {
    /// Pinta el fondo, el borde y la barra de acento de un chip de evento, igual
    /// que la web: fondo suave, trazo fino y barra de 3pt a la izquierda.
    public func eventChipBackground(
        _ style: EventColorStyle,
        radius: CGFloat = AppRadius.small,
        showsAccentBar: Bool = true
    ) -> some View {
        background {
            ZStack(alignment: .leading) {
                style.background
                if showsAccentBar {
                    Rectangle()
                        .fill(style.borderLeft)
                        .frame(width: AppMetrics.accentBar)
                }
            }
            // El recorte va en el conjunto, no en la barra: recortarla por
            // separado con este radio se la comería entera (radio > 3pt de ancho).
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(style.border, lineWidth: AppMetrics.hairline)
            }
        }
    }
}
