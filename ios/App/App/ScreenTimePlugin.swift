import Capacitor
import FamilyControls
import Foundation
import ManagedSettings
import SwiftUI
import UIKit

// MARK: - ViewModel (iOS 16+)

@available(iOS 16.0, *)
private final class PickerModel: ObservableObject {
    @Published var selection: FamilyActivitySelection
    init(initial: FamilyActivitySelection) { self.selection = initial }
}

// MARK: - SwiftUI picker sheet (iOS 16+)

@available(iOS 16.0, *)
private struct AppPickerSheet: View {
    @ObservedObject var model: PickerModel
    let onDone: () -> Void
    let onCancel: () -> Void

    var body: some View {
        NavigationView {
            FamilyActivityPicker(selection: $model.selection)
                .navigationTitle("Bloquear apps durante estudio")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .navigationBarLeading) {
                        Button("Cancelar") { onCancel() }
                    }
                    ToolbarItem(placement: .navigationBarTrailing) {
                        Button("Listo") { onDone() }
                            .fontWeight(.semibold)
                    }
                }
        }
    }
}

// MARK: - Plugin

@objc(ScreenTimePlugin)
public class ScreenTimePlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier    = "ScreenTimePlugin"
    public let jsName        = "ScreenTime"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "presentAppPicker",    returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enableBlocking",      returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disableBlocking",     returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus",           returnType: CAPPluginReturnPromise),
    ]

    private let selectionKey = "ScreenTime.appSelection.v1"

    // MARK: - Helpers

    @available(iOS 16.0, *)
    private var store: ManagedSettingsStore { ManagedSettingsStore() }

    @available(iOS 16.0, *)
    private func loadSelection() -> FamilyActivitySelection {
        guard
            let data = UserDefaults.standard.data(forKey: selectionKey),
            let sel  = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
        else { return FamilyActivitySelection() }
        return sel
    }

    @available(iOS 16.0, *)
    private func saveSelection(_ sel: FamilyActivitySelection) {
        if let data = try? JSONEncoder().encode(sel) {
            UserDefaults.standard.set(data, forKey: selectionKey)
        }
    }

    @available(iOS 16.0, *)
    private func selectionCount(_ sel: FamilyActivitySelection) -> Int {
        sel.applicationTokens.count + sel.categoryTokens.count
    }

    // MARK: - requestAuthorization

    @objc public func requestAuthorization(_ call: CAPPluginCall) {
        guard #available(iOS 16.0, *) else {
            call.resolve(["authorized": false, "error": "Requires iOS 16+"])
            return
        }
        Task {
            do {
                try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
                print("[ScreenTime] ✅ autorización concedida")
                call.resolve(["authorized": true])
            } catch {
                // Includes the case where the FamilyControls entitlement is missing.
                let msg = error.localizedDescription
                print("[ScreenTime] ❌ autorización fallida: \(msg)")
                call.resolve(["authorized": false, "error": msg])
            }
        }
    }

    // MARK: - presentAppPicker

    @objc public func presentAppPicker(_ call: CAPPluginCall) {
        guard #available(iOS 16.0, *) else {
            call.resolve(["count": 0])
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }

            let model = PickerModel(initial: self.loadSelection())

            let sheet = AppPickerSheet(
                model: model,
                onDone: { [weak self] in
                    guard let self else { return }
                    self.saveSelection(model.selection)
                    let count = self.selectionCount(model.selection)
                    print("[ScreenTime] picker cerrado — \(count) apps/categorías seleccionadas")
                    DispatchQueue.main.async {
                        self.bridge?.viewController?.dismiss(animated: true) {
                            call.resolve(["count": count])
                        }
                    }
                },
                onCancel: { [weak self] in
                    guard let self else { return }
                    let count = self.selectionCount(model.selection)
                    DispatchQueue.main.async {
                        self.bridge?.viewController?.dismiss(animated: true) {
                            call.resolve(["count": count])
                        }
                    }
                }
            )

            let vc = UIHostingController(rootView: sheet)
            vc.modalPresentationStyle = .formSheet
            self.bridge?.viewController?.present(vc, animated: true)
        }
    }

    // MARK: - enableBlocking

    @objc public func enableBlocking(_ call: CAPPluginCall) {
        guard #available(iOS 16.0, *) else { call.resolve(); return }
        do {
            let sel = loadSelection()
            if !sel.applicationTokens.isEmpty {
                store.shield.applications = sel.applicationTokens
            }
            if !sel.categoryTokens.isEmpty {
                store.shield.applicationCategories = .specific(sel.categoryTokens)
            }
            print("[ScreenTime] ✅ bloqueando \(sel.applicationTokens.count) apps, \(sel.categoryTokens.count) categorías")
        } catch {
            print("[ScreenTime] enableBlocking falló (entitlement no disponible): \(error)")
        }
        call.resolve()
    }

    // MARK: - disableBlocking

    @objc public func disableBlocking(_ call: CAPPluginCall) {
        guard #available(iOS 16.0, *) else { call.resolve(); return }
        do {
            store.shield.applications           = nil
            store.shield.applicationCategories  = nil
            print("[ScreenTime] ✅ bloqueo desactivado")
        } catch {
            print("[ScreenTime] disableBlocking falló (entitlement no disponible): \(error)")
        }
        call.resolve()
    }

    // MARK: - getStatus

    @objc public func getStatus(_ call: CAPPluginCall) {
        guard #available(iOS 16.0, *) else {
            call.resolve(["authorized": false, "selectionCount": 0, "isBlocking": false, "supported": false])
            return
        }

        // Without the FamilyControls entitlement the API throws at runtime.
        do {
            let authStatus = AuthorizationCenter.shared.authorizationStatus
            let sel        = loadSelection()
            var isBlocking = false
            // ManagedSettingsStore also needs the entitlement; guard separately.
            do { isBlocking = store.shield.applications != nil || store.shield.applicationCategories != nil } catch {}

            call.resolve([
                "supported":      true,
                "authorized":     authStatus == .approved,
                "selectionCount": selectionCount(sel),
                "isBlocking":     isBlocking,
            ])
        } catch {
            print("[ScreenTime] getStatus falló (entitlement no disponible): \(error)")
            call.resolve(["supported": false, "authorized": false, "selectionCount": 0, "isBlocking": false])
        }
    }
}
