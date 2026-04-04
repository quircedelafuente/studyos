import ActivityKit
import SwiftUI
import WidgetKit

// MARK: - Helpers

@available(iOS 16.2, *)
private let accentColor  = Color(red: 99/255,  green: 102/255, blue: 241/255) // indigo-500
@available(iOS 16.2, *)
private let bgColor      = Color(red: 15/255,  green: 23/255,  blue: 42/255)  // slate-900
@available(iOS 16.2, *)
private let secondaryTxt = Color(white: 0.55)

@available(iOS 16.2, *)
private func focusColor(_ score: Int) -> Color {
    switch score {
    case 80...100: return Color(red: 34/255,  green: 197/255, blue: 94/255)   // green-500
    case 50..<80:  return Color(red: 234/255, green: 179/255, blue: 8/255)    // yellow-500
    default:       return Color(red: 239/255, green: 68/255,  blue: 68/255)   // red-500
    }
}

@available(iOS 16.2, *)
private func formatSeconds(_ s: Int) -> String {
    let h = s / 3600
    let m = (s % 3600) / 60
    let sec = s % 60
    return h > 0 ? String(format: "%d:%02d:%02d", h, m, sec)
                 : String(format: "%02d:%02d", m, sec)
}

// MARK: - Timer view (live countdown o tiempo estático si pausado)

@available(iOS 16.2, *)
struct TimerLabel: View {
    let state: StudySessionAttributes.ContentState
    let font: Font

    var body: some View {
        Group {
            if state.isPaused {
                Text(formatSeconds(state.pausedSecondsRemaining))
                    .foregroundColor(.white.opacity(0.55))
            } else {
                Text(timerInterval: Date()...state.endDate, countsDown: true)
                    .foregroundColor(.white)
            }
        }
        .font(font)
        .monospacedDigit()
        .lineLimit(1)
    }
}

// MARK: - Lock Screen / Notification Center view

@available(iOS 16.2, *)
struct LockScreenLiveActivityView: View {
    let context: ActivityViewContext<StudySessionAttributes>

    private var state: StudySessionAttributes.ContentState { context.state }
    private var attrs: StudySessionAttributes { context.attributes }

    var body: some View {
        HStack(spacing: 14) {

            // ── Izquierda: progreso circular + timer ──────────────────────
            ZStack {
                // Fondo del círculo
                Circle()
                    .stroke(Color.white.opacity(0.1), lineWidth: 5)

                // Arco de progreso
                Circle()
                    .trim(from: 0, to: CGFloat(state.progressPercent / 100.0))
                    .stroke(
                        accentColor,
                        style: StrokeStyle(lineWidth: 5, lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))

                VStack(spacing: 1) {
                    TimerLabel(
                        state: state,
                        font: .system(size: 15, weight: .bold, design: .rounded)
                    )
                    Text("restante")
                        .font(.system(size: 8, weight: .medium))
                        .foregroundColor(secondaryTxt)
                }
            }
            .frame(width: 78, height: 78)

            // ── Derecha: info de sesión ───────────────────────────────────
            VStack(alignment: .leading, spacing: 4) {

                // Cabecera: logo + estado
                HStack(spacing: 5) {
                    Image(systemName: "brain.head.profile")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(accentColor)
                    Text("IEStudio")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(accentColor)
                    Spacer()
                    if state.isPaused {
                        Label("Pausado", systemImage: "pause.circle.fill")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundColor(.yellow)
                    }
                }

                // Título del plan
                Text(attrs.sessionTitle)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.white)
                    .lineLimit(2)

                // Asignatura
                if !state.subject.isEmpty {
                    Text(state.subject)
                        .font(.system(size: 11))
                        .foregroundColor(secondaryTxt)
                        .lineLimit(1)
                }

                Spacer(minLength: 2)

                // Métricas: Focus + Distracciones
                HStack(spacing: 10) {
                    HStack(spacing: 3) {
                        Image(systemName: "bolt.fill")
                            .font(.system(size: 9))
                            .foregroundColor(focusColor(state.focusScore))
                        Text("Focus \(state.focusScore)%")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(focusColor(state.focusScore))
                    }

                    if state.distractionCount > 0 {
                        HStack(spacing: 3) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .font(.system(size: 9))
                                .foregroundColor(.orange)
                            Text("\(state.distractionCount)")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundColor(.orange)
                        }
                    }
                }

                // Barra de progreso
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(Color.white.opacity(0.1))
                            .frame(height: 3)
                        RoundedRectangle(cornerRadius: 2)
                            .fill(accentColor)
                            .frame(
                                width: geo.size.width * CGFloat(state.progressPercent / 100.0),
                                height: 3
                            )
                    }
                }
                .frame(height: 3)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(bgColor)
        .widgetURL(URL(string: "iestudio://study-arena"))
    }
}

