import { classify } from "../core/classify.ts";
import { organize } from "../core/organize.ts";
import type { Trigger } from "../core/types.ts";
import type { BrowserApi } from "./api.ts";
import { execute } from "./executor.ts";
import { createScheduler, type RunResult, type Work } from "./scheduler.ts";
import { createSettingsStore } from "./settings.ts";
import { readSnapshot } from "./snapshot.ts";
import { createStateStore } from "./state.ts";

/** Each run applies membership changes, then ordering; a few extra passes absorb stray events. */
const MAX_PASSES = 6;
/** Windows opened this soon after the browser starts are session-restore windows. */
const STARTUP_WINDOW_MS = 10_000;

export function wire(api: BrowserApi) {
  const settingsStore = createSettingsStore(api);
  const stateStore = createStateStore(api);
  let startupUntil = 0;

  const triggerOf = (work: Work): Trigger =>
    work.full ? { mode: work.full } : { mode: "auto", dirtyTabIds: work.dirtyTabIds };

  async function run(windowId: number, work: Work): Promise<RunResult> {
    const trigger = triggerOf(work);
    const deferred = new Set<number>();
    try {
      for (let pass = 0; pass < MAX_PASSES; pass++) {
        const [settings, state, snapshot] = await Promise.all([
          settingsStore.get(),
          stateStore.get(),
          readSnapshot(api, windowId),
        ]);
        const keys = work.full
          ? Object.fromEntries(
              snapshot.tabs.map((tab) => [tab.id, classify(tab, settings)?.title ?? null]),
            )
          : {};
        const result = organize({ snapshot, settings, state, trigger });
        result.deferred.forEach((id) => deferred.add(id));

        const inWindow = new Set(snapshot.tabs.map((tab) => tab.id));
        await stateStore.update((current) => ({
          keys: { ...current.keys, ...keys },
          groups: {
            ...current.groups,
            ...Object.fromEntries(
              result.adopted.map((id) => [
                id,
                {
                  createdAt: Date.now(),
                  title: snapshot.groups.find((group) => group.id === id)?.title ?? "",
                },
              ]),
            ),
          },
          pending: [...current.pending.filter((id) => !inWindow.has(id)), ...result.pending],
        }));
        if (!result.ops.length) return { deferred: [...deferred], failed: false };

        const created = await execute(api, windowId, result.ops);
        await stateStore.update((current) => ({
          ...current,
          groups: {
            ...current.groups,
            ...Object.fromEntries(
              created.map(({ groupId, title }) => [groupId, { createdAt: Date.now(), title }]),
            ),
          },
        }));
      }
      console.warn("Auto Sort Tabs: window did not settle");
    } catch (error) {
      console.warn("Auto Sort Tabs: run failed", error);
    }
    return { deferred: [...deferred], failed: true };
  }

  const scheduler = createScheduler(run);

  api.tabs.onCreated.addListener(async (tab) => {
    if (tab.id === undefined) return;
    const settings = await settingsStore.get();
    const key = classify({ url: tab.url || tab.pendingUrl || "" }, settings)?.title ?? null;
    const id = tab.id;
    await stateStore.update((state) => ({ ...state, keys: { ...state.keys, [id]: key } }));
    scheduler.markDirty(tab.windowId, tab.id);
  });

  api.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.url === undefined) return;
    const next = classify({ url: changeInfo.url }, await settingsStore.get())?.title ?? null;
    const { keys } = await stateStore.get();
    if (tabId in keys && keys[tabId] === next) return;
    await stateStore.update((state) => ({ ...state, keys: { ...state.keys, [tabId]: next } }));
    scheduler.markDirty(tab.windowId, tabId);
  });

  api.tabs.onActivated.addListener(({ windowId }) => scheduler.retryDeferred(windowId));

  api.tabs.onRemoved.addListener(async (tabId, { windowId, isWindowClosing }) => {
    scheduler.forgetTab(tabId);
    // A group left with a single tab dissolves, so closing tabs needs a run too.
    if (!isWindowClosing) scheduler.markChanged(windowId);
    await stateStore.update((state) => {
      const { [tabId]: _gone, ...keys } = state.keys;
      return { ...state, keys, pending: state.pending.filter((id) => id !== tabId) };
    });
  });

  api.tabGroups.onRemoved.addListener(async ({ id }) => {
    await stateStore.update((state) => {
      const { [id]: _gone, ...groups } = state.groups;
      return { ...state, groups };
    });
  });

  async function startupPass() {
    for (const window of await api.windows.getAll()) {
      if (window.id !== undefined) scheduler.requestFull(window.id, "startup");
    }
  }

  api.runtime.onStartup.addListener(() => {
    startupUntil = Date.now() + STARTUP_WINDOW_MS;
    return startupPass();
  });

  api.windows.onCreated.addListener((window) => {
    if (window.id !== undefined && Date.now() < startupUntil) {
      scheduler.requestFull(window.id, "startup");
    }
  });

  api.runtime.onInstalled.addListener(({ reason }) => {
    // Not on update: a full pass would pull back tabs the user has moved out of groups.
    if (reason === "install") return startupPass();
  });

  return {
    organizeNow(windowId: number) {
      scheduler.requestFull(windowId, "manual");
    },
    idle: scheduler.idle,
    hasPending: scheduler.hasPending,
  };
}
