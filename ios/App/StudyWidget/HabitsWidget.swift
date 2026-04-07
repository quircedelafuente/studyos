import AppIntents
import SwiftUI
import WidgetKit

// Mismo gradiente rojo → verde que Tareas diarias (anillo y marco).
private func habitsRingAccentColor(pct: Int, empty: Bool) -> Color {
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

struct HabitsEntry: TimelineEntry {
    let date: Date
    let ringPct: Int
    let ringEmpty: Bool
    let ringDone: Int
    let ringTotal: Int
    let rows: [(id: String, title: String, kind: String, value: Double, unit: String, target: Double?)]
    let emptyState: String?   // nil cuando hay filas
}

struct HabitsProvider: TimelineProvider {
    func placeholder(in context: Context) -> HabitsEntry {
        HabitsEntry(
            date: Date(),
            ringPct: 33,
            ringEmpty: false,
            ringDone: 1,
            ringTotal: 3,
            rows: [
                ("h1", "Beber agua", "measure", 1, "L", 2),
                ("h2", "Meditar", "check", 0, "", nil),
                ("h3", "Leer", "check", 0, "", nil),
            ],
            emptyState: nil,
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (HabitsEntry) -> Void) {
        completion(loadEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<HabitsEntry>) -> Void) {
        let entry = loadEntry()
        let next = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date()
        completion(Timeline(entries: [entry], policy: .after(next)))
    }

    private func loadEntry() -> HabitsEntry {
        let stats = HabitsMirrorStore.todayRingStats()
        let top = HabitsMirrorStore.topTodayPending(max: 3)

        if top.isEmpty {
            let defaults = UserDefaults(suiteName: kAppGroupID)
            let hasHabits = (defaults?.string(forKey: kHabitsMirrorKey) ?? "").isEmpty == false
            let msg: String
            if !hasHabits {
                msg = "Abre IEStudio para sincronizar"
            } else if stats.total > 0 && stats.done >= stats.total {
                msg = "¡Todo completado!"
            } else {
                msg = "Sin hábitos pendientes"
            }
            return HabitsEntry(
                date: Date(),
                ringPct: stats.pct,
                ringEmpty: stats.empty,
                ringDone: stats.done,
                ringTotal: stats.total,
                rows: [],
                emptyState: msg,
            )
        }

        return HabitsEntry(
            date: Date(),
            ringPct: stats.pct,
            ringEmpty: stats.empty,
            ringDone: stats.done,
            ringTotal: stats.total,
            rows: top.map { ($0.id, $0.title, $0.kind, $0.value, $0.unit, $0.target) },
            emptyState: nil,
        )
    }
}

// MARK: - Anillo (igual enfoque que DailyTasks)

private struct HabitsRingCompact: View {
    let pct: Int
    let empty: Bool
    let done: Int
    let total: Int

    private var accent: Color {
        habitsRingAccentColor(pct: pct, empty: empty)
    }

    var body: some View {
        let ringDiameter: CGFloat = 56
        let lineWidth: CGFloat = 7

        ZStack {
            Circle()
                .stroke(Color.white.opacity(0.12), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: CGFloat(pct) / 100.0)
                .stroke(
                    accent,
                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .round),
                )
                .rotationEffect(.degrees(-90))

            VStack(spacing: 0) {
                Text("\(pct)%")
                    .font(.system(size: 15, weight: .heavy, design: .rounded))
                    .foregroundColor(accent)
                    .minimumScaleFactor(0.7)
                    .lineLimit(1)
                if !empty {
                    Text("\(done)/\(total)")
                        .font(.system(size: 9, weight: .semibold, design: .rounded))
                        .foregroundColor(Color.white.opacity(0.45))
                }
            }
        }
        .frame(width: ringDiameter, height: ringDiameter)
    }
}

private func habitFractionLabel(kind: String, value: Double, target: Double?) -> String {
    if kind != "measure" {
        return "0/1"
    }
    if let t = target, t > 0 {
        let den = max(1, Int(ceil(t)))
        let num = min(den, max(0, Int(floor(value + 0.0001))))
        return "\(num)/\(den)"
    }
    return value > 0 ? "1/1" : "0/1"
}

// MARK: - Filas

@available(iOS 17.0, *)
private struct HabitRowInteractive: View {
    let id: String
    let title: String
    let kind: String
    let value: Double
    let unit: String
    let target: Double?

    private var fraction: String {
        habitFractionLabel(kind: kind, value: value, target: target)
    }

    var body: some View {
        if kind == "measure" {
            Button(intent: AddHabitMeasureOneIntent(habitId: id)) {
                HStack(alignment: .center, spacing: 8) {
                    Text(title)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.white)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 4)
                    Text(fraction)
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                        .foregroundColor(Color.white.opacity(0.75))
                        .monospacedDigit()
                    if !unit.isEmpty {
                        Text(unit)
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundColor(Color.white.opacity(0.4))
                            .lineLimit(1)
                    }
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(Color.green.opacity(0.9))
                }
                .padding(.vertical, 5)
                .padding(.horizontal, 8)
                .background(Color.white.opacity(0.06))
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .buttonStyle(.plain)
        } else {
            Button(intent: ToggleHabitIntent(habitId: id)) {
                HStack(alignment: .center, spacing: 8) {
                    Image(systemName: "circle")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(Color.white.opacity(0.55))
                    Text(title)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.white)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 4)
                    Text(fraction)
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                        .foregroundColor(Color.white.opacity(0.55))
                        .monospacedDigit()
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(Color.green.opacity(0.9))
                }
                .padding(.vertical, 5)
                .padding(.horizontal, 8)
                .background(Color.white.opacity(0.06))
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .buttonStyle(.plain)
        }
    }
}

