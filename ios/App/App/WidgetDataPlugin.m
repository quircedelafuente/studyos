#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(WidgetDataPlugin, "WidgetData",
           CAP_PLUGIN_METHOD(sync, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(syncDailyTasksRing, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(syncDailyChecklistMirror, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(reconcileChecklistFromAppGroup, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(syncHabitsMirror, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(syncHabitLogsMirror, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(reconcileHabitsFromAppGroup, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(reconcileHabitLogsFromAppGroup, CAPPluginReturnPromise);
)
