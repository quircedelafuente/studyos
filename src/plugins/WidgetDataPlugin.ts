import { registerPlugin } from "@capacitor/core";

export interface WidgetDataPlugin {
  sync(options: { json: string }): Promise<void>;
}

const WidgetData = registerPlugin<WidgetDataPlugin>("WidgetData");

export default WidgetData;
