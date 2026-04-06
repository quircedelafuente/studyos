#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(WidgetDataPlugin, "WidgetData",
           CAP_PLUGIN_METHOD(sync, CAPPluginReturnPromise);
)
