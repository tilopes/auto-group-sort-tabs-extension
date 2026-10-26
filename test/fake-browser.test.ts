// The fake stands in for the browser in every other test, so its own rules are pinned down here.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeBrowser } from "./fake-browser.ts";

test("a tab dropped between two members of a group joins it", async () => {
  const b = new FakeBrowser(["a.com", { url: "x", group: "G" }, { url: "y", group: "G" }]);
  await b.api.tabs.move(b.idOf("a.com"), { index: 1 });
  assert.deepEqual(b.layout(), [{ group: "G", tabs: ["x", "a.com", "y"] }]);
});

test("a tab dragged away from its group leaves it", () => {
  const b = new FakeBrowser([{ url: "x", group: "G" }, { url: "y", group: "G" }, "loose.com"]);
  b.dragTab("x", 2);
  assert.deepEqual(b.layout(), [{ group: "G", tabs: ["y"] }, "loose.com", "x"]);
});

test("moving a tab across the pinned boundary fails silently", async () => {
  const b = new FakeBrowser([{ url: "p", pinned: true }, "a.com", "b.com"]);
  const moved = await b.api.tabs.move(b.idOf("a.com"), { index: 0 });
  assert.deepEqual(moved, []);
  assert.deepEqual(b.layout(), ["pinned: p", "a.com", "b.com"]);
});

test("a group cannot be moved into the middle of another group", async () => {
  const b = new FakeBrowser([
    { url: "x", group: "G" },
    { url: "y", group: "G" },
    { url: "z", group: "H" },
  ]);
  await assert.rejects(() => b.api.tabGroups.move(b.group("H").id, { index: 1 }));
});

test("a group disappears when its last tab leaves", async () => {
  const b = new FakeBrowser([{ url: "x", group: "G" }, "a.com"]);
  await b.api.tabs.ungroup(b.idOf("x"));
  assert.deepEqual(b.layout(), ["x", "a.com"]);
});
