// The extension as a whole: browser events in, tab strip out, with time passing.
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { scenario } from "./harness.ts";

const quietly = () => mock.method(console, "warn", () => {});
const count = (calls: string[], name: string) => calls.filter((call) => call === name).length;

const githubGroup = (...paths: string[]) => ({
  group: "github.com",
  tabs: paths.map((path) => `github.com/${path}`),
});

test("a burst of tabs is handled once, after things calm down", async () => {
  const w = scenario([{ url: "x.org", active: true }]);
  for (const path of ["a", "b", "c", "d", "e"]) w.browser.openTab(`github.com/${path}`);
  await w.advance(200);
  assert.deepEqual(w.browser.mutations(), [], "nothing happens while tabs keep arriving");
  await w.settle();
  assert.deepEqual(w.layout(), ["x.org", githubGroup("a", "b", "c", "d", "e")]);
  assert.equal(count(w.browser.mutations(), "tabs.group"), 1);
});

test("a continuous stream of tabs is still handled within two seconds", async () => {
  const w = scenario([{ url: "x.org", active: true }]);
  for (let i = 0; i < 9; i++) {
    w.browser.openTab(`github.com/${i}`);
    await w.advance(250);
  }
  assert.ok(
    w.layout().some((entry) => typeof entry === "object"),
    "a group exists before the stream ends",
  );
});

test("a tab that is still loading when the extension runs is grouped once it has a URL", async () => {
  const w = scenario([{ url: "x.org", active: true }]);
  w.browser.openTab("github.com/a");
  w.browser.openTab("github.com/b");
  await w.settle();
  const c = w.browser.openTab("github.com/c", { loading: true });
  await w.settle();
  w.browser.finishLoading(c);
  await w.settle();
  assert.deepEqual(w.layout(), ["x.org", githubGroup("a", "b", "c")]);
});

test("a tab closed before the extension reacts is left alone", async () => {
  const w = scenario([{ url: "x.org", active: true }]);
  w.browser.openTab("github.com/a");
  w.browser.openTab("github.com/b");
  const c = w.browser.openTab("github.com/c");
  w.browser.closeTab(c);
  await w.settle();
  assert.deepEqual(w.browser.mutations(), []);
});

test("a failed run is retried and the window ends up organised", async () => {
  quietly();
  const w = scenario([{ url: "x.org", active: true }]);
  for (const path of ["a", "b", "c"]) w.browser.openTab(`github.com/${path}`);
  w.browser.failNext("tabs.group");
  await w.settle();
  assert.deepEqual(w.layout(), ["x.org", githubGroup("a", "b", "c")]);
});

test("a window that keeps failing is given up on after three attempts", async () => {
  quietly();
  const w = scenario([{ url: "x.org", active: true }]);
  for (const path of ["a", "b", "c"]) w.browser.openTab(`github.com/${path}`);
  w.browser.failNext("tabs.group", 100);
  await w.settle();
  assert.equal(count(w.browser.calls, "tabs.group"), 3);
  assert.deepEqual(w.layout(), ["x.org", "github.com/a", "github.com/b", "github.com/c"]);
});

test("a group that cannot be titled is not left behind untitled", async () => {
  quietly();
  const w = scenario([{ url: "x.org", active: true }]);
  for (const path of ["a", "b", "c"]) w.browser.openTab(`github.com/${path}`);
  w.browser.failNext("tabGroups.update");
  await w.settle();
  assert.ok(w.browser.mutations().includes("tabs.ungroup"));
  assert.deepEqual(w.layout(), ["x.org", githubGroup("a", "b", "c")]);
});

test("a move the browser silently refuses counts as a failure and is retried", async () => {
  quietly();
  const w = scenario(["b.org", "a.org", { url: "x.org", active: true }], { autoSort: true });
  w.browser.refuseMoves();
  await w.organizeNow();
  assert.deepEqual(w.layout(), ["a.org", "b.org", "x.org"]);
  assert.equal(count(w.browser.calls, "tabs.move"), 2);
});

test("on startup existing tabs are grouped but not sorted while auto-sort is off", async () => {
  const w = scenario([
    "github.com/a",
    "zebra.org",
    "github.com/b",
    "apple.org",
    "github.com/c",
    { url: "x.org", active: true },
  ]);
  await w.startBrowser();
  assert.deepEqual(w.layout(), [githubGroup("a", "b", "c"), "zebra.org", "apple.org", "x.org"]);
});

test("on startup nothing changes when auto-grouping and auto-sort are off", async () => {
  const w = scenario(["github.com/a", "zebra.org", "github.com/b", "github.com/c"], {
    autoGroup: false,
    autoSort: false,
  });
  await w.startBrowser();
  assert.deepEqual(w.browser.mutations(), []);
});

