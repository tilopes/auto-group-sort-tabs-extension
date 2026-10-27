import { parseSettings } from "../core/settings.ts";
import type { Settings } from "../core/types.ts";
import type { BrowserApi } from "./api.ts";

const KEY = "settings";

type SyncStorage = Pick<BrowserApi["storage"], "sync">;

/** The effective settings: whatever `storage.sync` holds, validated over the defaults. */
export async function loadSettings({ sync }: SyncStorage): Promise<Settings> {
  return parseSettings((await sync.get(KEY))[KEY]);
}

/** Rejects when the browser refuses the write, e.g. over the `storage.sync` quota. */
export function saveSettings({ sync }: SyncStorage, settings: Settings): Promise<void> {
  return sync.set({ [KEY]: settings });
}

/** The settings for the background worker; reloaded when they change. */
export function createSettingsStore(api: BrowserApi) {
  let current: Promise<Settings> | undefined;

  api.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && KEY in changes) current = undefined;
  });

  return { get: () => (current ??= loadSettings(api.storage)) };
}
