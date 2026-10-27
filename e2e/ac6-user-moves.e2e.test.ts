import assert from "node:assert/strict";
import { e2e } from "./harness.ts";
import type { E2EWindow } from "./browser.ts";

const bbc = ["www.bbc.co.uk/sport", "www.bbc.co.uk/weather", "www.bbc.co.uk/food"];

/** github.com {a, b, c} and bbc.co.uk {sport, weather, food}, with the user's own tab dragged out. */
async function dragOutOfGithub(w: E2EWindow) {
  for (const path of ["a", "b", "c"]) await w.open(`https://github.com/${path}`);
  for (const path of bbc) await w.open(`https://${path}`);
  await w.waitForLayout([
    "example.org/",
    { group: "github.com", tabs: ["github.com/a", "github.com/b", "github.com/c"] },
    { group: "bbc.co.uk", tabs: bbc },
  ]);
  await w.ungroup("github.com/b");
}

e2e("AC-6: a tab taken out of a group stays out", async (_browser, w) => {
  await dragOutOfGithub(w);
  await w.open("https://github.com/rust-lang/rust");
  await w.navigate("github.com/b", "https://github.com/golang/go");
  assert.deepEqual(await w.quietLayout(), [
    "example.org/",
    { group: "github.com", tabs: ["github.com/a", "github.com/c", "github.com/rust-lang/rust"] },
    "github.com/golang/go",
    { group: "bbc.co.uk", tabs: bbc },
  ]);
});

e2e("AC-6: it stays out after the background worker was stopped", async (browser, w) => {
  await dragOutOfGithub(w);
  await browser.stopExtensionWorker();
  await w.navigate("github.com/b", "https://github.com/golang/go");
  assert.deepEqual(await w.quietLayout(), [
    "example.org/",
    { group: "github.com", tabs: ["github.com/a", "github.com/c"] },
    "github.com/golang/go",
    { group: "bbc.co.uk", tabs: bbc },
  ]);
});

e2e("AC-6: it joins the group of its new domain when it navigates there", async (_browser, w) => {
  await dragOutOfGithub(w);
  await w.navigate("github.com/b", "https://www.bbc.co.uk/news");
  await w.waitForLayout([
    "example.org/",
    { group: "github.com", tabs: ["github.com/a", "github.com/c"] },
    { group: "bbc.co.uk", tabs: ["www.bbc.co.uk/news", ...bbc] },
  ]);
});

e2e("AC-6: a tab the user put into a group stays there", async (_browser, w) => {
  await dragOutOfGithub(w);
  await w.moveIntoGroup("github.com/a", "bbc.co.uk");
  assert.deepEqual(await w.quietLayout(), [
    "example.org/",
    { group: "github.com", tabs: ["github.com/c"] },
    "github.com/b",
    { group: "bbc.co.uk", tabs: ["github.com/a", ...bbc] },
  ]);
});
