import AppIntents
import SwiftUI
import WidgetKit

private let habitsBrand = Color(red: 52 / 255, green: 211 / 255, blue: 153 / 255)

// MARK: - Timeline

struct HabitsEntry: TimelineEntry {
    let date: Date
    let rows: [(id: String, title: String, kind: String, value: Double, unit: String)]
    let emptyState: String?   // nil cuando hay filas
}

struct HabitsProvider: TimelineProvider {
    func placeholder(in context: Context) -> HabitsEntry {
        HabitsEntry(
            date: Date(),
            rows: [
                ("h1", "Beber agua", "measure", 1.0, "L"),
                ("h2", "Meditar", "check", 0, ""),
                ("h3", "Leer", "check", 0, ""),
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
        let top = HabitsMirrorStore.topToday(max: 3)
        if top.isEmpty {
            // Diferenciar: sin mirror vs sin hábitos pendientes
            let defaults = UserDefaults(suiteName: kAppGroupID)
            let hasHabits = (defaults?.string(forKey: kHabitsMirrorKey) ?? "").isEmpty == false
            let msg = hasHabits ? "Todo completado" : "Abre IEStudio para sincronizar"
            return HabitsEntry(date: Date(), rows: [], emptyState: msg)
        }
        return HabitsEntry(
            date: Date(),
            rows: top.map { ($0.id, $0.title, $0.kind, $0.value, $0.unit) },
            emptyState: nil,
        )
    }
}

// MARK: - UI

@available(iOS 17.0, *)
private struct HabitRowInteractive: View {
    let id: String
    let title: String
    let kind: String
    let value: Double
    let unit: String

    var body: some View {
        if kind == "measure" {
            HStack(spacing: 8) {
                Text(title)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.white)
                    .lineLimit(2)
                Spacer(minLength: 0)
                Text(String(format: "%.1f%@", value, unit.isEmpty ? "" : " \(unit)"))
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundColor(Color.white.opacity(0.55))
                    .lineLimit(1)
                Button(intent: AddHabitMeasureIntent(habitId: id, delta: 0.25)) {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(habitsBrand.opacity(0.95))
                }
                .buttonStyle(.plain)
            }
            .padding(.vertical, 6)
            .padding(.horizontal, 10)
            .background(Color.white.opacity(0.06))
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        } else {
            Button(intent: ToggleHabitIntent(habitId: id)) {
                HStack(spacing: 8) {
                    Image(systemName: "circle")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(Color.white.opacity(0.55))
                    Text(title)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.white)
                        .lineLimit(2)
                    Spacer(minLength: 0)
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(habitsBrand.opacity(0.95))
                }
                .padding(.vertical, 6)
                .padding(.horizontal, 10)
                .background(Color.white.opacity(0.06))
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .buttonStyle(.plain)
        }
    }
}

private struct HabitsMediumView: View {
    let entry: HabitsEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer(minLength: 0)
            if let msg = entry.emptyState {
                Text(msg)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(Color.white.opacity(0.65))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(entry.rows, id: \.id) { r in
                        if #available(iOS 17.0, *) {
                            HabitRowInteractive(id: r.id, title: r.title, kind: r.kind, value: r.value, unit: r.unit)
                        } else {
                            // iOS <17: sin interacción, solo lista
                            HStack(spacing: 8) {
                                Text(r.title)
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundColor(Color.white.opacity(0.85))
                                    .lineLimit(2)
                                Spacer(minLength: 0)
                            }
                            .padding(.vertical, 6)
                            .padding(.horizontal, 10)
                            .background(Color.white.opacity(0.06))
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 10)
            }
            Spacer(minLength: 0)
        }
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
        .description("Marca hábitos rápidamente desde el widget.")
        .supportedFamilies([.systemMedium])
        .contentMarginsDisabled()
    }
}

