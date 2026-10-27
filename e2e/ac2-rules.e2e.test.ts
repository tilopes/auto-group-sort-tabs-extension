import assert from "node:assert/strict";
import { e2e } from "./harness.ts";

e2e("AC-2: a rule groups its tabs and beats the domain default", async (browser, w) => {
  await browser.setSettings({
    rules: [
      {
        name: "Docs",
        color: "blue",
        enabled: true,
        match: {
          type: "regex",
          pattern:
            "^https://(developer\\.mozilla\\.org|developer\\.chrome\\.com|docs\\.github\\.com)/",
        },
      },
    ],
  });
  await w.open("https://developer.mozilla.org/en-US/docs/Web/API");
  await w.open("https://developer.chrome.com/docs/extensions");
  await w.open("https://docs.github.com/en");
  for (const path of ["a", "b", "c"]) await w.open(`https://github.com/${path}`);
  await w.waitForLayout([
    "example.org/",
    {
      group: "Docs",
      tabs: [
        "developer.mozilla.org/en-US/docs/Web/API",
        "developer.chrome.com/docs/extensions",
        "docs.github.com/en",
      ],
    },
    { group: "github.com", tabs: ["github.com/a", "github.com/b", "github.com/c"] },
  ]);
  assert.equal(await w.groupColor("Docs"), "blue");
});
