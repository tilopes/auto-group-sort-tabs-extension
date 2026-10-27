import assert from "node:assert/strict";
import { e2e } from "./harness.ts";

e2e("AC-5: a group the user made is left alone", async (_browser, w) => {
  await w.open("https://github.com/1");
  await w.open("https://github.com/2");
  await w.userGroup(["github.com/1", "github.com/2"], "Mine", "purple");
  for (const path of ["3", "4", "5"]) await w.open(`https://github.com/${path}`);
  await w.waitForLayout([
    "example.org/",
    { group: "Mine", tabs: ["github.com/1", "github.com/2"] },
    { group: "github.com", tabs: ["github.com/3", "github.com/4", "github.com/5"] },
  ]);

  await w.navigate("github.com/1", "https://www.bbc.co.uk/news");
  await w.waitForLayout([
    "example.org/",
    { group: "Mine", tabs: ["www.bbc.co.uk/news", "github.com/2"] },
    { group: "github.com", tabs: ["github.com/3", "github.com/4", "github.com/5"] },
  ]);
  const settled = await w.quietLayout();
  assert.deepEqual(settled[1], { group: "Mine", tabs: ["www.bbc.co.uk/news", "github.com/2"] });
});
