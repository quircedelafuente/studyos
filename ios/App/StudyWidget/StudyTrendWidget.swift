import SwiftUI
import WidgetKit

// MARK: - Data

private let studyTrendBrand = Color(red: 99 / 255, green: 102 / 255, blue: 241 / 255)

// MARK: - Timeline

struct StudyTrendEntry: TimelineEntry {
    let date: Date
    let points: [IEWidgetStudyTrendPoint]
}

struct StudyTrendProvider: TimelineProvider {
    func placeholder(in context: Context) -> StudyTrendEntry {
        StudyTrendEntry(date: Date(), points: placeholderPoints())
    }

    func getSnapshot(in context: Context, completion: @escaping (StudyTrendEntry) -> Void) {
        let pts = IEWidgetData.load().studyTrend ?? placeholderPoints()
        completion(StudyTrendEntry(date: Date(), points: pts))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<StudyTrendEntry>) -> Void) {
        let data = IEWidgetData.load()
        let pts = data.studyTrend ?? []
        let entry = StudyTrendEntry(date: Date(), points: pts.isEmpty ? placeholderPoints() : pts)
        let next = Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? Date()
        completion(Timeline(entries: [entry], policy: .after(next)))
    }

    private func placeholderPoints() -> [IEWidgetStudyTrendPoint] {
        (0 ..< 13).map { i in
            IEWidgetStudyTrendPoint(
                label: i == 6 ? "Hoy" : "·",
                hours: i == 6 ? 2.0 : (i % 4 == 0 ? 1.0 : 0.3),
                isToday: i == 6,
            )
        }
    }
}

// MARK: - Chart (mismo enfoque que el SVG del dashboard: área + línea + puntos)

struct StudyTrendMediumChart: View {
    let points: [IEWidgetStudyTrendPoint]

    private func xPos(i: Int, w: CGFloat, px: CGFloat, n: Int) -> CGFloat {
        px + (w - px * 2) * CGFloat(i) / CGFloat(max(n - 1, 1))
    }

    private func yPos(v: Double, py: CGFloat, chH: CGFloat, maxHrs: Double) -> CGFloat {
        py + chH - chH * CGFloat(v / maxHrs)
    }

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            let px: CGFloat = 6
            let py: CGFloat = 4
            let labelH: CGFloat = 10
            let chH = max(12, h - py * 2 - labelH)
            let n = max(points.count, 1)
            let maxHrs = max(0.5, points.map(\.hours).max() ?? 0.5)

            ZStack(alignment: .topLeading) {
                ForEach([0.25, 0.5, 0.75, 1.0], id: \.self) { f in
                    Path { pth in
                        let y = yPos(v: f * maxHrs, py: py, chH: chH, maxHrs: maxHrs)
                        pth.move(to: CGPoint(x: px, y: y))
                        pth.addLine(to: CGPoint(x: w - px, y: y))
                    }
                    .stroke(Color.white.opacity(0.08), style: StrokeStyle(lineWidth: 0.6, dash: [3, 5]))
                }

                if let idx = points.firstIndex(where: { $0.isToday }), idx < n {
                    Path { pth in
                        let x = xPos(i: idx, w: w, px: px, n: n)
                        pth.move(to: CGPoint(x: x, y: py))
                        pth.addLine(to: CGPoint(x: x, y: py + chH))
                    }
                    .stroke(studyTrendBrand.opacity(0.35), style: StrokeStyle(lineWidth: 0.8, dash: [3, 4]))
                }

                if n > 1 {
                    Path { pth in
                        for (i, pt) in points.enumerated() {
                            let x = xPos(i: i, w: w, px: px, n: n)
                            let y = yPos(v: pt.hours, py: py, chH: chH, maxHrs: maxHrs)
                            if i == 0 { pth.move(to: CGPoint(x: x, y: y)) }
                            else { pth.addLine(to: CGPoint(x: x, y: y)) }
                        }
                        pth.addLine(to: CGPoint(x: xPos(i: n - 1, w: w, px: px, n: n), y: py + chH))
                        pth.addLine(to: CGPoint(x: xPos(i: 0, w: w, px: px, n: n), y: py + chH))
                        pth.closeSubpath()
                    }
                    .fill(
                        LinearGradient(
                            colors: [studyTrendBrand.opacity(0.22), studyTrendBrand.opacity(0)],
                            startPoint: .top,
                            endPoint: .bottom,
                        ),
                    )
                }

                Path { pth in
                    for (i, pt) in points.enumerated() {
                        let x = xPos(i: i, w: w, px: px, n: n)
                        let y = yPos(v: pt.hours, py: py, chH: chH, maxHrs: maxHrs)
                        if i == 0 { pth.move(to: CGPoint(x: x, y: y)) }
                        else { pth.addLine(to: CGPoint(x: x, y: y)) }
                    }
                }
                .stroke(studyTrendBrand.opacity(0.9), style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))

