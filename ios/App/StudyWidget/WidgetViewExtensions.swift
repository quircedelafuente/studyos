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
}
