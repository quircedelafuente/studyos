import Capacitor
import Foundation

/// Subclase de CAPBridgeViewController que registra los plugins inline
/// (LiveActivityPlugin, ScreenTimePlugin, WidgetDataPlugin).
///
/// cap sync solo añade a packageClassList los plugins de NPM; los plugins
/// Swift escritos directamente en el target App nunca aparecen ahí.
/// registerPluginInstance() no comprueba autoRegisterPlugins, por lo que
/// funciona sin desactivar el registro automático.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(LiveActivityPlugin())
        bridge?.registerPluginInstance(ScreenTimePlugin())
        bridge?.registerPluginInstance(WidgetDataPlugin())
    }
}
