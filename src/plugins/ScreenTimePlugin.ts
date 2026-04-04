import { registerPlugin } from "@capacitor/core";

export interface ScreenTimeStatus {
  supported: boolean;
  authorized: boolean;
  selectionCount: number;
  isBlocking: boolean;
}

export interface ScreenTimePlugin {
  /** Solicita autorización de FamilyControls (.individual) al usuario. */
  requestAuthorization(): Promise<{ authorized: boolean; error?: string }>;

  /** Abre el selector nativo de apps (FamilyActivityPicker). */
  presentAppPicker(): Promise<{ count: number }>;

  /** Activa el escudo de Screen Time para las apps seleccionadas. */
  enableBlocking(): Promise<void>;

  /** Desactiva el escudo (durante pausa o al terminar la sesión). */
  disableBlocking(): Promise<void>;

  /** Estado actual: autorización, número de apps seleccionadas y si hay bloqueo activo. */
  getStatus(): Promise<ScreenTimeStatus>;
}

const ScreenTime = registerPlugin<ScreenTimePlugin>("ScreenTime");

export default ScreenTime;
