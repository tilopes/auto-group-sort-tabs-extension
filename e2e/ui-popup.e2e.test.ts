import assert from "node:assert/strict";
import { e2e } from "./harness.ts";

const github = ["https://github.com/a", "https://github.com/b", "https://github.com/c"];

e2e(
  "popup: the toggles show the stored settings and save what the user changes",
  async (browser, w) => {
    const popup = await w.openPopup();
    assert.equal(await popup.isChecked("#autoGroup"), true, "auto-group is on by default");
    assert.equal(await popup.isChecked("#autoSort"), false, "auto-sort is off by default");

    await popup.check("#autoSort");
    await popup.uncheck("#autoGroup");
    await popup.close();

    const stored = await browser.storedSettings();
    assert.equal(stored.autoSort, true);
    assert.equal(stored.autoGroup, false);
    assert.equal(stored.version, 1);

    const reopened = await w.openPopup();
    assert.equal(await reopened.isChecked("#autoGroup"), false);
    assert.equal(await reopened.isChecked("#autoSort"), true);
  },
);

e2e(
  "popup: turning auto-group off stops grouping, and Organize now still groups",
  async (_browser, w) => {
    const popup = await w.openPopup();
    await popup.uncheck("#autoGroup");
    for (const url of github) await w.open(url);
    assert.deepEqual(await w.quietLayout(), ["example.org/", ...github.map((u) => u.slice(8))]);

    await w.organizeNow();
    await w.waitForLayout([
      { group: "github.com", tabs: github.map((u) => u.slice(8)) },
      "example.org/",
    ]);
  },
);
