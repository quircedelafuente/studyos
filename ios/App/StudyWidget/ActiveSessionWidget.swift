import SwiftUI
import WidgetKit

struct ActiveSessionEntry: TimelineEntry {
    let date:   Date
    let session: IEWidgetActiveSession?
}

struct ActiveSessionProvider: TimelineProvider {
    func placeholder(in context: Context) -> ActiveSessionEntry {
        ActiveSessionEntry(date: Date(), session: IEWidgetActiveSession(
            sessionTitle: "Álgebra – Tema 3", planTitle: "Plan Q2",
            focusScore: 85, distractionCount: 1,
            elapsedActiveMs: 1800000, totalDurationMs: 3600000,
            endTimestampMs: Date().timeIntervalSince1970 * 1000 + 1800000,
            isPaused: false
        ))
    }
    func getSnapshot(in context: Context, completion: @escaping (ActiveSessionEntry) -> Void) {
        completion(ActiveSessionEntry(date: Date(), session: IEWidgetData.load().activeSession))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<ActiveSessionEntry>) -> Void) {
        let data  = IEWidgetData.load()
        let entry = ActiveSessionEntry(date: Date(), session: data.activeSession)
        // Refresh every 5 min when active, hourly otherwise
        let interval: Int = data.activeSession != nil ? 5 : 60
        let next = Calendar.current.date(byAdding: .minute, value: interval, to: Date()) ?? Date()
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

private let brandColor  = Color(red: 0.39, green: 0.40, blue: 0.95)
private let bgDark      = Color(red: 0.06, green: 0.09, blue: 0.16)

private func focusColor(_ score: Int) -> Color {
    switch score {
    case 80...100: return Color(red: 0.13, green: 0.77, blue: 0.37)
    case 50..<80:  return Color(red: 0.92, green: 0.70, blue: 0.08)
    default:       return Color(red: 0.93, green: 0.27, blue: 0.27)
    }
}

struct ActiveSessionSmallView: View {
    let session: IEWidgetActiveSession?
    var body: some View {
        if let s = session {
            ZStack {
                bgDark.ignoresSafeArea()
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 4) {
                        Image(systemName: s.isPaused ? "pause.circle.fill" : "brain.head.profile")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(s.isPaused ? .yellow : brandColor)
                        Text(s.isPaused ? "Pausado" : "En curso")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundColor(s.isPaused ? .yellow : brandColor)
                        Spacer()
                    }
                    Spacer()
                    if s.isPaused {
                        Text(s.formatRemaining())
                            .font(.system(size: 26, weight: .heavy, design: .rounded))
                            .foregroundColor(.white.opacity(0.6))
                            .monospacedDigit()
                    } else {
                        Text(timerInterval: Date()...s.endDate, countsDown: true)
                            .font(.system(size: 26, weight: .heavy, design: .rounded))
                            .foregroundColor(.white)
                            .monospacedDigit()
                    }
                    Spacer()
                    HStack {
                        Text("Focus \(s.focusScore)")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundColor(focusColor(s.focusScore))
                        Spacer()
                        if s.distractionCount > 0 {
                            Text("⚠️ \(s.distractionCount)")
                                .font(.system(size: 10))
                                .foregroundColor(.orange)
                        }
                    }
                }
                .padding(14)
            }
        } else {
            VStack(spacing: 6) {
                Image(systemName: "moon.zzz").font(.system(size: 22)).foregroundColor(.secondary)
                Text("Sin sesión activa").font(.system(size: 12)).foregroundColor(.secondary).multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

struct ActiveSessionMediumView: View {
    let session: IEWidgetActiveSession?
    var body: some View {
        if let s = session {
            ZStack {
                bgDark.ignoresSafeArea()
                HStack(spacing: 16) {
                    // Timer circle
                    ZStack {
                        Circle().stroke(Color.white.opacity(0.1), lineWidth: 6)
                        Circle()
                            .trim(from: 0, to: CGFloat(s.progressPct / 100))
                            .stroke(brandColor, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                        VStack(spacing: 1) {
                            if s.isPaused {
                                Text(s.formatRemaining())
                                    .font(.system(size: 13, weight: .bold, design: .rounded))
                                    .foregroundColor(.white.opacity(0.55))
                                    .monospacedDigit()
                            } else {
                                Text(timerInterval: Date()...s.endDate, countsDown: true)
                                    .font(.system(size: 13, weight: .bold, design: .rounded))
                                    .foregroundColor(.white)
                                    .monospacedDigit()
                            }
                            Text("resta").font(.system(size: 8)).foregroundColor(.secondary)
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .frame(width: 72, height: 72)

                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 4) {
                            Image(systemName: "brain.head.profile").font(.system(size: 10, weight: .semibold)).foregroundColor(brandColor)
                            Text("Study Arena").font(.system(size: 10, weight: .bold)).foregroundColor(brandColor)
                            Spacer()
                            if s.isPaused {
                                Text("PAUSADO").font(.system(size: 9, weight: .heavy)).foregroundColor(.yellow).kerning(1)
                            }
                        }
                        Text(s.sessionTitle).font(.system(size: 13, weight: .semibold)).foregroundColor(.white).lineLimit(2)
                        Spacer()
                        HStack(spacing: 10) {
                            HStack(spacing: 3) {
                                Image(systemName: "bolt.fill").font(.system(size: 9)).foregroundColor(focusColor(s.focusScore))
                                Text("Focus \(s.focusScore)%").font(.system(size: 11, weight: .semibold)).foregroundColor(focusColor(s.focusScore))
                            }
                            if s.distractionCount > 0 {
                                HStack(spacing: 3) {
                                    Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 9)).foregroundColor(.orange)
                                    Text("\(s.distractionCount)").font(.system(size: 11, weight: .semibold)).foregroundColor(.orange)
                                }
                            }
                        }
                        ProgressView(value: s.progressPct / 100).tint(brandColor)
                    }
                }
                .padding(14)
            }
        } else {
            HStack(spacing: 12) {
                Image(systemName: "moon.zzz").font(.system(size: 28)).foregroundColor(.secondary)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Sin sesión activa").font(.system(size: 14, weight: .semibold)).foregroundColor(.primary)
                    Text("Inicia una sesión en Study Arena").font(.system(size: 12)).foregroundColor(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading).padding(16)
        }
    }
}

struct ActiveSessionLargeView: View {
    let session: IEWidgetActiveSession?
    var body: some View {
        if let s = session {
            ZStack {
                bgDark.ignoresSafeArea()
                VStack(spacing: 16) {
                    HStack(spacing: 5) {
                        Image(systemName: "brain.head.profile").font(.system(size: 13, weight: .semibold)).foregroundColor(brandColor)
                        Text("Study Arena").font(.system(size: 13, weight: .bold)).foregroundColor(brandColor)
                        Spacer()
                        if s.isPaused { Text("PAUSADO").font(.system(size: 10, weight: .heavy)).foregroundColor(.yellow).kerning(1.2) }
                    }
                    ZStack {
                        Circle().stroke(Color.white.opacity(0.08), lineWidth: 14)
                        Circle()
                            .trim(from: 0, to: CGFloat(s.progressPct / 100))
                            .stroke(brandColor, style: StrokeStyle(lineWidth: 14, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                        VStack(spacing: 4) {
                            if s.isPaused {
                                Text(s.formatRemaining()).font(.system(size: 32, weight: .heavy, design: .rounded)).foregroundColor(.white.opacity(0.55)).monospacedDigit()
                            } else {
                                Text(timerInterval: Date()...s.endDate, countsDown: true).font(.system(size: 32, weight: .heavy, design: .rounded)).foregroundColor(.white).monospacedDigit()
                            }
                            Text("restante").font(.system(size: 11)).foregroundColor(.secondary)
                        }
                    }
                    .frame(width: 160, height: 160)
                    Text(s.sessionTitle).font(.system(size: 16, weight: .heavy)).foregroundColor(.white).lineLimit(2).multilineTextAlignment(.center)
                    Text(s.planTitle).font(.system(size: 12)).foregroundColor(brandColor.opacity(0.8))
                    HStack(spacing: 24) {
                        VStack(spacing: 4) {
                            Text("\(s.focusScore)%").font(.system(size: 22, weight: .heavy, design: .rounded)).foregroundColor(focusColor(s.focusScore))
                            Text("Focus Score").font(.system(size: 11)).foregroundColor(.secondary)
                        }
                        VStack(spacing: 4) {
                            Text("\(s.distractionCount)").font(.system(size: 22, weight: .heavy, design: .rounded)).foregroundColor(s.distractionCount > 0 ? .orange : .secondary)
                            Text("Distracciones").font(.system(size: 11)).foregroundColor(.secondary)
                        }
                        VStack(spacing: 4) {
                            Text(String(format: "%.0f%%", s.progressPct)).font(.system(size: 22, weight: .heavy, design: .rounded)).foregroundColor(brandColor)
                            Text("Completado").font(.system(size: 11)).foregroundColor(.secondary)
                        }
                    }
                    ProgressView(value: s.progressPct / 100).tint(brandColor).padding(.horizontal, 8)
                    Spacer()
                }
                .padding(16)
            }
        } else {
            VStack(spacing: 12) {
                Image(systemName: "moon.zzz").font(.system(size: 40)).foregroundColor(.secondary)
                Text("Sin sesión activa").font(.system(size: 16, weight: .semibold)).foregroundColor(.primary)
                Text("Abre IEStudio e inicia una\nsesión en Study Arena").font(.system(size: 13)).foregroundColor(.secondary).multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

struct ActiveSessionEntryView: View {
    var entry: ActiveSessionEntry
    @Environment(\.widgetFamily) var family
    var body: some View {
        switch family {
        case .systemSmall:  ActiveSessionSmallView(session: entry.session)
        case .systemMedium: ActiveSessionMediumView(session: entry.session)
        case .systemLarge:  ActiveSessionLargeView(session: entry.session)
        default:            ActiveSessionMediumView(session: entry.session)
        }
    }
}

struct ActiveSessionWidget: Widget {
    let kind = "ActiveSessionWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ActiveSessionProvider()) { entry in
            ActiveSessionEntryView(entry: entry).containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Study Arena")
        .description("Sesión de estudio activa con temporizador y focus score.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .contentMarginsDisabled()
        .widgetURL(URL(string: "iestudio://study-arena"))
    }
}
