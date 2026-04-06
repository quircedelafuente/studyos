import Capacitor
import Foundation
import WidgetKit

@objc(WidgetDataPlugin)
public class WidgetDataPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier      = "WidgetDataPlugin"
    public let jsName          = "WidgetData"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise),
    ]

    /// Recibe un JSON string con todos los datos del widget y los persiste en
    /// el App Group compartido con la extensión StudyWidget.
    @objc public func sync(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("Missing json parameter")
            return
        }

        guard let defaults = UserDefaults(suiteName: "group.com.agustmun.iestudio") else {
            call.reject("App Group not available — check entitlements")
            return
        }

        defaults.set(json, forKey: "iestudio_widget_data")
        defaults.synchronize()

        // Pedir a WidgetKit que recargue todas las timelines
        WidgetCenter.shared.reloadAllTimelines()

        call.resolve()
    }
}
