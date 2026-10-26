// Seeded random windows; whatever the layout, the same promises must hold.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { LayoutEntry, TabSpec } from "./fake-browser.ts";
import { scenario } from "./harness.ts";

const SEEDS = 200;
const DOMAINS = ["a.com", "b.com", "c.org", "d.co.uk", "e.net", "f.io", "localhost:3000"];

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomWindow(seed: number) {
  const random = mulberry32(seed);
  const int = (max: number) => Math.floor(random() * max);
  let n = 0;
  const url = () => `${DOMAINS[int(DOMAINS.length)]}/${n++}`;

  const specs: TabSpec[] = [];
  const pinned = int(3);
  for (let i = 0; i < pinned; i++) specs.push({ url: url(), pinned: true });
  const loose = 2 + int(14);
  for (let i = 0; i < loose; i++) specs.push(url());
  if (random() < 0.5) {
    const at = pinned + int(loose + 1);
    const size = 1 + int(3);
    specs.splice(at, 0, ...Array.from({ length: size }, () => ({ url: url(), group: "Mine" })));
  }
  const protectedUrls = specs
    .filter((spec) => typeof spec !== "string" && (spec.pinned || spec.group))
    .map((spec) => (spec as { url: string }).url);
  return { specs, protectedUrls, random, int, url };
}

const flatten = (layout: LayoutEntry[]) =>
  layout
    .flatMap((entry) => (typeof entry === "string" ? [entry] : entry.tabs))
    .map((label) => label.replace(/^pinned: /, ""));

function assertWellFormed(layout: LayoutEntry[], before: string[], message: string) {
  assert.deepEqual(
    [...flatten(layout)].sort(),
    [...before].sort(),
    `${message}: tabs lost or duplicated`,
  );
  for (const entry of layout) {
    if (typeof entry !== "string" && entry.group !== "Mine") {
      assert.ok(entry.tabs.length >= 2, `${message}: group ${entry.group} has one tab`);
    }
  }
}

test("'Organize now' is idempotent and leaves pinned tabs and the user's groups alone", async () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const { specs, protectedUrls } = randomWindow(seed);
    const w = scenario(specs);
    const before = flatten(w.browser.layout());
    const message = `seed ${seed}`;

    await w.organizeNow();
    assertWellFormed(w.layout(), before, message);
    for (const url of protectedUrls) {
      assert.ok(!w.browser.touched.has(w.browser.idOf(url)), `${message}: ${url} was touched`);
    }

    const settled = JSON.stringify(w.layout());
    w.browser.calls = [];
    await w.organizeNow();
    assert.equal(w.browser.mutations().length, 0, `${message}: second run mutated`);
    assert.equal(JSON.stringify(w.layout()), settled, message);
  }
});

test("automatic runs after random browsing keep the window well-formed and never move the active tab", async () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const { specs, random, int, url } = randomWindow(seed);
    const w = scenario(specs, { autoSort: random() < 0.5 });
    await w.organizeNow();
    const message = `seed ${seed}`;

    for (let step = 0; step < 6; step++) {
      const urls = flatten(w.browser.layout());
      const action = int(3);
      if (action === 0) w.browser.openTab(url());
      else if (action === 1) w.browser.navigate(urls[int(urls.length)]!, url());
      else w.browser.activate(urls[int(urls.length)]!);

      const active = (await w.browser.api.tabs.query()).find((tab) => tab.active);
      const activeId = active?.id;
      w.browser.touched.clear();
      const known = flatten(w.browser.layout());
      await w.settle();

      assertWellFormed(w.layout(), known, `${message} step ${step}`);
      if (activeId !== undefined) {
        assert.ok(!w.browser.touched.has(activeId), `${message} step ${step}: active tab moved`);
      }
    }
  }
});
