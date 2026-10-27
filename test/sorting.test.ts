import assert from "node:assert/strict";
import { test } from "node:test";
import { scenario } from "./harness.ts";

test("'Organize now' puts groups first, then ungrouped tabs, each sorted by domain", async () => {
  const w = scenario([
    "zebra.org",
    "beta.com/1",
    "apple.net",
    "beta.com/2",
    "beta.com/3",
    "alpha.io/1",
    "alpha.io/2",
    "alpha.io/3",
  ]);
  await w.organizeNow();
  assert.deepEqual(w.layout(), [
    { group: "alpha.io", tabs: ["alpha.io/1", "alpha.io/2", "alpha.io/3"] },
    { group: "beta.com", tabs: ["beta.com/1", "beta.com/2", "beta.com/3"] },
    "apple.net",
    "zebra.org",
  ]);
});

test("running 'Organize now' again changes nothing", async () => {
  const w = scenario(["z.org", "b.com/1", "a.net", "b.com/2", "b.com/3", "y.org"]);
  await w.organizeNow();
  w.browser.calls = [];
  await w.organizeNow();
  assert.equal(w.browser.mutations().length, 0);
});

test("ungrouped tabs from one domain are sorted by title, and special pages go last", async () => {
  const w = scenario([
    "about:blank",
    { url: "a.com/2", title: "Beta" },
    "b.com",
    { url: "a.com/1", title: "Alpha" },
  ]);
  await w.organizeNow();
  assert.deepEqual(w.layout(), ["a.com/1", "a.com/2", "b.com", "about:blank"]);
});

test("tabs inside a group can be sorted by most recently used", async () => {
  const w = scenario(
    [
      { url: "a.com/old", lastAccessed: 1 },
      { url: "a.com/new", lastAccessed: 3 },
      { url: "a.com/mid", lastAccessed: 2 },
    ],
    { tabSort: "lastAccessed" },
  );
  await w.organizeNow();
  assert.deepEqual(w.layout(), [{ group: "a.com", tabs: ["a.com/new", "a.com/mid", "a.com/old"] }]);
});

test("groups can be sorted by size, largest first", async () => {
  const w = scenario(
    ["a.com/1", "a.com/2", "a.com/3", "b.com/1", "b.com/2", "b.com/3", "b.com/4"],
    { groupSort: "size" },
  );
  await w.organizeNow();
  assert.deepEqual(
    w.layout().map((entry) => (typeof entry === "string" ? entry : entry.group)),
    ["b.com", "a.com"],
  );
});

test("groups the user made keep their slot while ours are sorted around them", async () => {
  const w = scenario([
    "loose.net",
    { url: "zeta.com/1", group: "zeta.com" },
    { url: "zeta.com/2", group: "zeta.com" },
    { url: "zeta.com/3", group: "zeta.com" },
    { url: "r.org/1", group: "Reading" },
    { url: "r.org/2", group: "Reading" },
    { url: "alpha.com/1", group: "alpha.com" },
    { url: "alpha.com/2", group: "alpha.com" },
    { url: "alpha.com/3", group: "alpha.com" },
  ]);
  await w.organizeNow();
  assert.deepEqual(
    w.layout().map((entry) => (typeof entry === "string" ? entry : entry.group)),
    ["alpha.com", "Reading", "zeta.com", "loose.net"],
  );
});

test("automatic sorting is off by default: new tabs stay where the browser put them", async () => {
  const w = scenario(["b.com", "d.com", { url: "a.com", active: true }]);
  w.browser.openTab("c.com");
  await w.settle();
  assert.deepEqual(w.layout(), ["b.com", "d.com", "a.com", "c.com"]);
});

test("with automatic sorting on, a new tab is inserted in order with a single move", async () => {
  const w = scenario(["b.com", "d.com", "f.com", { url: "z.com", active: true }], {
    autoSort: true,
  });
  await w.organizeNow();
  w.browser.calls = [];
  w.browser.openTab("c.com");
  await w.settle();
  assert.deepEqual(w.layout(), ["b.com", "c.com", "d.com", "f.com", "z.com"]);
  assert.equal(w.browser.mutations().length, 1);
});

test("automatic sorting does not rearrange tabs the user placed", async () => {
  const w = scenario(["a.com", "b.com", "c.com", { url: "d.com", active: true }], {
    autoSort: true,
  });
  w.browser.dragTab("a.com", 2);
  w.browser.calls = [];
  w.browser.openTab("e.com");
  await w.settle();
  assert.deepEqual(w.layout(), ["b.com", "c.com", "a.com", "d.com", "e.com"]);
});

test("the active tab is not moved by automatic runs, and is placed once it is no longer active", async () => {
  const w = scenario(["b.com", "d.com", "f.com", { url: "x.org", active: true }], {
    autoSort: true,
  });
  await w.organizeNow();
  w.browser.openTab("c.com");
  w.browser.activate("c.com");
  await w.settle();
  assert.deepEqual(w.layout(), ["b.com", "d.com", "f.com", "x.org", "c.com"]);

  w.browser.activate("b.com");
  await w.settle();
  assert.deepEqual(w.layout(), ["b.com", "c.com", "d.com", "f.com", "x.org"]);
});

test("the active tab counts towards a new group but joins it only once the user leaves it", async () => {
  const w = scenario(["a.com/1", "a.com/2", { url: "x.org", active: true }]);
  await w.organizeNow();
  w.browser.openTab("a.com/3");
  w.browser.activate("a.com/3");
  await w.settle();
  assert.deepEqual(w.layout(), [
    { group: "a.com", tabs: ["a.com/1", "a.com/2"] },
    "x.org",
    "a.com/3",
  ]);

  w.browser.activate("x.org");
  await w.settle();
  assert.deepEqual(w.layout(), [
    { group: "a.com", tabs: ["a.com/1", "a.com/2", "a.com/3"] },
    "x.org",
  ]);
});

test("'Organize now' moves the active tab too", async () => {
  const w = scenario(["b.com", { url: "a.com", active: true }]);
  await w.organizeNow();
  assert.deepEqual(w.layout(), ["a.com", "b.com"]);
});

const unorganised = [
  "z.org",
  "b.com/1",
  { url: "a.net", active: true },
  "b.com/2",
  "b.com/3",
] as const;
const organised = [{ group: "b.com", tabs: ["b.com/1", "b.com/2", "b.com/3"] }, "a.net", "z.org"];

test("clicking the toolbar button groups and sorts the window, and a second click changes nothing", async () => {
  const w = scenario(unorganised);
  await w.clickToolbarButton();
  assert.deepEqual(w.layout(), organised);
  w.browser.calls = [];
  await w.clickToolbarButton();
  assert.equal(w.browser.mutations().length, 0);
});

test("the keyboard shortcut does the same as the toolbar button", async () => {
  const w = scenario(unorganised);
  await w.pressShortcut();
  assert.deepEqual(w.layout(), organised);
});

test("other keyboard commands do nothing", async () => {
  const w = scenario(unorganised);
  await w.pressShortcut("something-else");
  assert.deepEqual(
    w.layout(),
    [...unorganised].map((tab) => (typeof tab === "string" ? tab : tab.url)),
  );
});

test("in a window that is not focused, automatic sorting may move the active tab", async () => {
  const w = scenario(["b.com", "d.com", { url: "z.org", active: true }], { autoSort: true });
  await w.organizeNow();
  w.browser.focused = false;
  w.browser.openTab("c.com");
  w.browser.activate("c.com");
  await w.settle();
  assert.deepEqual(w.layout(), ["b.com", "c.com", "d.com", "z.org"]);
});
