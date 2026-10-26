import assert from "node:assert/strict";
import { test } from "node:test";
import { scenario } from "./harness.ts";

test("three tabs from the same domain are grouped under that domain", async () => {
  const w = scenario(["github.com/a", "news.ycombinator.com", "github.com/b", "github.com/c"]);
  await w.organizeNow();
  assert.deepEqual(w.layout(), [
    { group: "github.com", tabs: ["github.com/a", "github.com/b", "github.com/c"] },
    "news.ycombinator.com",
  ]);
});

test("two tabs from the same domain stay ungrouped", async () => {
  const w = scenario(["github.com/a", "news.ycombinator.com", "github.com/b"]);
  await w.organizeNow();
  assert.deepEqual(w.layout(), ["github.com/a", "github.com/b", "news.ycombinator.com"]);
});

test("tabs opened one at a time are grouped when the third one arrives", async () => {
  const w = scenario([{ url: "example.org", active: true }]);
  w.browser.openTab("github.com/a");
  await w.settle();
  w.browser.openTab("github.com/b");
  await w.settle();
  assert.deepEqual(w.layout(), ["example.org", "github.com/a", "github.com/b"]);
  w.browser.openTab("github.com/c");
  await w.settle();
  assert.deepEqual(w.layout(), [
    "example.org",
    { group: "github.com", tabs: ["github.com/a", "github.com/b", "github.com/c"] },
  ]);
});

test("subdomains of one site share a group", async () => {
  const w = scenario(["mail.google.com", "docs.google.com/d", "google.com", "other.org"]);
  await w.organizeNow();
  assert.deepEqual(w.layout(), [
    { group: "google.com", tabs: ["docs.google.com/d", "google.com", "mail.google.com"] },
    "other.org",
  ]);
});

test("different sites under the same public suffix are not merged", async () => {
  const w = scenario(["bbc.co.uk", "theguardian.co.uk", "amazon.co.uk", "news.bbc.co.uk"]);
  await w.organizeNow();
  assert.deepEqual(w.layout(), [
    "amazon.co.uk",
    "bbc.co.uk",
    "news.bbc.co.uk",
    "theguardian.co.uk",
  ]);
});

test("the hostname strategy groups per host", async () => {
  const w = scenario(
    ["a.example.com/1", "a.example.com/2", "a.example.com/3", "b.example.com/1", "b.example.com/2"],
    { strategy: "hostname" },
  );
  await w.organizeNow();
  assert.deepEqual(w.layout(), [
    { group: "a.example.com", tabs: ["a.example.com/1", "a.example.com/2", "a.example.com/3"] },
    "b.example.com/1",
    "b.example.com/2",
  ]);
});

test("localhost dev servers are grouped per port", async () => {
  const w = scenario([
    "localhost:3000/a",
    "localhost:8080/x",
    "localhost:3000/b",
    "localhost:3000/c",
    "localhost:8080/y",
  ]);
  await w.organizeNow();
  assert.deepEqual(w.layout(), [
    { group: "localhost:3000", tabs: ["localhost:3000/a", "localhost:3000/b", "localhost:3000/c"] },
    "localhost:8080/x",
    "localhost:8080/y",
  ]);
});

test("the group threshold is configurable", async () => {
  const w = scenario(["a.com/1", "a.com/2", "b.com"], { minTabs: 2 });
  await w.organizeNow();
  assert.deepEqual(w.layout(), [{ group: "a.com", tabs: ["a.com/1", "a.com/2"] }, "b.com"]);
});

test("a threshold below two never produces single-tab groups", async () => {
  const w = scenario(["a.com", "b.com"], { minTabs: 1 });
  await w.organizeNow();
  assert.deepEqual(w.layout(), ["a.com", "b.com"]);
});

test("a tab matching a rule goes into the rule's group, ahead of the domain strategy", async () => {
  const w = scenario(["x.atlassian.net/a", "bitbucket.org/b", "y.atlassian.net/c", "other.com"], {
    rules: [
      {
        name: "Work",
        color: "blue",
        enabled: true,
        match: { type: "host", pattern: "*.atlassian.net" },
      },
      { name: "Work", enabled: true, match: { type: "host", pattern: "bitbucket.org" } },
    ],
  });
  await w.organizeNow();
  assert.deepEqual(w.layout(), [
    { group: "Work", tabs: ["bitbucket.org/b", "x.atlassian.net/a", "y.atlassian.net/c"] },
    "other.com",
  ]);
  assert.equal(w.browser.group("Work").color, "blue");
});

