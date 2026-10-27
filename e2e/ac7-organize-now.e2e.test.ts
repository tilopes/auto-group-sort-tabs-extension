import assert from "node:assert/strict";
import { e2e } from "./harness.ts";
import type { E2EWindow } from "./browser.ts";

// Out of order on purpose: groups are formed in arrival order, and nothing is sorted
// automatically while auto-sort is off.
const messy = [
  "https://www.rust-lang.org/",
  "https://en.wikipedia.org/wiki/Tab_key",
  "https://github.com/nodejs/node",
  "https://www.bbc.co.uk/news",
  "https://de.wikipedia.org/wiki/Tabulator",
  "https://github.com/microsoft/TypeScript",
  "https://example.com/",
  "https://www.bbc.co.uk/sport",
  "https://fr.wikipedia.org/wiki/Tabulation",
  "https://github.com/prettier/prettier",
  "https://www.bbc.co.uk/weather",
];

const organised = [
  {
    group: "bbc.co.uk",
    tabs: ["www.bbc.co.uk/news", "www.bbc.co.uk/sport", "www.bbc.co.uk/weather"],
  },
  {
    group: "github.com",
    tabs: [
      "github.com/microsoft/TypeScript",
      "github.com/nodejs/node",
      "github.com/prettier/prettier",
    ],
  },
  {
    group: "wikipedia.org",
    tabs: [
      "de.wikipedia.org/wiki/Tabulator",
      "en.wikipedia.org/wiki/Tab_key",
      "fr.wikipedia.org/wiki/Tabulation",
    ],
  },
  "example.com/",
  "example.org/",
  "www.rust-lang.org/",
];

async function openMessy(w: E2EWindow) {
  for (const url of messy) await w.open(url);
  const before = await w.quietLayout();
  assert.notDeepEqual(before, organised, "the window should start out of order");
}

e2e("AC-7: Organize now sorts groups, their tabs and the ungrouped tabs", async (_browser, w) => {
  await openMessy(w);
  await w.organizeNow();
  await w.waitForLayout(organised);
});

e2e("AC-7: a second Organize now makes no move or group calls", async (browser, w) => {
  await openMessy(w);
  await w.organizeNow();
  await w.waitForLayout(organised);
  const calls = await browser.countMutations();
  await w.organizeNow();
  assert.deepEqual(await w.quietLayout(), organised);
  assert.deepEqual(await calls(), []);
});

e2e("AC-7: the keyboard shortcut does the same as the toolbar button", async (_browser, w) => {
  await openMessy(w);
  await w.organizeNow("shortcut");
  await w.waitForLayout(organised);
});

e2e("AC-7: the browser accepts the suggested keyboard shortcut", async (browser) => {
  const command = (await browser.commands()).find(({ name }) => name === "organize-now");
  // The shortcut is shown in platform notation (e.g. ⌥⇧O); an empty one was rejected or taken.
  assert.ok(command?.shortcut, "organize-now has no shortcut assigned");
});
