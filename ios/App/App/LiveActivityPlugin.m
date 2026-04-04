#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Registra el plugin con Capacitor (descubrimiento automático via macro)
CAP_PLUGIN(LiveActivityPlugin, "LiveActivity",
           CAP_PLUGIN_METHOD(isSupported, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(start, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(update, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(end, CAPPluginReturnPromise);
)
