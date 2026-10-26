import assert from "node:assert/strict";
import { test } from "node:test";
import { scenario } from "./harness.ts";

test("pinned tabs are neither grouped nor counted towards a group", async () => {
  const w = scenario([
    { url: "github.com/p1", pinned: true },
    { url: "github.com/p2", pinned: true },
    "github.com/a",
    "github.com/b",
  ]);
  await w.organizeNow();
  assert.deepEqual(w.layout(), [
    "pinned: github.com/p1",
    "pinned: github.com/p2",
    "github.com/a",
    "github.com/b",
  ]);
  assert.ok(!w.browser.touched.has(w.browser.idOf("github.com/p1")));
});

test("pinned tabs never move when the rest is sorted", async () => {
  const w = scenario([
    { url: "z.com", pinned: true },
    { url: "y.com", pinned: true },
    "b.com",
    "a.com",
  ]);
  await w.organizeNow();
  assert.deepEqual(w.layout(), ["pinned: z.com", "pinned: y.com", "a.com", "b.com"]);
});

test("tabs in a group the user made are never regrouped, moved or reordered", async () => {
  const w = scenario([
    { url: "github.com/z", group: "Reading" },
    { url: "github.com/y", group: "Reading" },
    { url: "github.com/x", group: "Reading" },
    "github.com/a",
    "github.com/b",
  ]);
  await w.organizeNow();
  assert.deepEqual(w.layout(), [
    { group: "Reading", tabs: ["github.com/z", "github.com/y", "github.com/x"] },
    "github.com/a",
    "github.com/b",
  ]);
  for (const url of ["github.com/z", "github.com/y", "github.com/x"]) {
    assert.ok(!w.browser.touched.has(w.browser.idOf(url)), `${url} was touched`);
  }
});

test("tabs are never moved into a group the user made", async () => {
  const w = scenario([
    { url: "github.com/a", group: "Reading" },
    { url: "github.com/b", group: "Reading" },
    "github.com/c",
  ]);
  w.browser.openTab("github.com/d");
  await w.settle();
  assert.deepEqual(w.layout(), [
    { group: "Reading", tabs: ["github.com/a", "github.com/b"] },
    "github.com/c",
    "github.com/d",
  ]);
});

test("a group the user renamed stops being ours", async () => {
  const w = scenario(["github.com/c", "github.com/a", "github.com/b"]);
  await w.organizeNow();
  w.browser.userUpdateGroup("github.com", { title: "Mine" });
  w.browser.calls = [];
  await w.organizeNow();
  assert.deepEqual(w.layout(), [
    { group: "Mine", tabs: ["github.com/a", "github.com/b", "github.com/c"] },
  ]);
  assert.equal(w.browser.mutations().length, 0);
});

test("a group left over from a previous session is adopted when its title is still a key we would use", async () => {
  const w = scenario([
    { url: "github.com/a", group: "github.com" },
    { url: "github.com/b", group: "github.com" },
    { url: "x.org", active: true },
  ]);
  w.browser.openTab("github.com/c");
  await w.settle();
  assert.deepEqual(w.layout(), [
    { group: "github.com", tabs: ["github.com/a", "github.com/b", "github.com/c"] },
    "x.org",
  ]);
});

test("a tab the user dragged out of a group is not pulled back by automatic runs", async () => {
  const w = scenario([
    "github.com/a",
    "github.com/b",
    "github.com/c",
    { url: "x.org", active: true },
  ]);
  await w.organizeNow();
  w.browser.dragTab("github.com/b", 3);
  w.browser.openTab("unrelated.net");
  await w.settle();
  assert.deepEqual(w.layout(), [
    { group: "github.com", tabs: ["github.com/a", "github.com/c"] },
    "x.org",
    "github.com/b",
    "unrelated.net",
  ]);
});

test("a tab the user dragged into a group stays there until it navigates elsewhere", async () => {
  const w = scenario([
    "github.com/a",
    "github.com/b",
    "github.com/c",
    { url: "x.org", active: true },
  ]);
  await w.organizeNow();
  w.browser.dragTab("x.org", 1);
  w.browser.openTab("unrelated.net");
  await w.settle();
  assert.deepEqual(w.layout()[0], {
    group: "github.com",
    tabs: ["github.com/a", "x.org", "github.com/b", "github.com/c"],
  });

  w.browser.navigate("x.org", "other.net");
  w.browser.activate("github.com/a");
  await w.settle();
  assert.ok(!JSON.stringify(w.layout()[0]).includes("other.net"));
});

test("'Organize now' re-evaluates tabs the user moved by hand", async () => {
  const w = scenario([
    "github.com/a",
    "github.com/b",
    "github.com/c",
    { url: "x.org", active: true },
  ]);
  await w.organizeNow();
  w.browser.dragTab("github.com/b", 3);
  await w.organizeNow();
  assert.deepEqual(w.layout(), [
    { group: "github.com", tabs: ["github.com/a", "github.com/b", "github.com/c"] },
    "x.org",
  ]);
});

test("a collapsed group stays collapsed", async () => {
  const w = scenario(["github.com/c", "github.com/a", "github.com/b"]);
  await w.organizeNow();
  w.browser.userUpdateGroup("github.com", { collapsed: true });
  w.browser.calls = [];
  w.browser.dragTab("github.com/c", 0);
  await w.organizeNow();
  assert.equal(w.browser.group("github.com").collapsed, true);
  assert.ok(!w.browser.calls.includes("tabGroups.update"));
});

test("a tab dragged out of a group stays out when another tab of that domain joins the group", async () => {
  const w = scenario([
    "github.com/a",
    "github.com/b",
    "github.com/c",
    { url: "x.org", active: true },
  ]);
  await w.organizeNow();
  w.browser.dragTab("github.com/c", 3);
  w.browser.openTab("github.com/d");
  await w.settle();
  assert.deepEqual(w.layout(), [
    { group: "github.com", tabs: ["github.com/a", "github.com/b", "github.com/d"] },
    "x.org",
    "github.com/c",
  ]);
});

test("a tab dragged out of a group stays out when its domain later forms a new group", async () => {
  const w = scenario([
    "github.com/a",
    "github.com/b",
    "github.com/c",
    { url: "x.org", active: true },
  ]);
  await w.organizeNow();
  w.browser.dragTab("github.com/c", 3);
  w.browser.navigate("github.com/b", "elsewhere.net");
  await w.settle();
  assert.ok(
    w.layout().every((entry) => typeof entry === "string"),
    "the group dissolved",
  );

  w.browser.openTab("github.com/d");
  await w.settle();
  w.browser.openTab("github.com/e");
  await w.settle();
  assert.deepEqual(w.layout()[0], {
    group: "github.com",
    tabs: ["github.com/a", "github.com/d", "github.com/e"],
  });
  assert.ok(w.layout().includes("github.com/c"), "the dragged tab is still ungrouped");
});

test("a tab left ungrouped when the window was organised is not grouped by later unrelated activity", async () => {
  const w = scenario(["a.com/1", "a.com/2", { url: "x.org", active: true }]);
  await w.organizeNow();
  w.browser.dragTab("a.com/2", 0);
  w.browser.openTab("unrelated.net");
  await w.settle();
  assert.ok(w.layout().every((entry) => typeof entry === "string"));
});
