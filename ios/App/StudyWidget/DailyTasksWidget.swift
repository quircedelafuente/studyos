import AppIntents
import SwiftUI
import WidgetKit

// MARK: - Ring (gradiente adherencia como el panel)

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
    let built: DailyTasksWidgetBuilt
}

struct DailyTasksProvider: TimelineProvider {
    func placeholder(in context: Context) -> DailyTasksEntry {
        let built = DailyTasksWidgetBuilt(
            ring: IEWidgetDailyTasksRing(pct: 66, empty: false, done: 2, total: 3),
            mode: .list(rows: [
                ("p1", "Repasar tema 1"),
                ("p2", "Ejercicios cap. 2"),
                ("p3", "Lectura"),
            ]),
        )
        return DailyTasksEntry(date: Date(), built: built)
    }

    func getSnapshot(in context: Context, completion: @escaping (DailyTasksEntry) -> Void) {
        completion(loadEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DailyTasksEntry>) -> Void) {
        let entry = loadEntry()
        let next = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date()
        completion(Timeline(entries: [entry], policy: .after(next)))
    }

    private func loadEntry() -> DailyTasksEntry {
        let mirror = UserDefaults(suiteName: kAppGroupID)?.string(forKey: kChecklistMirrorKey)
        let built = DailyTasksMirrorStore.widgetBuilt(fromMirrorRaw: mirror)
        return DailyTasksEntry(date: Date(), built: built)
    }
}

// MARK: - Anillo compacto

private struct DailyTasksRingCompact: View {
    let ring: IEWidgetDailyTasksRing

    private var accent: Color {
        ringAccentColor(pct: ring.pct, empty: ring.empty)
    }

    var body: some View {
        let ringDiameter: CGFloat = 56
        let lineWidth: CGFloat = 7

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

            VStack(spacing: 0) {
                Text("\(ring.pct)%")
                    .font(.system(size: 15, weight: .heavy, design: .rounded))
                    .foregroundColor(accent)
                    .minimumScaleFactor(0.7)
                    .lineLimit(1)
                if !ring.empty {
                    Text("\(ring.done)/\(ring.total)")
                        .font(.system(size: 9, weight: .semibold, design: .rounded))
                        .foregroundColor(Color.white.opacity(0.45))
                }
            }
        }
        .frame(width: ringDiameter, height: ringDiameter)
    }
}

@available(iOS 17.0, *)
private struct TaskToggleRow: View {
    let taskId: String
    let title: String

    var body: some View {
        Button(intent: ToggleDailyChecklistTaskIntent(taskId: taskId)) {
            HStack(alignment: .center, spacing: 8) {
                Image(systemName: "circle")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(Color.white.opacity(0.55))
                Text(title)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.white)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
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

private struct TaskRowStatic: View {
    let title: String

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            Image(systemName: "circle")
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(Color.white.opacity(0.55))
            Text(title)
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(.white.opacity(0.85))
                .lineLimit(2)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 5)
        .padding(.horizontal, 8)
        .background(Color.white.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

struct DailyTasksMediumView: View {
    let entry: DailyTasksEntry

    var body: some View {
        let b = entry.built
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "checklist")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(Color(red: 52 / 255, green: 211 / 255, blue: 153 / 255))
                Text("Tareas hoy")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(.white)
                Spacer()
                Text("Diarias")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundColor(Color.white.opacity(0.45))
            }
            .padding(.horizontal, 12)
            .padding(.top, 10)
            .padding(.bottom, 8)

            HStack(alignment: .top, spacing: 12) {
                DailyTasksRingCompact(ring: b.ring)
                    .padding(.leading, 4)

                Group {
                    switch b.mode {
                    case .noMirror:
                        Text("Abre IEStudio para sincronizar tus tareas.")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(Color.white.opacity(0.55))
                            .fixedSize(horizontal: false, vertical: true)
                    case .noTasksToday:
                        Text("No hay tareas para el día de hoy.")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(Color.white.opacity(0.7))
                            .fixedSize(horizontal: false, vertical: true)
                    case .allDone:
                        VStack(alignment: .leading, spacing: 4) {
                            Text("¡100% completado!")
                                .font(.system(size: 13, weight: .bold))
                                .foregroundColor(Color.green.opacity(0.95))
                            Text("Has terminado todas las tareas diarias de hoy.")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundColor(Color.white.opacity(0.55))
                        }
                    case .list(let rows):
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(rows, id: \.0) { row in
                                if #available(iOS 17.0, *) {
                                    TaskToggleRow(taskId: row.0, title: row.1)
                                } else {
                                    TaskRowStatic(title: row.1)
                                }
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 10)

            Spacer(minLength: 0)
        }
    }
}

struct DailyTasksEntryView: View {
    var entry: DailyTasksEntry

    var body: some View {
        DailyTasksMediumView(entry: entry)
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
        .description("Hasta 3 tareas de hoy; puedes marcarlas hechas. Progreso en el anillo.")
        .supportedFamilies([.systemMedium])
        .contentMarginsDisabled()
    }
}
