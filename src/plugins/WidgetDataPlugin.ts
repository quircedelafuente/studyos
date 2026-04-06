import { registerPlugin } from "@capacitor/core";

export interface WidgetDataPlugin {
  sync(options: { json: string }): Promise<void>;
  /** Solo el objeto { pct, empty, done, total }; persiste en App Group y recarga el widget de tareas. */
  syncDailyTasksRing(options: { json: string }): Promise<void>;
}

const WidgetData = registerPlugin<WidgetDataPlugin>("WidgetData");

export default WidgetData;
