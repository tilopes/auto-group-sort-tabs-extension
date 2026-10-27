import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { launchBrowser } from "./browser.ts";
import { e2e } from "./harness.ts";

test(
  "AC-10: settings saved in the options page survive a browser restart",
  { timeout: 90_000 },
  async () => {
    const profile = mkdtempSync(join(tmpdir(), "ast-profile-"));
    const first = await launchBrowser({ profile });
    try {
      const page = await (await first.newWindow()).openOptions();
      await page.selectOption("#strategy", "hostname");
      await page.fill("#minTabs", "2");
      await page.click("#addRule");
      const row = page.locator("li.rule");
      await row.getByLabel("Group name").fill("Docs");
      await row.getByLabel("Pattern").fill("docs.github.com");
      await page.click("button[type=submit]");
      await page.getByText("Saved.").waitFor();
      const saved = await first.storedSettings();
      await first.close();

      const second = await launchBrowser({ profile });
      try {
        assert.deepEqual(await second.storedSettings(), saved);
        const window = await second.newWindow();
        const reopened = await window.openOptions();
        assert.equal(await reopened.locator("#strategy").inputValue(), "hostname");
        assert.equal(await reopened.locator("#minTabs").inputValue(), "2");
        assert.equal(await reopened.locator("li.rule .name").inputValue(), "Docs");

        // The restarted extension applies them too: two tabs are enough for a group now.
        await window.open("https://docs.github.com/a");
        await window.open("https://docs.github.com/b");
        await window.waitForLayout([
          "example.org/",
          { group: "Docs", tabs: ["docs.github.com/a", "docs.github.com/b"] },
        ]);
      } finally {
        await second.close();
      }
    } finally {
      rmSync(profile, { recursive: true, force: true });
    }
  },
);

e2e("options: settings too big for storage.sync are refused visibly", async (browser, w) => {
  const page = await w.openOptions();
  const rules = Array.from({ length: 120 }, (_, i) => ({
    name: `Rule number ${i}`,
    enabled: true,
    match: { type: "host", pattern: `site-${i}.example.com` },
  }));
  await page.locator("#json").fill(JSON.stringify({ rules }));
  await page.click("#import");
  await page.getByText(/Not imported: .*quota/i).waitFor();
  assert.equal(await browser.storedSettings(), undefined);
});
