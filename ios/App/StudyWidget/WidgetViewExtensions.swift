import SwiftUI
import WidgetKit

extension View {
    /// Aplica containerBackground en iOS 17+ y un fondo plano en versiones anteriores.
    @ViewBuilder
    func ieWidgetBackground() -> some View {
        if #available(iOS 17.0, *) {
            self.containerBackground(.fill.tertiary, for: .widget)
        } else {
            self.background(Color(UIColor.systemBackground))
        }
    }

    /// Fondo negro para widgets que deben combinar con estilo “dark” del gráfico StudyTrend.
    @ViewBuilder
    func ieStudyTrendWidgetBackground() -> some View {
        if #available(iOS 17.0, *) {
            self.containerBackground(Color.black, for: .widget)
        } else {
            self.background(Color.black)
        }
    }
}
