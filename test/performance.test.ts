// NF-3: planning for a 1,000-tab window stays well inside the time budget.
import assert from "node:assert/strict";
import { test } from "node:test";
import { organize } from "../src/core/organize.ts";
import { defaultSettings, type TabInfo, type WindowSnapshot } from "../src/core/types.ts";

const BUDGET_MS = 10;
const RUNS = 15;

function bigWindow(tabCount: number): WindowSnapshot {
  const tabs: TabInfo[] = Array.from({ length: tabCount }, (_, i) => ({
    id: i + 1,
    url: `https://site${(i * 7919) % 80}.example.${i % 3 ? "com" : "co.uk"}/page/${i}`,
    title: `Page ${(i * 31) % tabCount}`,
    pinned: false,
    active: i === tabCount - 1,
    groupId: null,
    lastAccessed: i,
  }));
  return { windowId: 1, focused: true, tabs, groups: [] };
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1]!;

test("planning a full reorganisation of 1,000 tabs takes under 10 ms", () => {
  const input = {
    snapshot: bigWindow(1000),
    settings: defaultSettings,
    state: { groups: {}, pending: [] },
    trigger: { mode: "manual" } as const,
  };
  organize(input);
  const timings = Array.from({ length: RUNS }, () => {
    const start = performance.now();
    organize(input);
    return performance.now() - start;
  });
  assert.ok(median(timings) < BUDGET_MS, `median ${median(timings).toFixed(2)} ms`);
});

test("planning for a single new tab in a 1,000-tab window takes under 10 ms", () => {
  const snapshot = bigWindow(1000);
  const input = {
    snapshot,
    settings: { ...defaultSettings, autoSort: true },
    state: { groups: {}, pending: [] },
    trigger: { mode: "auto", dirtyTabIds: new Set([500]) } as const,
  };
  organize(input);
  const timings = Array.from({ length: RUNS }, () => {
    const start = performance.now();
    organize(input);
    return performance.now() - start;
  });
  assert.ok(median(timings) < BUDGET_MS, `median ${median(timings).toFixed(2)} ms`);
});
