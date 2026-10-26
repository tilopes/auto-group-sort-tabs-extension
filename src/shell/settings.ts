import { defaultSettings, type Settings } from "../core/types.ts";
import type { BrowserApi } from "./api.ts";

const KEY = "settings";

/** User settings from `storage.sync`, over the defaults; reloaded when they change. */
export function createSettingsStore(api: BrowserApi) {
  let current: Promise<Settings> | undefined;

  const load = () =>
    api.storage.sync
      .get(KEY)
      .then((items): Settings => ({ ...defaultSettings, ...(items[KEY] as Partial<Settings>) }));

  api.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && KEY in changes) current = undefined;
  });

  return { get: () => (current ??= load()) };
}
