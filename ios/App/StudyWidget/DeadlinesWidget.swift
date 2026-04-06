import SwiftUI
import WidgetKit

// MARK: - Timeline

struct DeadlinesEntry: TimelineEntry {
    let date:      Date
    let deadlines: [IEWidgetDeadline]
}

struct DeadlinesProvider: TimelineProvider {
    func placeholder(in context: Context) -> DeadlinesEntry {
        DeadlinesEntry(date: Date(), deadlines: [
            IEWidgetDeadline(id: "1", title: "Examen de Álgebra",   subject: "Álgebra",   date: nextDateStr(3), isExam: true,  urgency: "red"),
            IEWidgetDeadline(id: "2", title: "Entrega de Historia",  subject: "Historia",  date: nextDateStr(7), isExam: false, urgency: "yellow"),
        ])
    }

    func getSnapshot(in context: Context, completion: @escaping (DeadlinesEntry) -> Void) {
        completion(DeadlinesEntry(date: Date(), deadlines: IEWidgetData.load().deadlines))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DeadlinesEntry>) -> Void) {
        let data   = IEWidgetData.load()
        let entry  = DeadlinesEntry(date: Date(), deadlines: data.deadlines)
        let next   = Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? Date()
        completion(Timeline(entries: [entry], policy: .after(next)))
    }

    private func nextDateStr(_ days: Int) -> String {
        let d = Calendar.current.date(byAdding: .day, value: days, to: Date()) ?? Date()
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }
}

// MARK: - Shared helpers

private func urgencyColor(_ u: String) -> Color {
    switch u {
    case "red":    return Color(red: 0.93, green: 0.27, blue: 0.27)
    case "yellow": return Color(red: 0.92, green: 0.70, blue: 0.08)
    default:       return Color(red: 0.35, green: 0.78, blue: 0.53)
    }
}

private func daysLabel(_ days: Int) -> String {
    if days < 0  { return "Vencido" }
    if days == 0 { return "Hoy" }
    if days == 1 { return "Mañana" }
    return "\(days)d"
}

private let brandColor = Color(red: 0.39, green: 0.40, blue: 0.95)

// MARK: - Small view

struct DeadlinesSmallView: View {
    let deadlines: [IEWidgetDeadline]

    var body: some View {
        if let d = deadlines.first {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    Image(systemName: "calendar.badge.exclamationmark")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(brandColor)
                    Text("Próxima fecha")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(brandColor)
                    Spacer()
                }

                Spacer()

                Text(d.title)
                    .font(.system(size: 13, weight: .heavy))
                    .foregroundColor(.primary)
                    .lineLimit(2)
                    .minimumScaleFactor(0.85)

                Text(d.subject)
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
                    .lineLimit(1)

                Spacer()

                HStack {
                    Spacer()
                    Text(daysLabel(d.daysRemaining))
                        .font(.system(size: 13, weight: .heavy, design: .rounded))
                        .foregroundColor(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(urgencyColor(d.urgencyColor))
                        .clipShape(Capsule())
                }
            }
            .padding(14)
        } else {
            emptyView("Sin fechas próximas")
        }
    }
}

// MARK: - Medium view

struct DeadlinesMediumView: View {
    let deadlines: [IEWidgetDeadline]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            headerRow
            if deadlines.isEmpty {
                Spacer()
                Text("Sin fechas próximas")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity)
                Spacer()
            } else {
                ForEach(Array(deadlines.prefix(2).enumerated()), id: \.offset) { idx, d in
                    if idx > 0 { Divider().padding(.horizontal, 12) }
                    deadlineRow(d)
                }
            }
        }
        .padding(.vertical, 10)
    }

    private var headerRow: some View {
        HStack(spacing: 5) {
            Image(systemName: "calendar.badge.exclamationmark")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(brandColor)
            Text("Exámenes y Fechas")
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(brandColor)
            Spacer()
            if deadlines.count > 2 {
                Text("+\(deadlines.count - 2)")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(.secondary)
            }
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 8)
    }

    private func deadlineRow(_ d: IEWidgetDeadline) -> some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 3)
                .fill(urgencyColor(d.urgencyColor))
                .frame(width: 4)
                .padding(.vertical, 2)

            VStack(alignment: .leading, spacing: 2) {
                Text(d.title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.primary)
                    .lineLimit(1)
                Text(d.subject)
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            Text(daysLabel(d.daysRemaining))
                .font(.system(size: 12, weight: .bold, design: .rounded))
                .foregroundColor(urgencyColor(d.urgencyColor))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 7)
    }
}

// MARK: - Large view

struct DeadlinesLargeView: View {
    let deadlines: [IEWidgetDeadline]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 5) {
                Image(systemName: "calendar.badge.exclamationmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(brandColor)
                Text("Exámenes y Fechas")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(brandColor)
                Spacer()
                Text("\(deadlines.count) fechas")
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 10)

            if deadlines.isEmpty {
                Spacer()
                Text("Sin fechas próximas")
                    .font(.system(size: 13))
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity)
                Spacer()
            } else {
                ForEach(Array(deadlines.prefix(5).enumerated()), id: \.offset) { idx, d in
                    if idx > 0 {
                        Divider().padding(.leading, 30)
                    }
                    largeRow(d)
                }
            }
            Spacer()
        }
    }

    private func largeRow(_ d: IEWidgetDeadline) -> some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(urgencyColor(d.urgencyColor).opacity(0.15))
                    .frame(width: 36, height: 36)
                Image(systemName: d.isExam ? "doc.text.fill" : "paperclip")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(urgencyColor(d.urgencyColor))
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(d.title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.primary)
                    .lineLimit(1)
                Text(d.subject)
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 2) {
                Text(daysLabel(d.daysRemaining))
                    .font(.system(size: 13, weight: .heavy, design: .rounded))
                    .foregroundColor(urgencyColor(d.urgencyColor))
                Text(d.date)
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }
}

// MARK: - Empty helper

private func emptyView(_ msg: String) -> some View {
    VStack(spacing: 6) {
        Image(systemName: "calendar")
            .font(.system(size: 22))
            .foregroundColor(.secondary)
        Text(msg)
            .font(.system(size: 12))
            .foregroundColor(.secondary)
            .multilineTextAlignment(.center)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
}

// MARK: - Widget entry view

struct DeadlinesEntryView: View {
    var entry: DeadlinesEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        switch family {
        case .systemSmall:  DeadlinesSmallView(deadlines: entry.deadlines)
        case .systemMedium: DeadlinesMediumView(deadlines: entry.deadlines)
        case .systemLarge:  DeadlinesLargeView(deadlines: entry.deadlines)
        default:            DeadlinesMediumView(deadlines: entry.deadlines)
        }
    }
}

// MARK: - Widget definition

struct DeadlinesWidget: Widget {
    let kind = "DeadlinesWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: DeadlinesProvider()) { entry in
            DeadlinesEntryView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(URL(string: "iestudio://deadlines"))
        }
        .configurationDisplayName("Exámenes y Fechas")
        .description("Tus próximas fechas de exámenes y entregas.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}
