// What the extension does with the settings it finds in storage.sync, and how they take effect.
import assert from "node:assert/strict";
import { test } from "node:test";
import { importSettings, parseSettings, validateRule } from "../src/core/settings.ts";
import { defaultSettings } from "../src/core/types.ts";
import { scenario } from "./harness.ts";

const docs = {
  name: "Docs",
  color: "blue",
  enabled: true,
  match: { type: "regex", pattern: "^https://docs\\." },
};

test("nothing stored, or something that is not an object, means the defaults", () => {
  for (const raw of [undefined, null, "settings", 7, [], true]) {
    assert.deepEqual(parseSettings(raw), defaultSettings);
  }
});

test("complete valid settings are used as they are", () => {
  const stored = {
    version: 1,
    autoGroup: false,
    autoSort: true,
    strategy: "hostname",
    minTabs: 5,
    rules: [docs],
    tabSort: "url",
    groupSort: "size",
  };
  assert.deepEqual(parseSettings(stored), stored);
});

test("a field that is missing takes its default and the rest is kept", () => {
  assert.deepEqual(parseSettings({ autoSort: true, minTabs: 4 }), {
    ...defaultSettings,
    autoSort: true,
    minTabs: 4,
  });
});

test("a field with an unusable value falls back to its default on its own", () => {
  const parsed = parseSettings({
    autoGroup: "yes",
    autoSort: true,
    strategy: "subdomain",
    minTabs: 1,
    tabSort: 3,
    groupSort: "size",
  });
  assert.deepEqual(parsed, { ...defaultSettings, autoSort: true, groupSort: "size" });
  for (const minTabs of [0, 2.5, 21, "3", null, Number.NaN]) {
    assert.equal(parseSettings({ minTabs }).minTabs, defaultSettings.minTabs, String(minTabs));
  }
});

test("rules that cannot be used are dropped and the others keep their order", () => {
  const bad = [
    null,
    "rule",
    { ...docs, name: "  " },
    { ...docs, enabled: "yes" },
    { ...docs, color: "magenta" },
    { ...docs, match: { type: "glob", pattern: "*" } },
    { ...docs, match: { type: "regex", pattern: "(" } },
    { ...docs, match: { type: "host", pattern: "" } },
  ];
  const first = { name: "First", enabled: false, match: { type: "host", pattern: "a.com" } };
  const last = { name: "Last", enabled: true, match: { type: "prefix", prefix: "https://b.com/" } };
  assert.deepEqual(parseSettings({ rules: [first, ...bad, last] }).rules, [first, last]);
  assert.deepEqual(parseSettings({ rules: "all" }).rules, []);
});

test("settings from a schema version this code does not know are ignored", () => {
  assert.deepEqual(parseSettings({ version: 2, autoSort: true }), defaultSettings);
  assert.equal(parseSettings({ autoSort: true }).autoSort, true, "no version is the current one");
});

test("a rule is normalised, and a rule that cannot work says why", () => {
  assert.deepEqual(
    validateRule({
      name: " Docs ",
      enabled: true,
      match: { type: "host", pattern: " *.mdn.dev " },
    }),
    { rule: { name: "Docs", enabled: true, match: { type: "host", pattern: "*.mdn.dev" } } },
  );
  const error = (raw: unknown) => {
    const result = validateRule(raw);
    assert.ok("error" in result, JSON.stringify(raw));
    return result.error;
  };
  assert.match(error({ ...docs, name: "" }), /name/i);
  assert.match(error({ ...docs, match: { type: "regex", pattern: "(" } }), /regular expression/i);
  assert.match(error({ ...docs, match: { type: "prefix", prefix: " " } }), /prefix/i);
  assert.match(error({ ...docs, color: "teal" }), /colour/i);
});

test("garbage in storage does not stop tabs from being grouped with the defaults", async () => {
  const w = scenario(["x.org"]);
  w.browser.storage.sync.seed({ settings: { version: 9, strategy: "?", rules: 5 } });
  for (const path of ["a", "b", "c"]) w.browser.openTab(`github.com/${path}`);
  await w.settle();
  assert.deepEqual(w.layout(), [
    "x.org",
    { group: "github.com", tabs: ["github.com/a", "github.com/b", "github.com/c"] },
  ]);
});

test("a settings change applies to the next tabs without restarting the extension", async () => {
  const w = scenario(["x.org"]);
  await w.browser.storage.sync.set({ settings: { ...defaultSettings, minTabs: 2 } });
  for (const path of ["a", "b"]) w.browser.openTab(`github.com/${path}`);
  await w.settle();
  assert.deepEqual(w.layout(), [
    "x.org",
    { group: "github.com", tabs: ["github.com/a", "github.com/b"] },
  ]);

  await w.browser.storage.sync.set({ settings: { ...defaultSettings, autoGroup: false } });
  for (const path of ["a", "b", "c"]) w.browser.openTab(`gitlab.com/${path}`);
  await w.settle();
  assert.ok(
    w.layout().every((entry) => typeof entry === "string" || entry.group === "github.com"),
    "no group for gitlab.com while auto-group is off",
  );
});

test("exported settings import back unchanged", () => {
  const settings = {
    ...defaultSettings,
    autoSort: true,
    minTabs: 4,
    rules: [parseSettings({ rules: [docs] }).rules[0]!],
  };
  assert.deepEqual(importSettings(JSON.stringify(settings, null, 2)), {
    settings,
    skippedRules: 0,
  });
});

test("an import keeps what is valid and says how many rules it had to skip", () => {
  const result = importSettings(JSON.stringify({ autoSort: true, rules: [docs, { name: "" }, 3] }));
  assert.ok("settings" in result);
  assert.equal(result.settings.autoSort, true);
  assert.equal(result.settings.rules.length, 1);
  assert.equal(result.skippedRules, 2);
});

test("an import refuses what is not settings of this version", () => {
  for (const text of ["", "{", "[]", "null", "42", '{"version":2}']) {
    assert.ok("error" in importSettings(text), text);
  }
});
