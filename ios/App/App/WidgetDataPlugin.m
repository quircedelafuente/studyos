#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(WidgetDataPlugin, "WidgetData",
           CAP_PLUGIN_METHOD(sync, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(syncDailyTasksRing, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(syncDailyChecklistMirror, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(reconcileChecklistFromAppGroup, CAPPluginReturnPromise);
)
