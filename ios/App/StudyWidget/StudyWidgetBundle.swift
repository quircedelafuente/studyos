import SwiftUI
import WidgetKit

@main
struct StudyWidgetBundle: WidgetBundle {
    var body: some Widget {
        // Home screen widgets (iOS 14+)
        DeadlinesWidget()
        TodaySessionWidget()
        ActiveSessionWidget()
        BBDeliveriesWidget()
        UpcomingEntregasWidget()
        StudyTrendWidget()
        DailyTasksWidget()
        HabitsWidget()

        // Live Activity (iOS 16.2+)
        if #available(iOS 16.2, *) {
            StudyWidgetLiveActivity()
        }
    }
}
