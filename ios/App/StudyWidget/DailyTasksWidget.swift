import SwiftUI
import WidgetKit

// MARK: - Adherencia: mismo gradiente rojo → verde que el panel Dashboard (vacío = gris)

private func ringAccentColor(pct: Int, empty: Bool) -> Color {
    if empty {
        return Color(red: 148 / 255, green: 163 / 255, blue: 184 / 255)
    }
    let p = Double(max(0, min(100, pct))) / 100.0
    let r = 239 * (1 - p) + 34 * p
    let g = 68 * (1 - p) + 197 * p
    let b = 68 * (1 - p) + 94 * p
    return Color(red: r / 255, green: g / 255, blue: b / 255)
}

// MARK: - Timeline

struct DailyTasksEntry: TimelineEntry {
    let date: Date
    let ring: IEWidgetDailyTasksRing
}

struct DailyTasksProvider: TimelineProvider {
    func placeholder(in context: Context) -> DailyTasksEntry {
        DailyTasksEntry(
            date: Date(),
            ring: IEWidgetDailyTasksRing(pct: 66, empty: false, done: 2, total: 3),
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (DailyTasksEntry) -> Void) {
        completion(DailyTasksEntry(date: Date(), ring: snapshotRing()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DailyTasksEntry>) -> Void) {
        let entry = DailyTasksEntry(date: Date(), ring: snapshotRing())
        let next = Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? Date()
        completion(Timeline(entries: [entry], policy: .after(next)))
    }

    private func snapshotRing() -> IEWidgetDailyTasksRing {
        if let defaults = UserDefaults(suiteName: kAppGroupID),
           let ring = IEWidgetDailyTasksRing.loadStandalone(from: defaults) {
            return ring
        }
        return IEWidgetData.load().dailyTasksRing
            ?? IEWidgetDailyTasksRing(pct: 0, empty: true, done: 0, total: 0)
    }
}

// MARK: - Vista pequeña (cuadrado): anillo + % centrado

struct DailyTasksSmallView: View {
    let ring: IEWidgetDailyTasksRing

    private var accent: Color {
        ringAccentColor(pct: ring.pct, empty: ring.empty)
    }

    private var detailText: String {
        if ring.empty { return "Sin tareas" }
        return "\(ring.done)/\(ring.total)"
    }

    var body: some View {
        GeometryReader { geo in
            let side = min(geo.size.width, geo.size.height)
            let ringDiameter = side * 0.82
            let lineWidth = max(9, ringDiameter * 0.09)
            let pctFont = max(18, ringDiameter * 0.26)
            let subFont = max(9, ringDiameter * 0.11)

            ZStack {
                Circle()
                    .stroke(Color.white.opacity(0.12), lineWidth: lineWidth)
                Circle()
                    .trim(from: 0, to: CGFloat(ring.pct) / 100.0)
                    .stroke(
                        accent,
                        style: StrokeStyle(lineWidth: lineWidth, lineCap: .round),
                    )
                    .rotationEffect(.degrees(-90))

                VStack(spacing: 2) {
                    Text("\(ring.pct)%")
                        .font(.system(size: pctFont, weight: .heavy, design: .rounded))
                        .foregroundColor(accent)
                        .minimumScaleFactor(0.65)
                        .lineLimit(1)
                    if !ring.empty {
                        Text(detailText)
                            .font(.system(size: subFont, weight: .semibold, design: .rounded))
                            .foregroundColor(Color.white.opacity(0.45))
                            .minimumScaleFactor(0.7)
                            .lineLimit(1)
                    }
                }
                .padding(.horizontal, 6)
            }
            .frame(width: ringDiameter, height: ringDiameter)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Tareas diarias, \(ring.pct) por ciento, \(detailText)")
        }
    }
}

struct DailyTasksEntryView: View {
    var entry: DailyTasksEntry

    var body: some View {
        DailyTasksSmallView(ring: entry.ring)
    }
}

struct DailyTasksWidget: Widget {
    let kind = "DailyTasksWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: DailyTasksProvider()) { entry in
            DailyTasksEntryView(entry: entry)
                .ieStudyTrendWidgetBackground()
                .widgetURL(URL(string: "iestudio://daily-tasks"))
        }
        .configurationDisplayName("Tareas diarias")
        .description("Progreso de tu checklist de hoy.")
        .supportedFamilies([.systemSmall])
        .contentMarginsDisabled()
    }
}
