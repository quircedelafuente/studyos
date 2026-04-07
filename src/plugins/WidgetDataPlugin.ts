import { registerPlugin } from "@capacitor/core";

export interface WidgetDataPlugin {
  sync(options: { json: string }): Promise<void>;
  /** Solo el objeto { pct, empty, done, total }; persiste en App Group y recarga el widget de tareas. */
  syncDailyTasksRing(options: { json: string }): Promise<void>;
  /** JSON completo `iestudio-daily-checklist-v1` para el widget interactivo. */
  syncDailyChecklistMirror(options: { json: string }): Promise<void>;
  /** Lee el mirror del App Group para fusionar en la web si el usuario editó desde el widget. */
  reconcileChecklistFromAppGroup(): Promise<{ mirror: string | null }>;
}

const WidgetData = registerPlugin<WidgetDataPlugin>("WidgetData");

export default WidgetData;
