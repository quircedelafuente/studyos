import SwiftUI
import WidgetKit

struct BBDeliveriesEntry: TimelineEntry {
    let date:       Date
    let deliveries: [IEWidgetDelivery]
}

struct BBDeliveriesProvider: TimelineProvider {
    func placeholder(in context: Context) -> BBDeliveriesEntry {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        let d1 = f.string(from: Calendar.current.date(byAdding: .day, value: 2, to: Date())!)
        let d2 = f.string(from: Calendar.current.date(byAdding: .day, value: 5, to: Date())!)
        return BBDeliveriesEntry(date: Date(), deliveries: [
            IEWidgetDelivery(id: "1", courseName: "Programación", title: "Mini-proyecto final", dueDate: d1, urgency: "red"),
            IEWidgetDelivery(id: "2", courseName: "Historia",     title: "Resumen capítulo 4", dueDate: d2, urgency: "yellow"),
        ])
    }
    func getSnapshot(in context: Context, completion: @escaping (BBDeliveriesEntry) -> Void) {
        completion(BBDeliveriesEntry(date: Date(), deliveries: IEWidgetData.load().bbDeliveries))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<BBDeliveriesEntry>) -> Void) {
        let data  = IEWidgetData.load()
        let entry = BBDeliveriesEntry(date: Date(), deliveries: data.bbDeliveries)
        let next  = Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? Date()
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

private let brandColor = Color(red: 0.39, green: 0.40, blue: 0.95)

private func urgColor(_ u: String) -> Color {
    u == "red" ? Color(red: 0.93, green: 0.27, blue: 0.27) : Color(red: 0.92, green: 0.70, blue: 0.08)
}

private func daysLabel(_ d: Int) -> String {
    if d < 0  { return "Vencido" }
    if d == 0 { return "Hoy" }
    if d == 1 { return "Mañana" }
    return "\(d)d"
}

struct BBDeliveriesSmallView: View {
    let deliveries: [IEWidgetDelivery]
    var body: some View {
        if let d = deliveries.first {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    Image(systemName: "tray.and.arrow.up.fill")
                        .font(.system(size: 11, weight: .semibold)).foregroundColor(brandColor)
                    Text("Blackboard").font(.system(size: 11, weight: .bold)).foregroundColor(brandColor)
                    Spacer()
                }
                Spacer()
                Text(d.title)
                    .font(.system(size: 13, weight: .heavy)).foregroundColor(.primary)
                    .lineLimit(2).minimumScaleFactor(0.85)
                Text(d.courseName)
                    .font(.system(size: 11)).foregroundColor(.secondary).lineLimit(1)
                Spacer()
                HStack {
                    Spacer()
                    Text(daysLabel(d.daysRemaining))
                        .font(.system(size: 13, weight: .heavy, design: .rounded))
                        .foregroundColor(.white)
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(urgColor(d.urgency)).clipShape(Capsule())
                }
            }
            .padding(14)
        } else {
            VStack(spacing: 6) {
                Image(systemName: "tray").font(.system(size: 22)).foregroundColor(.secondary)
                Text("Sin entregas").font(.system(size: 12)).foregroundColor(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

struct BBDeliveriesMediumView: View {
    let deliveries: [IEWidgetDelivery]
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 5) {
                Image(systemName: "tray.and.arrow.up.fill").font(.system(size: 12, weight: .semibold)).foregroundColor(brandColor)
                Text("Entregas Blackboard").font(.system(size: 12, weight: .bold)).foregroundColor(brandColor)
                Spacer()
                if deliveries.count > 2 { Text("+\(deliveries.count - 2)").font(.system(size: 10, weight: .semibold)).foregroundColor(.secondary) }
            }
            .padding(.horizontal, 14).padding(.top, 12).padding(.bottom, 8)
            if deliveries.isEmpty {
                Text("Sin entregas próximas").font(.system(size: 12)).foregroundColor(.secondary).frame(maxWidth: .infinity).padding()
            } else {
                ForEach(Array(deliveries.prefix(2).enumerated()), id: \.offset) { idx, d in
                    if idx > 0 { Divider().padding(.horizontal, 12) }
                    HStack(spacing: 10) {
                        RoundedRectangle(cornerRadius: 3).fill(urgColor(d.urgency)).frame(width: 4).padding(.vertical, 2)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(d.title).font(.system(size: 13, weight: .semibold)).foregroundColor(.primary).lineLimit(1)
                            Text(d.courseName).font(.system(size: 11)).foregroundColor(.secondary).lineLimit(1)
                        }
                        Spacer()
                        Text(daysLabel(d.daysRemaining)).font(.system(size: 12, weight: .bold, design: .rounded)).foregroundColor(urgColor(d.urgency))
                    }
                    .padding(.horizontal, 14).padding(.vertical, 7)
                }
            }
            Spacer()
        }
    }
}

struct BBDeliveriesLargeView: View {
    let deliveries: [IEWidgetDelivery]
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 5) {
                Image(systemName: "tray.and.arrow.up.fill").font(.system(size: 13, weight: .semibold)).foregroundColor(brandColor)
                Text("Entregas Blackboard").font(.system(size: 13, weight: .bold)).foregroundColor(brandColor)
                Spacer()
                Text("\(deliveries.count) entregas").font(.system(size: 11)).foregroundColor(.secondary)
            }
            .padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 10)
            if deliveries.isEmpty {
                Spacer()
                Text("Sin entregas próximas").font(.system(size: 13)).foregroundColor(.secondary).frame(maxWidth: .infinity)
                Spacer()
            } else {
                ForEach(Array(deliveries.prefix(5).enumerated()), id: \.offset) { idx, d in
                    if idx > 0 { Divider().padding(.leading, 30) }
                    HStack(spacing: 12) {
                        ZStack {
                            Circle().fill(urgColor(d.urgency).opacity(0.15)).frame(width: 36, height: 36)
                            Image(systemName: "arrow.up.doc.fill").font(.system(size: 15, weight: .semibold)).foregroundColor(urgColor(d.urgency))
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            Text(d.title).font(.system(size: 13, weight: .semibold)).foregroundColor(.primary).lineLimit(1)
                            Text(d.courseName).font(.system(size: 11)).foregroundColor(.secondary)
                        }
                        Spacer()
                        Text(daysLabel(d.daysRemaining)).font(.system(size: 13, weight: .heavy, design: .rounded)).foregroundColor(urgColor(d.urgency))
                    }
                    .padding(.horizontal, 16).padding(.vertical, 8)
                }
            }
            Spacer()
        }
    }
}

struct BBDeliveriesEntryView: View {
    var entry: BBDeliveriesEntry
    @Environment(\.widgetFamily) var family
    var body: some View {
        switch family {
        case .systemSmall:  BBDeliveriesSmallView(deliveries: entry.deliveries)
        case .systemMedium: BBDeliveriesMediumView(deliveries: entry.deliveries)
        case .systemLarge:  BBDeliveriesLargeView(deliveries: entry.deliveries)
        default:            BBDeliveriesMediumView(deliveries: entry.deliveries)
        }
    }
}

struct BBDeliveriesWidget: Widget {
    let kind = "BBDeliveriesWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: BBDeliveriesProvider()) { entry in
            BBDeliveriesEntryView(entry: entry)
                .ieWidgetBackground()
                .widgetURL(URL(string: "iestudio://assignments"))
        }
        .configurationDisplayName("Entregas Blackboard")
        .description("Tus próximas entregas pendientes de Blackboard.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}
