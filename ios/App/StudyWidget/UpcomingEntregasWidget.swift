import SwiftUI
import WidgetKit

/// Mismo criterio y orden que el mosaico «Entregas · Próximas 3» del dashboard (JSON `upcomingEntregas`).
struct UpcomingEntregasEntry: TimelineEntry {
    let date: Date
    let items: [IEWidgetUpcomingEntrega]
}

struct UpcomingEntregasProvider: TimelineProvider {
    func placeholder(in context: Context) -> UpcomingEntregasEntry {
        UpcomingEntregasEntry(date: Date(), items: [
            IEWidgetUpcomingEntrega(
                id: "1",
                courseName: "Programación",
                title: "Mini-proyecto final",
                dueIso: nil,
                relLabel: "Sin fecha",
                relTone: "amber",
            ),
            IEWidgetUpcomingEntrega(
                id: "2",
                courseName: "Historia",
                title: "Resumen cap. 4",
                dueIso: "2026-04-09T23:59:00Z",
                relLabel: "En 2 d",
                relTone: "default",
            ),
        ])
    }

    func getSnapshot(in context: Context, completion: @escaping (UpcomingEntregasEntry) -> Void) {
        completion(UpcomingEntregasEntry(date: Date(), items: Self.resolveItems(IEWidgetData.load())))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<UpcomingEntregasEntry>) -> Void) {
        let data = IEWidgetData.load()
        let entry = UpcomingEntregasEntry(date: Date(), items: Self.resolveItems(data))
        let next = Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? Date()
        completion(Timeline(entries: [entry], policy: .after(next)))
    }

    /// Prioridad: `upcomingEntregas` del sync; si falta (app antigua), aproximación con `bbDeliveries`.
    private static func resolveItems(_ data: IEWidgetData) -> [IEWidgetUpcomingEntrega] {
        if let u = data.upcomingEntregas, !u.isEmpty { return u }
        return Array(data.bbDeliveries.prefix(3)).map { d in
            IEWidgetUpcomingEntrega(
                id: d.id,
                courseName: d.courseName,
                title: d.title,
                dueIso: d.dueDate,
                relLabel: daysFallbackLabel(d.daysRemaining),
                relTone: d.urgency == "red" ? "red" : "amber",
            )
        }
    }

    private static func daysFallbackLabel(_ d: Int) -> String {
        if d < 0 { return "Vencido" }
        if d == 0 { return "Hoy" }
        if d == 1 { return "Mañana" }
        return "\(d)d"
    }
}

private let headerAccent = Color(red: 0.25, green: 0.27, blue: 0.32)

private func toneColor(_ tone: String) -> Color {
    switch tone {
    case "red": return Color(red: 0.93, green: 0.27, blue: 0.27)
    case "amber": return Color(red: 0.92, green: 0.65, blue: 0.13)
    default: return Color(red: 0.45, green: 0.48, blue: 0.52)
    }
}

private struct EntregasRow: View {
    let item: IEWidgetUpcomingEntrega

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle()
                .strokeBorder(Color.primary.opacity(0.35), lineWidth: 2)
                .background(Circle().fill(Color(.systemBackground)))
                .frame(width: 8, height: 8)
                .padding(.top, 5)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(item.courseName.uppercased())
                        .font(.system(size: 8, weight: .heavy))
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                    Text(item.relLabel.uppercased())
                        .font(.system(size: 8, weight: .heavy))
                        .foregroundColor(toneColor(item.relTone))
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }
                Text(item.title)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(.primary)
                    .lineLimit(2)
                    .minimumScaleFactor(0.88)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

struct UpcomingEntregasSmallView: View {
    let items: [IEWidgetUpcomingEntrega]
    var body: some View {
        if let first = items.first {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    Image(systemName: "doc.badge.clock")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(headerAccent)
                    Text("Entregas")
                        .font(.system(size: 11, weight: .heavy))
                        .foregroundColor(headerAccent)
                    Spacer()
                }
                Spacer(minLength: 2)
                Text(first.title)
                    .font(.system(size: 13, weight: .heavy))
                    .foregroundColor(.primary)
                    .lineLimit(3)
                    .minimumScaleFactor(0.85)
                Text(first.courseName)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                Spacer(minLength: 0)
                HStack {
                    Spacer()
                    Text(first.relLabel)
                        .font(.system(size: 12, weight: .heavy, design: .rounded))
                        .foregroundColor(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(toneColor(first.relTone))
                        .clipShape(Capsule())
                }
            }
            .padding(14)
        } else {
            VStack(spacing: 6) {
                Image(systemName: "checkmark.circle").font(.system(size: 22)).foregroundColor(.secondary)
                Text("Sin entregas pendientes")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

struct UpcomingEntregasMediumView: View {
    let items: [IEWidgetUpcomingEntrega]
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: "doc.badge.clock")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(headerAccent)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Entregas")
                        .font(.system(size: 12, weight: .heavy))
                        .foregroundColor(headerAccent)
                    Text("Próximas 3")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(.secondary)
                }
                Spacer()
            }
            .padding(.horizontal, 14)
            .padding(.top, 12)
            .padding(.bottom, 8)
            if items.isEmpty {
                Text("Sin entregas pendientes")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity)
                    .padding()
                Spacer(minLength: 0)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(items.prefix(3).enumerated()), id: \.offset) { idx, it in
                        if idx > 0 {
                            Divider().padding(.leading, 18)
                        }
                        EntregasRow(item: it)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                    }
                }
                Spacer(minLength: 0)
            }
        }
    }
}

struct UpcomingEntregasLargeView: View {
    let items: [IEWidgetUpcomingEntrega]
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "doc.badge.clock")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(headerAccent)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Entregas")
                        .font(.system(size: 14, weight: .heavy))
                        .foregroundColor(headerAccent)
                    Text("Próximas 3 · Blackboard")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.secondary)
                }
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 10)
            if items.isEmpty {
                Spacer()
                Text("Sin entregas pendientes")
                    .font(.system(size: 13))
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity)
                Spacer()
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(items.prefix(3).enumerated()), id: \.offset) { idx, it in
                        if idx > 0 { Divider().padding(.leading, 22) }
                        EntregasRow(item: it)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                    }
                }
                Spacer(minLength: 0)
            }
        }
    }
}

struct UpcomingEntregasEntryView: View {
    var entry: UpcomingEntregasEntry
    @Environment(\.widgetFamily) var family
    var body: some View {
        switch family {
        case .systemSmall: UpcomingEntregasSmallView(items: entry.items)
        case .systemMedium: UpcomingEntregasMediumView(items: entry.items)
        case .systemLarge: UpcomingEntregasLargeView(items: entry.items)
        default: UpcomingEntregasMediumView(items: entry.items)
        }
    }
}

struct UpcomingEntregasWidget: Widget {
    let kind = "UpcomingEntregasWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: UpcomingEntregasProvider()) { entry in
            UpcomingEntregasEntryView(entry: entry)
                .ieWidgetBackground()
                .widgetURL(URL(string: "iestudio://assignments"))
        }
        .configurationDisplayName("Próximas entregas")
        .description("Las mismas próximas 3 entregas que en el dashboard (Blackboard, semestre actual).")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}
