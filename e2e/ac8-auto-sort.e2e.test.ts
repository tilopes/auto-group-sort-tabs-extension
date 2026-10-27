import assert from "node:assert/strict";
import { e2e } from "./harness.ts";

e2e("AC-8 with auto-sort: a new tab is inserted in sorted position", async (browser, w) => {
  await browser.setSettings({ autoSort: true });
  await w.open("https://www.rust-lang.org/");
  await w.open("https://example.com/");
  await w.waitForLayout(["example.com/", "example.org/", "www.rust-lang.org/"]);
});

e2e(
  "AC-8 with auto-sort: the active tab is placed once the user switches away",
  async (browser, w) => {
    await browser.setSettings({ autoSort: true });
    for (const path of ["microsoft/TypeScript", "prettier/prettier", "webpack/webpack"]) {
      await w.open(`https://github.com/${path}`);
    }
    // Groups come before ungrouped tabs, so the new group moves in front of the initial tab.
    await w.waitForLayout([
      {
        group: "github.com",
        tabs: [
          "github.com/microsoft/TypeScript",
          "github.com/prettier/prettier",
          "github.com/webpack/webpack",
        ],
      },
      "example.org/",
    ]);

    await w.open("https://github.com/nodejs/node", { active: true });
    assert.deepEqual((await w.quietLayout()).at(-1), "github.com/nodejs/node");

    await w.activate("example.org/");
    await w.waitForLayout([
      {
        group: "github.com",
        tabs: [
          "github.com/microsoft/TypeScript",
          "github.com/nodejs/node",
          "github.com/prettier/prettier",
          "github.com/webpack/webpack",
        ],
      },
      "example.org/",
    ]);
  },
);