private struct HabitRowStatic: View {
    let title: String
    let fraction: String

    var body: some View {
        HStack(spacing: 8) {
            Text(title)
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(.white.opacity(0.85))
                .lineLimit(2)
            Spacer(minLength: 4)
            Text(fraction)
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .foregroundColor(Color.white.opacity(0.5))
        }
        .padding(.vertical, 5)
        .padding(.horizontal, 8)
        .background(Color.white.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

private struct HabitsMediumView: View {
    let entry: HabitsEntry

    private var accent: Color {
        habitsRingAccentColor(pct: entry.ringPct, empty: entry.ringEmpty)
    }

    private var frameCorner: CGFloat { 20 }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: frameCorner, style: .continuous)
                .stroke(accent, lineWidth: 3)
                .shadow(color: accent.opacity(0.35), radius: 4, y: 0)

            VStack(alignment: .leading, spacing: 0) {
                Spacer(minLength: 0)

                HStack(alignment: .center, spacing: 12) {
                    HabitsRingCompact(
                        pct: entry.ringPct,
                        empty: entry.ringEmpty,
                        done: entry.ringDone,
                        total: entry.ringTotal,
                    )
                    .padding(.leading, 4)

                    Group {
                        if let msg = entry.emptyState {
                            Text(msg)
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundColor(Color.white.opacity(0.65))
                                .fixedSize(horizontal: false, vertical: true)
                        } else {
                            VStack(alignment: .leading, spacing: 6) {
                                ForEach(entry.rows, id: \.0) { r in
                                    if #available(iOS 17.0, *) {
                                        HabitRowInteractive(
                                            id: r.0,
                                            title: r.1,
                                            kind: r.2,
                                            value: r.3,
                                            unit: r.4,
                                            target: r.5,
                                        )
                                    } else {
                                        HabitRowStatic(
                                            title: r.1,
                                            fraction: habitFractionLabel(kind: r.2, value: r.3, target: r.5),
                                        )
                                    }
                                }
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, 10)

                Spacer(minLength: 0)
            }
            .padding(6)
        }
        .padding(4)
    }
}

struct HabitsEntryView: View {
    var entry: HabitsEntry

    var body: some View {
        HabitsMediumView(entry: entry)
    }
}

struct HabitsWidget: Widget {
    let kind = "HabitsWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: HabitsProvider()) { entry in
            HabitsEntryView(entry: entry)
                .ieStudyTrendWidgetBackground()
                .widgetURL(URL(string: "iestudio://habits"))
        }
        .configurationDisplayName("Hábitos")
        .description("Hasta 3 hábitos pendientes; medida con x/y y +1. Progreso en anillo y marco.")
        .supportedFamilies([.systemMedium])
        .contentMarginsDisabled()
    }
}
