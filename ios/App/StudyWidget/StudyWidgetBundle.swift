import SwiftUI
import WidgetKit

@main
struct StudyWidgetBundle: WidgetBundle {
    var body: some Widget {
        if #available(iOS 16.2, *) {
            StudyWidgetLiveActivity()
        }
    }
}
