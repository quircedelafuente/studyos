import SwiftUI

// MARK: - Card

/// Contenedor base: superficie del tema, trazo fino y esquinas redondeadas.
///
/// Es el equivalente de las tarjetas de la web (`bg-[var(--surface)]` +
/// `border-[var(--border)]` + `rounded-2xl/3xl`). En oscuro no lleva sombra a
/// propósito: sobre negro no se ve nada, la jerarquía la da la superficie, que
/// sube de tono mientras el lienzo se queda en negro puro.
public struct Card<Content: View>: View {
    private let padding: CGFloat
    private let radius: CGFloat
    private let bordered: Bool
    private let content: Content

    public init(
        padding: CGFloat = AppSpacing.lg,
        radius: CGFloat = AppRadius.card,
        bordered: Bool = true,
        @ViewBuilder content: () -> Content
    ) {
        self.padding = padding
        self.radius = radius
        self.bordered = bordered
        self.content = content()
    }

    public var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(ThemeColor(.surface))
            )
            .overlay {
                if bordered {
                    RoundedRectangle(cornerRadius: radius, style: .continuous)
                        .strokeBorder(ThemeColor(.border), lineWidth: AppMetrics.hairline)
                }
            }
            // Recorta lo que se salga (listas, imágenes) al radio de la tarjeta.
            .contentShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
    }
}

// MARK: - SectionHeader

/// Cabecera de sección: rótulo en versalitas y, opcionalmente, un accesorio a la
/// derecha (un botón «Ver todo», un contador…).
public struct SectionHeader<Accessory: View>: View {
    private let title: String
    private let subtitle: String?
    private let accessory: Accessory

    public init(
        _ title: String,
        subtitle: String? = nil,
        @ViewBuilder accessory: () -> Accessory
    ) {
        self.title = title
        self.subtitle = subtitle
        self.accessory = accessory()
    }

    public var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: AppSpacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(AppFont.sectionTitle)
                    .textCase(.uppercase)
                    // La web usa `uppercase tracking-wide`; sin el interletraje
                    // las versalitas se apelmazan.
                    .kerning(0.8)
                    .foregroundStyle(ThemeColor(.inkMuted))
                if let subtitle {
                    Text(subtitle)
                        .font(AppFont.caption)
                        .foregroundStyle(ThemeColor(.inkFaint))
                }
            }
            Spacer(minLength: AppSpacing.sm)
            accessory
        }
        .accessibilityElement(children: .combine)
    }
}

extension SectionHeader where Accessory == EmptyView {
    public init(_ title: String, subtitle: String? = nil) {
        self.init(title, subtitle: subtitle) { EmptyView() }
    }
}

// MARK: - Pill

/// Pastilla compacta para etiquetas, estados y contadores.
public struct Pill: View {
    /// Cómo se colorea. `color(_:)` la ata a la paleta de eventos, de modo que
    /// una etiqueta de asignatura se ve igual que su chip en el calendario.
    public enum Style: Sendable, Equatable {
        /// Gris del tema: fondo `surfaceMuted`, texto `inkMuted`.
        case neutral
        /// Inversa (fondo tinta, texto `onAccent`), como el ítem activo del menú.
        case solid
        /// Solo trazo, sin relleno.
        case outline
        /// Un `colorId` de la paleta de eventos ("1"…"18").
        case color(String)
    }

    private let text: String
    private let systemImage: String?
    private let style: Style

    @Environment(\.appPalette) private var palette

    public init(_ text: String, systemImage: String? = nil, style: Style = .neutral) {
        self.text = text
        self.systemImage = systemImage
        self.style = style
    }