// MARK: - Widget principal

@available(iOS 16.2, *)
struct StudyWidgetLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: StudySessionAttributes.self) { context in
            // ── Lock Screen / Notification Center ────────────────────────
            LockScreenLiveActivityView(context: context)

        } dynamicIsland: { context in
            DynamicIsland {

                // ── Dynamic Island expandida ──────────────────────────────
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 4) {
                            Image(systemName: "brain.head.profile")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundColor(accentColor)
                            Text("IEStudio")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundColor(accentColor)
                        }
                        Text(
                            context.state.subject.isEmpty
                                ? context.attributes.sessionTitle
                                : context.state.subject
                        )
                        .font(.system(size: 11))
                        .foregroundColor(.white.opacity(0.75))
                        .lineLimit(1)
                    }
                    .padding(.leading, 4)
                }

                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("Focus")
                            .font(.system(size: 10))
                            .foregroundColor(secondaryTxt)
                        Text("\(context.state.focusScore)%")
                            .font(.system(size: 16, weight: .bold, design: .rounded))
                            .foregroundColor(focusColor(context.state.focusScore))
                    }
                    .padding(.trailing, 4)
                }

                DynamicIslandExpandedRegion(.center) {
                    VStack(spacing: 1) {
                        TimerLabel(
                            state: context.state,
                            font: .system(size: 30, weight: .bold, design: .rounded)
                        )
                        if context.state.isPaused {
                            Text("PAUSADO")
                                .font(.system(size: 8, weight: .heavy))
                                .foregroundColor(.yellow)
                                .kerning(1.5)
                        } else {
                            Text("restante")
                                .font(.system(size: 10))
                                .foregroundColor(secondaryTxt)
                        }
                    }
                }

                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 8) {
                        ProgressView(value: context.state.progressPercent / 100.0)
                            .tint(accentColor)
                            .frame(maxWidth: .infinity)

                        if context.state.distractionCount > 0 {
                            HStack(spacing: 3) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .font(.system(size: 10))
                                    .foregroundColor(.orange)
                                Text("\(context.state.distractionCount)")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundColor(.orange)
                            }
                        }
                    }
                    .padding(.horizontal, 4)
                    .padding(.bottom, 2)
                }

            } compactLeading: {
                // ── Pill compacta: izquierda ─────────────────────────────
                Image(
                    systemName: context.state.isPaused
                        ? "pause.circle.fill"
                        : "brain.head.profile"
                )
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(context.state.isPaused ? .yellow : accentColor)

            } compactTrailing: {
                // ── Pill compacta: derecha (countdown) ───────────────────
                TimerLabel(
                    state: context.state,
                    font: .system(size: 12, weight: .semibold, design: .rounded)
                )

            } minimal: {
                // ── Vista mínima (cuando hay otra app con Live Activity) ──
                Image(
                    systemName: context.state.isPaused
                        ? "pause.circle.fill"
                        : "brain.head.profile"
                )
                .font(.system(size: 14))
                .foregroundColor(context.state.isPaused ? .yellow : accentColor)
            }
            .widgetURL(URL(string: "iestudio://study-arena"))
            .keylineTint(accentColor)
        }
    }
}