test("on startup the active tab stays put until the user switches away", async () => {
  const w = scenario([
    "github.com/a",
    "github.com/b",
    { url: "github.com/c", active: true },
    "x.org",
  ]);
  await w.startBrowser();
  assert.deepEqual(w.layout(), [
    { group: "github.com", tabs: ["github.com/a", "github.com/b"] },
    "github.com/c",
    "x.org",
  ]);
  w.browser.activate("x.org");
  await w.settle();
  assert.deepEqual(w.layout(), [githubGroup("a", "b", "c"), "x.org"]);
});

test("a new install organises the open tabs, an update does not", async () => {
  const update = scenario(["github.com/a", "github.com/b", "github.com/c", "x.org"]);
  update.browser.onInstalled.fire({ reason: "update" });
  await update.settle();
  assert.deepEqual(update.browser.mutations(), []);

  const install = scenario(["github.com/a", "github.com/b", "github.com/c", "x.org"]);
  install.browser.onInstalled.fire({ reason: "install" });
  await install.settle();
  assert.deepEqual(install.layout(), [githubGroup("a", "b", "c"), "x.org"]);
});

test("a window opened long after startup is not reorganised", async () => {
  const w = scenario([
    "github.com/a",
    "github.com/b",
    "github.com/c",
    { url: "x.org", active: true },
  ]);
  await w.startBrowser();
  w.browser.dragTab("github.com/c", 3);
  await w.advance(11_000);
  w.browser.onWindowCreated.fire({ id: 1 });
  await w.settle();
  assert.deepEqual(w.layout(), [
    { group: "github.com", tabs: ["github.com/a", "github.com/b"] },
    "x.org",
    "github.com/c",
  ]);
});

test("a tab dragged out of its group is not pulled back by navigating within the same domain", async () => {
  const w = scenario([
    "github.com/a",
    "github.com/b",
    "github.com/c",
    { url: "x.org", active: true },
  ]);
  await w.organizeNow();
  w.browser.dragTab("github.com/c", 3);
  w.browser.navigate("github.com/c", "github.com/c/issues");
  await w.settle();
  assert.deepEqual(w.layout(), [
    { group: "github.com", tabs: ["github.com/a", "github.com/b"] },
    "x.org",
    "github.com/c/issues",
  ]);
});

test("tabs waiting for a third companion are remembered across a worker restart", async () => {
  const w = scenario([{ url: "x.org", active: true }]);
  w.browser.openTab("github.com/a");
  w.browser.openTab("github.com/b");
  await w.settle();
  await w.restartWorker();
  w.browser.openTab("github.com/c");
  await w.settle();
  assert.deepEqual(w.layout(), ["x.org", githubGroup("a", "b", "c")]);
});

test("the groups the extension made are still its own after a worker restart", async () => {
  const w = scenario([
    "github.com/a",
    "github.com/b",
    "github.com/c",
    { url: "x.org", active: true },
  ]);
  await w.organizeNow();
  await w.restartWorker();
  w.browser.openTab("github.com/d");
  await w.settle();
  assert.deepEqual(w.layout(), [githubGroup("a", "b", "c", "d"), "x.org"]);
});

test("a dragged-out tab stays out when it navigates within its domain after the worker was stopped", async () => {
  const w = scenario([
    "github.com/a",
    "github.com/b",
    "github.com/c",
    { url: "x.org", active: true },
  ]);
  await w.organizeNow();
  w.browser.dragTab("github.com/c", 3);
  await w.restartWorker();
  w.browser.navigate("github.com/c", "github.com/c/issues");
  await w.settle();
  assert.deepEqual(w.layout(), [githubGroup("a", "b"), "x.org", "github.com/c/issues"]);
});

test("a tab that leaves its domain after the worker was stopped is organised again", async () => {
  const w = scenario([
    "github.com/a",
    "github.com/b",
    "github.com/c",
    { url: "x.org", active: true },
  ]);
  await w.organizeNow();
  w.browser.dragTab("github.com/c", 3);
  await w.restartWorker();
  w.browser.navigate("github.com/c", "gitlab.com");
  await w.settle();
  assert.deepEqual(w.layout(), [githubGroup("a", "b"), "x.org", "gitlab.com"]);
});

test("closing the tabs of a window that is closing does no work", async () => {
  const w = scenario([
    "github.com/a",
    "github.com/b",
    "github.com/c",
    { url: "x.org", active: true },
  ]);
  await w.organizeNow();
  const before = w.browser.mutations().length;
  w.browser.closeTab("github.com/c", { windowClosing: true });
  w.browser.closeTab("github.com/b", { windowClosing: true });
  await w.settle();
  assert.equal(w.browser.mutations().length, before);
});
