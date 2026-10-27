// Real Chromium with the built extension (dist/) and a test-only driver extension that acts on
// tabs the way a user would. The extension under test only ever sees browser events, so driving
// the browser through its APIs is equivalent to clicking.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type BrowserContext, type Worker } from "playwright";
import { startFixtureProxy } from "./fixture-proxy.ts";

export type LayoutEntry = string | { group: string; tabs: string[] };

export type TabRef = number | string;

export type Options = { active?: boolean; pinned?: boolean };

const root = resolve(import.meta.dirname, "..");

/** Polls until `done` accepts the value read; returns it, or the last value on timeout. */
async function poll<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs: number,
  intervalMs = 50,
): Promise<{ value: T; ok: boolean }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return { value, ok: true };
    if (Date.now() > deadline) return { value, ok: false };
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export async function launchBrowser() {
  const proxy = await startFixtureProxy();
  const profile = mkdtempSync(join(tmpdir(), "ast-profile-"));
  const extensions = [join(root, "dist"), join(root, "e2e/driver-extension")].join(",");
  const context: BrowserContext = await chromium.launchPersistentContext(profile, {
    // The new headless mode supports extensions and tab groups; set E2E_HEADED=1 to watch.
    headless: !process.env.E2E_HEADED,
    ...(process.env.E2E_HEADED ? {} : { channel: "chromium" }),
    ignoreHTTPSErrors: true,
    proxy: { server: proxy.url, bypass: "<-loopback>" },
    args: [
      "--ignore-certificate-errors",
      `--disable-extensions-except=${extensions}`,
      `--load-extension=${extensions}`,
    ],
  });

  async function workerNamed(name: string): Promise<Worker> {
    const { value } = await poll(
      async () => {
        for (const worker of context.serviceWorkers()) {
          // evaluate never settles on a worker that has been stopped
          const manifest = await Promise.race([
            worker.evaluate(() => chrome.runtime.getManifest().name).catch(() => ""),
            new Promise<string>((resolve) => setTimeout(resolve, 1_000, "")),
          ]);
          if (manifest === name) return worker;
        }
        return undefined;
      },
      Boolean,
      10_000,
      100,
    );
    if (!value) throw new Error(`The "${name}" extension did not start`);
    return value;
  }

  const driver = await workerNamed("Auto Sort Tabs e2e driver");
  const ours = () => workerNamed("Auto Sort Tabs");
  await ours();

  async function newWindow() {
    // An unrelated tab to stay active while the test opens others in the background.
    const windowId = await driver.evaluate(async () => {
      const window = await chrome.windows.create({ url: "https://example.org/", focused: true });
      return window!.id!;
    });
    return windowHandle(windowId);
  }

  function windowHandle(windowId: number) {
    const read = () =>
      driver.evaluate(async (windowId) => {
        const [tabs, groups] = await Promise.all([
          chrome.tabs.query({ windowId }),
          chrome.tabGroups.query({ windowId }),
        ]);
        return { tabs, groups };
      }, windowId);

    const labelOf = (tab: chrome.tabs.Tab) =>
      (tab.pinned ? "pinned: " : "") + (tab.url || tab.pendingUrl || "").replace(/^https:\/\//, "");

    async function layout(): Promise<LayoutEntry[]> {
      const { tabs, groups } = await read();
      const entries: LayoutEntry[] = [];
      for (const tab of tabs) {
        const last = entries.at(-1);
        if (tab.groupId === -1) {
          entries.push(labelOf(tab));
          continue;
        }
        const title = groups.find((group) => group.id === tab.groupId)?.title ?? "";
        if (typeof last === "object" && last.group === title) last.tabs.push(labelOf(tab));
        else entries.push({ group: title, tabs: [labelOf(tab)] });
      }
      return entries;
    }

    /** A tab by id, or by its label as shown in `layout()` (must be unique). */
    async function idOf(tab: TabRef): Promise<number> {
      if (typeof tab === "number") return tab;
      const { tabs } = await read();
      const matches = tabs.filter((candidate) => labelOf(candidate) === tab);
      if (matches.length !== 1) {
        throw new Error(`Expected exactly one tab "${tab}", found ${matches.length}`);
      }
      return matches[0]!.id!;
    }

    async function loaded(tabId: number) {
      const { ok } = await poll(
        () => driver.evaluate((id) => chrome.tabs.get(id), tabId),
        (tab) => tab.status === "complete",
        10_000,
      );
      if (!ok) throw new Error(`Tab ${tabId} did not finish loading`);
    }

    return {
      windowId,
      layout,
      /** The user opens a tab (in the background unless `active`) and it finishes loading. */
      async open(url: string, { active = false, pinned = false }: Options = {}) {
        const id = await driver.evaluate(
          async ({ windowId, url, active, pinned }) =>
            (await chrome.tabs.create({ windowId, url, active, pinned })).id!,
          { windowId, url, active, pinned },
        );
        await loaded(id);
        return id;
      },
      async navigate(tab: TabRef, url: string) {
        const id = await idOf(tab);
        await driver.evaluate(({ id, url }) => chrome.tabs.update(id, { url }), { id, url });
        await loaded(id);
      },
      async activate(tab: TabRef) {
        const id = await idOf(tab);
        await driver.evaluate((id) => chrome.tabs.update(id, { active: true }), id);
      },
      async close(...tabs: TabRef[]) {
        const ids = await Promise.all(tabs.map(idOf));
        await driver.evaluate((ids) => chrome.tabs.remove(ids), ids);
      },
      /** Takes a tab out of its group. */
      async ungroup(tab: TabRef) {
        const id = await idOf(tab);
        await driver.evaluate((id) => chrome.tabs.ungroup(id), id);
      },
      /** Puts a tab into the group with this title. */
      async moveIntoGroup(tab: TabRef, title: string) {
        const id = await idOf(tab);
        await driver.evaluate(
          async ({ id, title, windowId }) => {
            const [group] = await chrome.tabGroups.query({ windowId, title });
            await chrome.tabs.group({ tabIds: [id], groupId: group!.id });
          },
          { id, title, windowId },
        );
      },
      /** The user groups tabs by hand; the extension did not make this group. */
      async userGroup(tabs: TabRef[], title: string, color: `${chrome.tabGroups.Color}` = "grey") {
        const tabIds = (await Promise.all(tabs.map(idOf))) as [number, ...number[]];
        await driver.evaluate(
          async ({ tabIds, title, color, windowId }) => {
            const id = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
            await chrome.tabGroups.update(id, { title, color });
          },
          { tabIds, title, color, windowId },
        );
      },
      /**
       * The user clicks the toolbar button or presses the shortcut. Playwright cannot press
       * browser chrome, so the same event is dispatched to the extension's own listener.
       */
      async organizeNow(how: "toolbar" | "shortcut" = "toolbar") {
        const worker = await ours();
        await worker.evaluate(
          async ({ windowId, how }) => {
            const [tab] = await chrome.tabs.query({ windowId, active: true });
            // Chromium's event objects have `dispatch`; the typings do not declare it.
            type Dispatching = { dispatch(...args: unknown[]): void };
            if (how === "toolbar")
              (chrome.action.onClicked as unknown as Dispatching).dispatch(tab);
            else
              (chrome.commands.onCommand as unknown as Dispatching).dispatch("organize-now", tab);
          },
          { windowId, how },
        );
      },
      async groupColor(title: string) {
        const { groups } = await read();
        return groups.find((group) => group.title === title)?.color;
      },
      async groupCount() {
        return (await read()).groups.length;
      },
      /** Waits until the strip looks like `expected`; fails with the last layout seen. */
      async waitForLayout(expected: LayoutEntry[], timeoutMs = 5_000) {
        const { value, ok } = await poll(
          layout,
          (actual) => JSON.stringify(actual) === JSON.stringify(expected),
          timeoutMs,
        );
        if (!ok) assert.deepEqual(value, expected, `after ${timeoutMs} ms`);
      },
      /** Waits until the strip has not changed for a while, then returns it (for "stays" checks). */
      async quietLayout(quietMs = 1_500): Promise<LayoutEntry[]> {
        let previous = JSON.stringify(await layout());
        let since = Date.now();
        for (;;) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          const current = JSON.stringify(await layout());
          if (current !== previous) [previous, since] = [current, Date.now()];
          else if (Date.now() - since >= quietMs) return JSON.parse(current);
        }
      },
    };
  }

  return {
    newWindow,
    /** Writes the extension's settings, as the options page will. */
    async setSettings(settings: Record<string, unknown>) {
      const worker = await ours();
      await worker.evaluate((settings) => chrome.storage.sync.set({ settings }), settings);
    },
    /** Stops our background worker the way the browser does when it has been idle. */
    async stopExtensionWorker() {
      const worker = await ours();
      const extensionId = new URL(worker.url()).host;
      const page = context.pages()[0] ?? (await context.newPage());
      const cdp = await context.newCDPSession(page);
      const status = new Map<string, string>();
      cdp.on("ServiceWorker.workerVersionUpdated", ({ versions }) => {
        for (const { versionId, scriptURL, runningStatus } of versions) {
          if (scriptURL.includes(extensionId)) status.set(versionId, runningStatus);
        }
      });
      await cdp.send("ServiceWorker.enable");
      const running = async () => [...status].filter(([, state]) => state === "running");
      const seen = await poll(running, (versions) => versions.length > 0, 5_000);
      if (!seen.ok) throw new Error("The extension's service worker is not running");
      for (const [versionId] of seen.value)
        await cdp.send("ServiceWorker.stopWorker", { versionId });
      // Playwright's Worker handles go stale (evaluate hangs), so watch the CDP status instead.
      const stopped = await poll(running, (versions) => versions.length === 0, 5_000);
      await cdp.detach();
      if (!stopped.ok) throw new Error("The extension's service worker did not stop");
    },
    /** Starts counting the calls that change the tab strip, as made by the extension. */
    async countMutations() {
      const worker = await ours();
      await worker.evaluate(() => {
        const calls: string[] = [];
        const tabs = chrome.tabs as Record<string, unknown>;
        const groups = chrome.tabGroups as Record<string, unknown>;
        for (const [api, name] of [
          [tabs, "move"],
          [tabs, "group"],
          [tabs, "ungroup"],
          [groups, "move"],
          [groups, "update"],
        ] as const) {
          const original = api[name] as (...args: unknown[]) => unknown;
          api[name] = (...args: unknown[]) => (calls.push(name), original.apply(api, args));
        }
        (globalThis as { calls?: string[] }).calls = calls;
      });
      return () => worker.evaluate(() => (globalThis as { calls?: string[] }).calls ?? []);
    },
    /** The extension's keyboard commands as the browser registered them. */
    async commands() {
      const worker = await ours();
      return worker.evaluate(() => chrome.commands.getAll());
    },
    async sessionState() {
      const worker = await ours();
      return worker.evaluate(() => chrome.storage.session.get(null));
    },
    async close() {
      await context.close();
      await proxy.close();
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

export type E2EBrowser = Awaited<ReturnType<typeof launchBrowser>>;
export type E2EWindow = Awaited<ReturnType<E2EBrowser["newWindow"]>>;
