import SwiftUI
import WidgetKit

struct TodaySessionEntry: TimelineEntry {
    let date: Date
    let sessions: [IEWidgetSession]
}

struct TodaySessionProvider: TimelineProvider {
    func placeholder(in context: Context) -> TodaySessionEntry {
        TodaySessionEntry(date: Date(), sessions: [
            IEWidgetSession(id: "1", sessionTitle: "Álgebra – Repaso Tema 3", planTitle: "Plan Q2", studyHours: 2.0, focus: "Integrales · Derivadas · Límites", date: ""),
        ])
    }
    func getSnapshot(in context: Context, completion: @escaping (TodaySessionEntry) -> Void) {
        completion(TodaySessionEntry(date: Date(), sessions: IEWidgetData.load().todaySessions))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<TodaySessionEntry>) -> Void) {
        let data  = IEWidgetData.load()
        let entry = TodaySessionEntry(date: Date(), sessions: data.todaySessions)
        let next  = Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? Date()
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

private let brandColor = Color(red: 0.39, green: 0.40, blue: 0.95)

private func hoursLabel(_ h: Double) -> String {
    let rounded = (h * 10).rounded() / 10
    return rounded == rounded.rounded() ? "\(Int(rounded))h" : "\(rounded)h"
}

struct TodaySessionSmallView: View {
    let sessions: [IEWidgetSession]
    var body: some View {
        if let s = sessions.first {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    Image(systemName: "brain.head.profile")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(brandColor)
                    Text("Hoy")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(brandColor)
                    Spacer()
                    Text(hoursLabel(s.studyHours))
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.secondary)
                }
                Spacer()
                Text(s.sessionTitle)
                    .font(.system(size: 13, weight: .heavy))
                    .foregroundColor(.primary)
                    .lineLimit(3)
                    .minimumScaleFactor(0.8)
                Spacer()
                Text(s.planTitle)
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }
            .padding(14)
        } else {
            VStack(spacing: 6) {
                Image(systemName: "moon.zzz").font(.system(size: 22)).foregroundColor(.secondary)
                Text("Sin sesión hoy").font(.system(size: 12)).foregroundColor(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

struct TodaySessionMediumView: View {
    let sessions: [IEWidgetSession]
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 5) {
                Image(systemName: "brain.head.profile").font(.system(size: 12, weight: .semibold)).foregroundColor(brandColor)
                Text("Sesión de Hoy").font(.system(size: 12, weight: .bold)).foregroundColor(brandColor)
                Spacer()
                Text("\(sessions.count) sesión\(sessions.count != 1 ? "es" : "")").font(.system(size: 10)).foregroundColor(.secondary)
            }
            .padding(.horizontal, 14).padding(.top, 12).padding(.bottom, 8)
            if sessions.isEmpty {
                Text("Sin sesiones programadas").font(.system(size: 12)).foregroundColor(.secondary).frame(maxWidth: .infinity).padding()
            } else {
                ForEach(Array(sessions.prefix(2).enumerated()), id: \.offset) { idx, s in
                    if idx > 0 { Divider().padding(.horizontal, 12) }
                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(s.sessionTitle).font(.system(size: 13, weight: .semibold)).foregroundColor(.primary).lineLimit(1)
                            if !s.focus.isEmpty {
                                Text(s.focus).font(.system(size: 11)).foregroundColor(.secondary).lineLimit(1)
                            }
                        }
                        Spacer()
                        Text(hoursLabel(s.studyHours)).font(.system(size: 13, weight: .heavy, design: .rounded)).foregroundColor(brandColor)
                    }
                    .padding(.horizontal, 14).padding(.vertical, 7)
                }
            }
            Spacer()
        }
    }
}

struct TodaySessionLargeView: View {
    let sessions: [IEWidgetSession]
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 5) {
                Image(systemName: "brain.head.profile").font(.system(size: 13, weight: .semibold)).foregroundColor(brandColor)
                Text("Sesiones de Hoy").font(.system(size: 13, weight: .bold)).foregroundColor(brandColor)
                Spacer()
                let total = sessions.reduce(0.0) { $0 + $1.studyHours }
                Text(hoursLabel(total) + " total").font(.system(size: 11)).foregroundColor(.secondary)
            }
            .padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 10)
            if sessions.isEmpty {
                Spacer()
                Text("Sin sesiones programadas").font(.system(size: 13)).foregroundColor(.secondary).frame(maxWidth: .infinity)
                Spacer()
            } else {
                ForEach(Array(sessions.prefix(3).enumerated()), id: \.offset) { idx, s in
                    if idx > 0 { Divider().padding(.leading, 16) }
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(s.sessionTitle).font(.system(size: 14, weight: .semibold)).foregroundColor(.primary).lineLimit(1)
                            Spacer()
                            Text(hoursLabel(s.studyHours)).font(.system(size: 13, weight: .heavy, design: .rounded)).foregroundColor(brandColor)
                        }
                        if !s.focus.isEmpty {
                            Text(s.focus).font(.system(size: 12)).foregroundColor(.secondary).lineLimit(2)
                        }
                        Text(s.planTitle).font(.system(size: 10)).foregroundColor(brandColor.opacity(0.7))
                    }
                    .padding(.horizontal, 16).padding(.vertical, 10)
                }
            }
            Spacer()
        }
    }
}

struct TodaySessionEntryView: View {
    var entry: TodaySessionEntry
    @Environment(\.widgetFamily) var family
    var body: some View {
        switch family {
        case .systemSmall:  TodaySessionSmallView(sessions: entry.sessions)
        case .systemMedium: TodaySessionMediumView(sessions: entry.sessions)
        case .systemLarge:  TodaySessionLargeView(sessions: entry.sessions)
        default:            TodaySessionMediumView(sessions: entry.sessions)
        }
    }
}

struct TodaySessionWidget: Widget {
    let kind = "TodaySessionWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TodaySessionProvider()) { entry in
            TodaySessionEntryView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(URL(string: "iestudio://study-arena"))
        }
        .configurationDisplayName("Sesión de Hoy")
        .description("Tus sesiones de estudio programadas para hoy.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}