    public var body: some View {
        HStack(spacing: 4) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: 10, weight: .semibold))
            }
            Text(text)
                .font(AppFont.pill)
                .lineLimit(1)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .foregroundStyle(foreground)
        .background(Capsule(style: .continuous).fill(background))
        .overlay {
            if let stroke {
                Capsule(style: .continuous)
                    .strokeBorder(stroke, lineWidth: AppMetrics.hairline)
            }
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    private var foreground: Color {
        switch style {
        case .neutral: palette.inkMuted
        case .solid: palette.onAccent
        case .outline: palette.inkMuted
        case .color(let id): EventColors.style(for: id, palette: palette).text
        }
    }

    private var background: Color {
        switch style {
        case .neutral: palette.surfaceMuted
        case .solid: palette.accent
        case .outline: .clear
        case .color(let id): EventColors.style(for: id, palette: palette).background
        }
    }

    private var stroke: Color? {
        switch style {
        case .neutral, .solid: nil
        case .outline: palette.border
        case .color(let id): EventColors.style(for: id, palette: palette).border
        }
    }
}

// MARK: - EmptyState

/// Hueco vacío: icono, título, explicación y una acción opcional.
public struct EmptyState: View {
    private let systemImage: String
    private let title: String
    private let message: String?
    private let actionTitle: String?
    private let action: (() -> Void)?

    public init(
        systemImage: String = "tray",
        title: String,
        message: String? = nil,
        actionTitle: String? = nil,
        action: (() -> Void)? = nil
    ) {
        self.systemImage = systemImage
        self.title = title
        self.message = message
        self.actionTitle = actionTitle
        self.action = action
    }

    public var body: some View {
        VStack(spacing: AppSpacing.md) {
            Image(systemName: systemImage)
                .font(.system(size: 26, weight: .light))
                .foregroundStyle(ThemeColor(.inkFaint))
                .frame(width: 56, height: 56)
                .background(Circle().fill(ThemeColor(.surfaceMuted)))

            VStack(spacing: AppSpacing.xs) {
                Text(title)
                    .font(AppFont.cardTitle)
                    .foregroundStyle(ThemeColor(.ink))
                if let message {
                    Text(message)
                        .font(AppFont.body)
                        .foregroundStyle(ThemeColor(.inkMuted))
                        .multilineTextAlignment(.center)
                }
            }

            if let actionTitle, let action {
                Button(action: action) {
                    Text(actionTitle)
                        .font(AppFont.caption)
                        .padding(.horizontal, AppSpacing.lg)
                        .padding(.vertical, AppSpacing.sm + 2)
                        .foregroundStyle(ThemeColor(.onAccent))
                        .background(
                            Capsule(style: .continuous).fill(ThemeColor(.accent))
                        )
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, AppSpacing.xl)
        .padding(.horizontal, AppSpacing.lg)
    }
}

// MARK: - Separador

/// Línea de 1px del tema. `Divider` usa el gris del sistema y en negro puro se
/// ve más clara de la cuenta.
public struct Hairline: View {
    public init() {}

    public var body: some View {
        Rectangle()
            .fill(ThemeColor(.border))
            .frame(height: AppMetrics.hairline)
    }
}

// MARK: - Previews

#Preview("Componentes — claro") {
    ComponentsPreview().studyOSTheme().preferredColorScheme(.light)
}

#Preview("Componentes — oscuro") {
    ComponentsPreview().studyOSTheme().preferredColorScheme(.dark)
}

private struct ComponentsPreview: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AppSpacing.xl) {
                SectionHeader("Próximas entregas", subtitle: "3 esta semana") {
                    Pill("Ver todo", style: .outline)
                }

                Card {
                    VStack(alignment: .leading, spacing: AppSpacing.md) {
                        Text("Cálculo — Examen parcial")
                            .font(AppFont.cardTitle)
                            .foregroundStyle(ThemeColor(.ink))
                        Hairline()
                        HStack(spacing: AppSpacing.sm) {
                            Pill("Fucsia", style: .color("12"))
                            Pill("Turquesa", style: .color("7"))
                            Pill("Neutro", style: .color("18"))
                            Pill("Hoy", systemImage: "bolt.fill", style: .solid)
                        }
                    }
                }

                Card {
                    EmptyState(
                        systemImage: "calendar",
                        title: "Sin eventos",
                        message: "Cuando sincronices Google Calendar aparecerán aquí.",
                        actionTitle: "Sincronizar",
                        action: {}
                    )
                }
            }
            .padding(AppSpacing.lg)
        }
        .canvasBackground()
    }
}