test("groups of the same domain get the same colour in every window", async () => {
  const tabs = ["github.com/a", "github.com/b", "github.com/c"];
  const first = scenario(tabs);
  const second = scenario(tabs);
  await first.organizeNow();
  await second.organizeNow();
  assert.equal(first.browser.group("github.com").color, second.browser.group("github.com").color);
});

test("special pages stay ungrouped", async () => {
  const w = scenario([
    "about:blank",
    "chrome://settings",
    "chrome://settings/a",
    "file:///a.html",
    "file:///b.html",
  ]);
  await w.organizeNow();
  assert.ok(w.layout().every((entry) => typeof entry === "string"));
});

test("navigating a grouped tab to another domain takes it out of the group", async () => {
  const w = scenario([
    "github.com/a",
    "github.com/b",
    "github.com/c",
    { url: "other.org", active: true },
  ]);
  await w.organizeNow();
  w.browser.navigate("github.com/c", "news.ycombinator.com");
  await w.settle();
  assert.deepEqual(w.layout(), [
    { group: "github.com", tabs: ["github.com/a", "github.com/b"] },
    "news.ycombinator.com",
    "other.org",
  ]);
});

test("a group survives down to two tabs and dissolves when one is left", async () => {
  const w = scenario([
    "github.com/a",
    "github.com/b",
    "github.com/c",
    { url: "other.org", active: true },
  ]);
  await w.organizeNow();

  w.browser.navigate("github.com/c", "one.net");
  await w.settle();
  assert.deepEqual(w.layout()[0], { group: "github.com", tabs: ["github.com/a", "github.com/b"] });

  w.browser.navigate("github.com/b", "two.net");
  await w.settle();
  assert.ok(
    w.layout().every((entry) => typeof entry === "string"),
    "no group is left",
  );
});

test("closing tabs until one is left dissolves the group", async () => {
  const w = scenario([
    "github.com/a",
    "github.com/b",
    "github.com/c",
    { url: "other.org", active: true },
  ]);
  await w.organizeNow();

  w.browser.closeTab("github.com/c");
  await w.settle();
  assert.deepEqual(w.layout()[0], { group: "github.com", tabs: ["github.com/a", "github.com/b"] });

  w.browser.closeTab("github.com/b");
  await w.settle();
  assert.deepEqual(w.layout(), ["github.com/a", "other.org"]);
});

test("a group reduced to its active tab dissolves once the user switches away", async () => {
  const w = scenario([
    "github.com/a",
    "github.com/b",
    "github.com/c",
    { url: "other.org", active: true },
  ]);
  await w.organizeNow();

  w.browser.activate("github.com/a");
  w.browser.closeTab("github.com/c");
  w.browser.closeTab("github.com/b");
  await w.settle();
  assert.deepEqual(w.layout(), [{ group: "github.com", tabs: ["github.com/a"] }, "other.org"]);

  w.browser.activate("other.org");
  await w.settle();
  assert.deepEqual(w.layout(), ["github.com/a", "other.org"]);
});

test("navigating to a domain with an existing group joins it, even below the threshold", async () => {
  const w = scenario([
    "github.com/a",
    "github.com/b",
    "github.com/c",
    { url: "other.org", active: true },
  ]);
  await w.organizeNow();
  w.browser.navigate("github.com/c", "one.net");
  await w.settle();
  w.browser.navigate("other.org", "github.com/d");
  w.browser.navigate("one.net", "github.com/e");
  w.browser.activate("github.com/a");
  await w.settle();
  assert.deepEqual(w.layout(), [
    { group: "github.com", tabs: ["github.com/a", "github.com/b", "github.com/e", "github.com/d"] },
  ]);
});

test("navigating a tab so that its new domain reaches the threshold creates a group", async () => {
  const w = scenario(["a.com/1", "a.com/2", "b.com", { url: "c.com", active: true }]);
  await w.organizeNow();
  w.browser.navigate("b.com", "a.com/3");
  await w.settle();
  assert.deepEqual(w.layout(), [
    { group: "a.com", tabs: ["a.com/1", "a.com/2", "a.com/3"] },
    "c.com",
  ]);
});

test("with automatic grouping off, only 'Organize now' groups tabs", async () => {
  const w = scenario(["a.com/1", "a.com/2", { url: "x.org", active: true }], { autoGroup: false });
  w.browser.openTab("a.com/3");
  await w.settle();
  assert.equal(w.browser.mutations().length, 0);
  await w.organizeNow();
  assert.deepEqual(w.layout()[0], { group: "a.com", tabs: ["a.com/1", "a.com/2", "a.com/3"] });
});
