// Runs the real shell against the fake browser with mocked timers, so tests describe what a
// user sees after opening, navigating and closing tabs.
import { mock } from "node:test";
import { defaultSettings, type Settings } from "../src/core/types.ts";
import { wire } from "../src/shell/wire.ts";
import { FakeBrowser, WINDOW_ID, type TabSpec } from "./fake-browser.ts";

export type Scenario = ReturnType<typeof scenario>;

const MAX_ROUNDS = 50;
/** Longer than any debounce or maximum wait. */
const QUIET_MS = 2_500;

export function scenario(specs: readonly TabSpec[], overrides: Partial<Settings> = {}) {
  mock.timers.reset();
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });

  const browser = new FakeBrowser(specs);
  browser.storage.sync.seed({ settings: { ...defaultSettings, ...overrides } });
  let shell = wire(browser.api);

  /** Lets the extension react to everything that happened, as time passes. */
  async function drain() {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      await new Promise((resolve) => setImmediate(resolve));
      if (!shell.hasPending()) {
        await shell.idle();
        await new Promise((resolve) => setImmediate(resolve));
        if (!shell.hasPending()) return;
      }
      mock.timers.tick(QUIET_MS);
      await shell.idle();
    }
    throw new Error("The extension never went quiet");
  }

  return {
    browser,
    layout: () => browser.layout(),
    /** The "Organize now" button. */
    async organizeNow() {
      shell.organizeNow(WINDOW_ID);
      await drain();
    },
    /** "Organize now" is clicked in the popup, which is open on this window. */
    async clickPopupOrganizeNow() {
      browser.sendMessage({ type: "organize-now", windowId: WINDOW_ID });
      await drain();
    },
    /** The keyboard shortcut is pressed. */
    async pressShortcut(command = "organize-now") {
      browser.pressShortcut(command);
      await drain();
    },
    /** Time passes: events that were reported are handled. */
    settle: drain,
    /** The browser starts and restores its session. */
    async startBrowser() {
      browser.onStartup.fire();
      await drain();
    },
    /** The extension's background script is stopped and started again. */
    async restartWorker() {
      await drain();
      browser.stopWorker();
      shell = wire(browser.api);
    },
    /** Advances time without letting a quiet period pass in one go. */
    async advance(ms: number) {
      await new Promise((resolve) => setImmediate(resolve));
      mock.timers.tick(ms);
      await shell.idle();
    },
  };
}
