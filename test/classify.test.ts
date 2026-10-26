import assert from "node:assert/strict";
import { test } from "node:test";
import { classify } from "../src/core/classify.ts";
import { defaultSettings, type Rule, type Settings } from "../src/core/types.ts";

const titleOf = (url: string, settings: Partial<Settings> = {}) =>
  classify({ url }, { ...defaultSettings, ...settings })?.title ?? null;

const rule = (overrides: Partial<Rule> & Pick<Rule, "match">): Rule => ({
  name: "Work",
  enabled: true,
  ...overrides,
});

test("by default a page belongs to its registrable domain", () => {
  assert.equal(titleOf("https://mail.google.com/inbox"), "google.com");
  assert.equal(titleOf("http://www.bbc.co.uk/news"), "bbc.co.uk");
  assert.equal(titleOf("https://EXAMPLE.com./x"), "example.com");
});

test("the hostname strategy keeps subdomains apart", () => {
  const settings = { strategy: "hostname" } as const;
  assert.equal(titleOf("https://mail.google.com/", settings), "mail.google.com");
  assert.equal(titleOf("https://docs.google.com/", settings), "docs.google.com");
});

test("IP addresses and single-label hosts are kept as-is, with an explicit port", () => {
  assert.equal(titleOf("http://localhost:3000/app"), "localhost:3000");
  assert.equal(titleOf("http://localhost/app"), "localhost");
  assert.equal(titleOf("http://192.168.1.10:8080/"), "192.168.1.10:8080");
  assert.equal(titleOf("http://[::1]:5173/"), "[::1]:5173");
  assert.equal(titleOf("https://intranet/wiki"), "intranet");
});

test("default ports do not become part of the key", () => {
  assert.equal(titleOf("https://example.com:443/"), "example.com");
  assert.equal(titleOf("https://example.com:8443/"), "example.com");
});

test("special pages are never grouped", () => {
  for (const url of [
    "about:blank",
    "chrome://settings",
    "chrome://newtab/",
    "edge://flags",
    "file:///Users/me/notes.html",
    "moz-extension://abc/popup.html",
    "chrome-extension://abc/options.html",
    "view-source:https://example.com",
    "data:text/html,hi",
    "",
    "not a url",
  ]) {
    assert.equal(titleOf(url), null, url);
  }
});

test("a host rule names the group and sets its colour", () => {
  const rules = [rule({ color: "blue", match: { type: "host", pattern: "*.atlassian.net" } })];
  assert.deepEqual(
    classify({ url: "https://acme.atlassian.net/jira" }, { ...defaultSettings, rules }),
    {
      title: "Work",
      color: "blue",
    },
  );
});

test("a host glob with a leading wildcard also matches the bare domain, but not look-alikes", () => {
  const rules = [rule({ match: { type: "host", pattern: "*.atlassian.net" } })];
  assert.equal(titleOf("https://atlassian.net/", { rules }), "Work");
  assert.equal(titleOf("https://a.b.atlassian.net/", { rules }), "Work");
  assert.equal(titleOf("https://notatlassian.net/", { rules }), "notatlassian.net");
  assert.equal(titleOf("https://atlassian.net.evil.com/", { rules }), "evil.com");
});

test("a host rule without wildcards matches only that host", () => {
  const rules = [rule({ match: { type: "host", pattern: "docs.example.com" } })];
  assert.equal(titleOf("https://docs.example.com/a", { rules }), "Work");
  assert.equal(titleOf("https://www.example.com/a", { rules }), "example.com");
});

test("a prefix rule matches the start of the URL", () => {
  const rules = [rule({ match: { type: "prefix", prefix: "https://github.com/acme/" } })];
  assert.equal(titleOf("https://github.com/acme/repo/issues", { rules }), "Work");
  assert.equal(titleOf("https://github.com/other/repo", { rules }), "github.com");
});

test("a regex rule matches anywhere in the URL", () => {
  const rules = [rule({ match: { type: "regex", pattern: "/pull/\\d+" } })];
  assert.equal(titleOf("https://github.com/acme/repo/pull/42", { rules }), "Work");
  assert.equal(titleOf("https://github.com/acme/repo/issues/42", { rules }), "github.com");
});

test("the first matching rule wins, and disabled rules are skipped", () => {
  const rules = [
    rule({ name: "Off", enabled: false, match: { type: "host", pattern: "*.example.com" } }),
    rule({ name: "First", match: { type: "host", pattern: "*.example.com" } }),
    rule({ name: "Second", match: { type: "host", pattern: "*.example.com" } }),
  ];
  assert.equal(titleOf("https://a.example.com/", { rules }), "First");
});

test("an invalid regex rule is ignored instead of breaking classification", () => {
  const rules = [
    rule({ name: "Broken", match: { type: "regex", pattern: "(" } }),
    rule({ name: "Fallback", match: { type: "host", pattern: "example.com" } }),
  ];
  assert.equal(titleOf("https://example.com/", { rules }), "Fallback");
});

test("rules do not apply to special pages", () => {
  const rules = [rule({ match: { type: "regex", pattern: ".*" } })];
  assert.equal(titleOf("chrome://settings", { rules }), null);
});

test("a key keeps the same colour every time, and a rule colour overrides it", () => {
  const colour = (url: string, rules: Rule[] = []) =>
    classify({ url }, { ...defaultSettings, rules })?.color;
  assert.equal(colour("https://github.com/a"), colour("https://gist.github.com/b"));
  const seen = new Set(
    ["a.com", "b.com", "c.com", "d.com", "e.com", "f.com", "g.com", "h.com", "i.com", "j.com"].map(
      (host) => colour(`https://${host}/`),
    ),
  );
  assert.ok(seen.size > 1, "colours should vary between domains");
  assert.equal(
    colour("https://github.com/", [
      rule({ color: "pink", match: { type: "host", pattern: "github.com" } }),
    ]),
    "pink",
  );
});
