import assert from "node:assert/strict";
import { e2e } from "./harness.ts";
import type { E2EWindow } from "./browser.ts";

const github = [
  "github.com/microsoft/TypeScript",
  "github.com/nodejs/node",
  "github.com/prettier/prettier",
];
const bbc = ["www.bbc.co.uk/news", "www.bbc.co.uk/sport", "www.bbc.co.uk/weather"];

async function twoGroups(w: E2EWindow) {
  for (const path of github) await w.open(`https://${path}`);
  for (const path of bbc) await w.open(`https://${path}`);
  await w.waitForLayout([
    "example.org/",
    { group: "github.com", tabs: github },
    { group: "bbc.co.uk", tabs: bbc },
  ]);
}

e2e("AC-3: navigating a tab moves it to the group of its new domain", async (_browser, w) => {
  await twoGroups(w);
  await w.navigate("github.com/nodejs/node", "https://www.bbc.co.uk/food");
  await w.waitForLayout([
    "example.org/",
    { group: "github.com", tabs: [github[0]!, github[2]!] },
    { group: "bbc.co.uk", tabs: ["www.bbc.co.uk/food", ...bbc] },
  ]);
});

e2e("AC-3: a group left with one tab by navigation dissolves", async (_browser, w) => {
  await twoGroups(w);
  await w.navigate("github.com/nodejs/node", "https://www.bbc.co.uk/food");
  await w.navigate("github.com/prettier/prettier", "https://example.com/");
  await w.waitForLayout([
    "example.org/",
    github[0]!,
    "example.com/",
    { group: "bbc.co.uk", tabs: ["www.bbc.co.uk/food", ...bbc] },
  ]);
});

e2e(
  "AC-3: closing tabs dissolves a group left with one (another tab active)",
  async (_browser, w) => {
    await twoGroups(w);
    await w.close(bbc[1]!, bbc[2]!);
    await w.waitForLayout(["example.org/", { group: "github.com", tabs: github }, bbc[0]!]);
  },
);

e2e("AC-3: taking tabs out of a group until one is left dissolves it", async (_browser, w) => {
  await twoGroups(w);
  await w.ungroup(github[0]!);
  await w.waitForLayout([
    "example.org/",
    github[0]!,
    { group: "github.com", tabs: [github[1]!, github[2]!] },
    { group: "bbc.co.uk", tabs: bbc },
  ]);
  await w.ungroup(github[1]!);
  await w.waitForLayout(["example.org/", ...github, { group: "bbc.co.uk", tabs: bbc }]);
});

e2e("AC-3: moving tabs into another group dissolves a group left with one", async (_browser, w) => {
  await twoGroups(w);
  await w.moveIntoGroup(github[0]!, "bbc.co.uk");
  await w.moveIntoGroup(github[1]!, "bbc.co.uk");
  await w.waitForLayout([
    "example.org/",
    github[2]!,
    { group: "bbc.co.uk", tabs: [github[1]!, github[0]!, ...bbc] },
  ]);
});

e2e("AC-3: a lone active tab keeps its group until the user switches away", async (_browser, w) => {
  await twoGroups(w);
  await w.activate(bbc[0]!);
  await w.close(bbc[1]!, bbc[2]!);
  assert.deepEqual(await w.quietLayout(), [
    "example.org/",
    { group: "github.com", tabs: github },
    { group: "bbc.co.uk", tabs: [bbc[0]!] },
  ]);
  await w.activate("example.org/");
  await w.waitForLayout(["example.org/", { group: "github.com", tabs: github }, bbc[0]!]);
});
