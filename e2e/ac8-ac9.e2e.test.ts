import assert from "node:assert/strict";
import { e2e } from "./harness.ts";

e2e("AC-8: the active tab is not moved until the user switches away", async (_browser, w) => {
  await w.open("https://github.com/a");
  await w.open("https://github.com/b");
  await w.open("https://example.net/");
  await w.navigate("example.org/", "https://github.com/vercel/next.js");
  await w.waitForLayout([
    "github.com/vercel/next.js",
    { group: "github.com", tabs: ["github.com/a", "github.com/b"] },
    "example.net/",
  ]);
  assert.equal((await w.quietLayout())[0], "github.com/vercel/next.js");

  await w.activate("example.net/");
  await w.waitForLayout([
    { group: "github.com", tabs: ["github.com/vercel/next.js", "github.com/a", "github.com/b"] },
    "example.net/",
  ]);
});

e2e("AC-9: tabs without a groupable address stay ungrouped", async (_browser, w) => {
  const urls = ["about:blank", "chrome://settings/", "chrome://newtab/", "file:///etc/hosts"];
  for (const url of urls) for (let i = 0; i < 3; i++) await w.open(url);
  const layout = await w.quietLayout();
  assert.ok(
    layout.every((entry) => typeof entry === "string"),
    JSON.stringify(layout),
  );
  assert.equal(layout.length, 1 + urls.length * 3, JSON.stringify(layout));
});
