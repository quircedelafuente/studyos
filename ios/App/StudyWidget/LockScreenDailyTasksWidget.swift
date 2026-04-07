import AppIntents
import SwiftUI
import WidgetKit

// MARK: - Colores (mismo gradiente que Tareas diarias en home)

@available(iOS 17.0, *)
private func lockTaskRingAccent(pct: Int, empty: Bool) -> Color {
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

@available(iOS 17.0, *)
struct LockScreenDailyTasksEntry: TimelineEntry {
    let date: Date
    let built: DailyTasksWidgetBuilt
}

@available(iOS 17.0, *)
struct LockScreenDailyTasksProvider: TimelineProvider {
    func placeholder(in context: Context) -> LockScreenDailyTasksEntry {
        let built = DailyTasksWidgetBuilt(
            ring: IEWidgetDailyTasksRing(pct: 50, empty: false, done: 1, total: 2),
            mode: .list(rows: [
                ("p1", "Primera tarea del día"),
            ]),
        )
        return LockScreenDailyTasksEntry(date: Date(), built: built)
    }

    func getSnapshot(in context: Context, completion: @escaping (LockScreenDailyTasksEntry) -> Void) {
        completion(loadEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<LockScreenDailyTasksEntry>) -> Void) {
        let entry = loadEntry()
        let next = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date()
        completion(Timeline(entries: [entry], policy: .after(next)))
    }

    private func loadEntry() -> LockScreenDailyTasksEntry {
        let mirror = UserDefaults(suiteName: kAppGroupID)?.string(forKey: kChecklistMirrorKey)
        let built = DailyTasksMirrorStore.widgetBuilt(fromMirrorRaw: mirror)
        return LockScreenDailyTasksEntry(date: Date(), built: built)
    }
}

// MARK: - accessoryCircular

@available(iOS 17.0, *)
private struct LockScreenTasksCircularView: View {
    let built: DailyTasksWidgetBuilt

    var body: some View {
        let ring = built.ring
        let accent = lockTaskRingAccent(pct: ring.pct, empty: ring.empty)

        ZStack {
            switch built.mode {
            case .list(let rows):
                let first = rows[0]
                Button(intent: ToggleDailyChecklistTaskIntent(taskId: first.0)) {
                    ZStack {
                        Circle()
                            .stroke(lineWidth: 5)
                            .opacity(0.22)
                        Circle()
                            .trim(from: 0, to: CGFloat(ring.pct) / 100.0)
                            .stroke(
                                accent,
                                style: StrokeStyle(lineWidth: 5, lineCap: .round),
                            )
                            .rotationEffect(.degrees(-90))
                        VStack(spacing: 0) {
                            Image(systemName: "checklist")
                                .font(.system(size: 18, weight: .semibold))
                            Text("\(ring.done)/\(ring.total)")
                                .font(.system(size: 11, weight: .heavy, design: .rounded))
                        }
                    }
                    .padding(6)
                }
                .buttonStyle(.plain)

            case .allDone:
                ZStack {
                    Circle()
                        .stroke(accent, lineWidth: 5)
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 28, weight: .semibold))
                        .symbolRenderingMode(.palette)
                        .foregroundStyle(.primary, accent)
                }
                .padding(8)

            case .noTasksToday, .noMirror:
                Image(systemName: "checklist")
                    .font(.system(size: 26, weight: .medium))
                    .foregroundStyle(.secondary)

            }
        }
        .containerBackground(for: .widget) {
            AccessoryWidgetBackground()
        }
    }
}

// MARK: - accessoryRectangular

@available(iOS 17.0, *)
private struct LockScreenTasksRectangularView: View {
    let built: DailyTasksWidgetBuilt

    var body: some View {
        switch built.mode {
        case .list(let rows):
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Image(systemName: "checklist")
                        .font(.system(size: 12, weight: .bold))
                    Text("Tareas")
                        .font(.system(size: 13, weight: .bold))
                    Spacer(minLength: 0)
                    Text("\(built.ring.done)/\(built.ring.total)")
                        .font(.system(size: 12, weight: .heavy, design: .rounded))
                        .foregroundStyle(.secondary)
                }
                ForEach(Array(rows.prefix(2).enumerated()), id: \.offset) { _, row in
                    Button(intent: ToggleDailyChecklistTaskIntent(taskId: row.0)) {
                        HStack(spacing: 8) {
                            Image(systemName: "circle")
                                .font(.system(size: 14, weight: .semibold))
                            Text(row.1)
                                .font(.system(size: 13, weight: .semibold))
                                .lineLimit(1)
                            Spacer(minLength: 0)
                        }
                    }
                    .buttonStyle(.plain)
                }
                if rows.count > 2 {
                    Text("+\(rows.count - 2) más")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
            }

        case .allDone:
            HStack(spacing: 10) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(.green)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Tareas diarias")
                        .font(.system(size: 13, weight: .bold))
                    Text("¡Todo listo hoy!")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.secondary)
                }
            }

        case .noTasksToday:
            HStack(spacing: 8) {
                Image(systemName: "tray")
                    .font(.system(size: 18))
                    .foregroundStyle(.secondary)
                Text("Sin tareas para hoy")
                    .font(.system(size: 13, weight: .semibold))
            }

        case .noMirror:
            HStack(spacing: 8) {
                Image(systemName: "arrow.triangle.2.circlepath")
                    .font(.system(size: 16))
                Text("Abre IEStudio para sincronizar")
                    .font(.system(size: 12, weight: .medium))
                    .lineLimit(2)
            }
        }
    }
}

// MARK: - accessoryInline

@available(iOS 17.0, *)
private struct LockScreenTasksInlineView: View {
    let built: DailyTasksWidgetBuilt

    var body: some View {
        switch built.mode {
        case .list(let rows):
            let firstTitle = rows[0].1
            Text("Tareas \(built.ring.done)/\(built.ring.total) · \(firstTitle)")
                .lineLimit(1)

        case .allDone:
            Text("Tareas ✓ completado")

        case .noTasksToday:
            Text("Tareas: sin pendientes hoy")

        case .noMirror:
            Text("IEStudio · sincroniza tareas")
        }
    }
}

// MARK: - Entry

@available(iOS 17.0, *)
struct LockScreenDailyTasksEntryView: View {
    var entry: LockScreenDailyTasksEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch family {
        case .accessoryInline:
            LockScreenTasksInlineView(built: entry.built)
                .widgetURL(URL(string: "iestudio://daily-tasks"))
        case .accessoryCircular:
            LockScreenTasksCircularView(built: entry.built)
        case .accessoryRectangular:
            LockScreenTasksRectangularView(built: entry.built)
        default:
            LockScreenTasksRectangularView(built: entry.built)
        }
    }
}

/// Widget solo para **pantalla de bloqueo** (Debajo del reloj / junto al reloj / línea inline).
@available(iOS 17.0, *)
struct LockScreenDailyTasksWidget: Widget {
    let kind = DailyTasksWidgetTimelineKind.lockScreen

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: LockScreenDailyTasksProvider()) { entry in
            LockScreenDailyTasksEntryView(entry: entry)
        }
        .configurationDisplayName("Tareas (bloqueo)")
        .description("Marca tareas de la lista diaria desde la pantalla de bloqueo. Requiere iOS 17+.")
        .supportedFamilies([.accessoryInline, .accessoryRectangular, .accessoryCircular])
        .contentMarginsDisabled()
    }
}