                ForEach(Array(points.enumerated()), id: \.offset) { i, pt in
                    Group {
                        if pt.hours > 0 || pt.isToday {
                            Circle()
                                .fill(pt.isToday ? studyTrendBrand : Color.white)
                                .frame(width: pt.isToday ? 7 : 5, height: pt.isToday ? 7 : 5)
                                .overlay(
                                    Circle().stroke(studyTrendBrand, lineWidth: pt.isToday ? 1.6 : 1.2),
                                )
                                .position(
                                    x: xPos(i: i, w: w, px: px, n: n),
                                    y: yPos(v: pt.hours, py: py, chH: chH, maxHrs: maxHrs),
                                )
                        }
                    }
                }

                ForEach(Array(points.enumerated()), id: \.offset) { i, pt in
                    Group {
                        let show = pt.isToday || i == 0 || i == n - 1 || i % 3 == 0
                        if show && !pt.label.isEmpty && pt.label != "·" {
                            Text(pt.label)
                                .font(.system(size: 7, weight: pt.isToday ? .heavy : .medium))
                                .foregroundColor(pt.isToday ? studyTrendBrand : Color.white.opacity(0.38))
                                .position(x: xPos(i: i, w: w, px: px, n: n), y: h - labelH / 2)
                        }
                    }
                }

                Text(String(format: "%.1fh", maxHrs))
                    .font(.system(size: 6, weight: .semibold))
                    .foregroundColor(studyTrendBrand.opacity(0.65))
                    .position(x: px + 14, y: py + 6)
            }
        }
    }
}

struct StudyTrendMediumView: View {
    let points: [IEWidgetStudyTrendPoint]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 5) {
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(studyTrendBrand)
                Text("StudyTrend")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(studyTrendBrand)
                Spacer()
                Text("±6 días")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundColor(Color.white.opacity(0.45))
            }
            .padding(.horizontal, 12)
            .padding(.top, 10)
            .padding(.bottom, 6)

            StudyTrendMediumChart(points: points)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(.horizontal, 10)
                .padding(.bottom, 10)
        }
    }
}

struct StudyTrendEntryView: View {
    var entry: StudyTrendEntry

    var body: some View {
        StudyTrendMediumView(points: entry.points)
    }
}

// MARK: - Widget (solo mediano: 2 celdas de ancho × 1 de alto en la pantalla de inicio)

struct StudyTrendWidget: Widget {
    let kind = "StudyTrendWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: StudyTrendProvider()) { entry in
            StudyTrendEntryView(entry: entry)
                .ieStudyTrendWidgetBackground()
                .widgetURL(URL(string: "iestudio://dashboard"))
        }
        .configurationDisplayName("StudyTrend")
        .description("Horas de estudio por día (sesiones en calendario), misma escala que el panel.")
        .supportedFamilies([.systemMedium])
        .contentMarginsDisabled()
    }
}
