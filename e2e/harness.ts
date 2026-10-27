import { test } from "node:test";
import { launchBrowser, type E2EBrowser, type E2EWindow } from "./browser.ts";

/** A test that gets a fresh Chromium with the extension and an empty window to work in. */
export function e2e(name: string, body: (browser: E2EBrowser, window: E2EWindow) => Promise<void>) {
  test(name, { timeout: 60_000 }, async () => {
    const browser = await launchBrowser();
    try {
      await body(browser, await browser.newWindow());
    } finally {
      await browser.close();
    }
  });
}
