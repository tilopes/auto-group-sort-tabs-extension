import { hostKey } from "./classify.ts";
import { diffLayout } from "./diff.ts";
import type {
  GroupSort,
  Op,
  Settings,
  State,
  TabInfo,
  TabSort,
  Trigger,
  WindowSnapshot,
} from "./types.ts";

/**
 * A unit that moves as a whole in the tab strip. `fixed` blocks are never moved:
 * foreign groups, and in automatic runs everything the run is not responsible for.
 */
export type Block =
  | { kind: "tab"; tab: TabInfo; fixed: boolean }
  | {
      kind: "group";
      id: number;
      owned: boolean;
      fixed: boolean;
      tabs: TabInfo[];
      fixedTabIds: ReadonlySet<number>;
    };

export type Layout = { pinnedCount: number; blocks: Block[] };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

type Compare<T> = (a: T, b: T) => number;

const tabComparators: Record<TabSort, Compare<TabInfo>> = {
  title: (a, b) => collator.compare(a.title, b.title),
  url: (a, b) => collator.compare(a.url, b.url),
  lastAccessed: (a, b) => b.lastAccessed - a.lastAccessed,
};

function readLayout(
  snapshot: WindowSnapshot,
  owned: ReadonlySet<number>,
  canMove: (tab: TabInfo) => boolean,
): Layout {
  const pinnedCount = snapshot.tabs.filter((tab) => tab.pinned).length;
  const blocks: Block[] = [];
  for (const tab of snapshot.tabs.slice(pinnedCount)) {
    const last = blocks.at(-1);
    if (tab.groupId === null) {
      blocks.push({ kind: "tab", tab, fixed: !canMove(tab) });
    } else if (last?.kind === "group" && last.id === tab.groupId) {
      last.tabs.push(tab);
    } else {
      blocks.push({
        kind: "group",
        id: tab.groupId,
        owned: owned.has(tab.groupId),
        fixed: false,
        tabs: [tab],
        fixedTabIds: new Set(),
      });
    }
  }
  return {
    pinnedCount,
    blocks: blocks.map((block) => {
      if (block.kind === "tab") return block;
      const fixedTabIds = new Set(block.tabs.filter((tab) => !canMove(tab)).map((tab) => tab.id));
      return {
        ...block,
        fixedTabIds,
        fixed: !block.owned || fixedTabIds.size > 0,
      };
    }),
  };
}

/** Inserts after the last comparable element that is not greater, else before the first one. */
function insertSorted<T>(
  sequence: T[],
  item: T,
  compare: Compare<T>,
  comparable: (candidate: T) => boolean,
  fallbackIndex: number,
): void {
  let after = -1;
  let first = -1;
  sequence.forEach((candidate, i) => {
    if (!comparable(candidate)) return;
    if (first < 0) first = i;
    if (compare(candidate, item) <= 0) after = i;
  });
  sequence.splice(after >= 0 ? after + 1 : first >= 0 ? first : fallbackIndex, 0, item);
}

export function planOrder(
  snapshot: WindowSnapshot,
  settings: Settings,
  state: State,
  trigger: Trigger,
  owned: ReadonlySet<number>,
): Op[] {
  const auto = trigger.mode === "auto";
  const activeId =
    trigger.mode !== "manual" && snapshot.focused
      ? snapshot.tabs.find((tab) => tab.active)?.id
      : undefined;
  const canMove = (tab: TabInfo) =>
    tab.id !== activeId && (!auto || trigger.dirtyTabIds.has(tab.id));

  const current = readLayout(snapshot, owned, canMove);
  const compareTabs = tabComparators[settings.tabSort];
  const domains = new Map<number, string>();
  for (const block of current.blocks) {
    if (block.kind === "tab") {
      domains.set(block.tab.id, hostKey(block.tab.url, "domain") ?? "\uffff");
    }
  }
  const compareUngrouped: Compare<Block> = (a, b) => {
    if (a.kind !== "tab" || b.kind !== "tab") return 0;
    const domainA = domains.get(a.tab.id)!;
    const domainB = domains.get(b.tab.id)!;
    if (domainA !== domainB) return domainA < domainB ? -1 : 1;
    return collator.compare(a.tab.title, b.tab.title);
  };
  const compareGroups = groupComparator(settings.groupSort, snapshot, state);

  const sortedTabs = (tabs: TabInfo[], fixedTabIds: ReadonlySet<number>) => {
    const fixed = tabs.filter((tab) => fixedTabIds.has(tab.id));
    const movable = tabs.filter((tab) => !fixedTabIds.has(tab.id)).sort(compareTabs);
    if (!fixed.length) return movable;
    for (const tab of movable) {
      insertSorted(fixed, tab, compareTabs, () => true, fixed.length);
    }
    return fixed;
  };

  const blocks = current.blocks.map((block) =>
    block.kind === "group" && block.owned
      ? { ...block, tabs: sortedTabs(block.tabs, block.fixedTabIds) }
      : block,
  );

  const desired: Layout = {
    pinnedCount: current.pinnedCount,
    blocks: auto
      ? insertMovable(blocks, compareUngrouped, compareGroups)
      : regions(blocks, compareUngrouped, compareGroups),
  };
  return diffLayout(current, desired);
}

/** Full re-evaluation: pinned | groups (foreign ones keep their slot) | ungrouped tabs. */
function regions(
  blocks: readonly Block[],
  compareUngrouped: Compare<Block>,
  compareGroups: Compare<Block>,
): Block[] {
  const groups = blocks.filter((block) => block.kind === "group");
  const sortedOwned = groups.filter((block) => !block.fixed).sort(compareGroups);
  const slots = groups.map((block) => (block.fixed ? block : sortedOwned.shift()!));
  const ungrouped = blocks.filter((block) => block.kind === "tab").sort(compareUngrouped);
  return [...slots, ...ungrouped];
}

/** Automatic run: fixed blocks stay where they are, the rest are inserted in sorted position. */
function insertMovable(
  blocks: readonly Block[],
  compareUngrouped: Compare<Block>,
  compareGroups: Compare<Block>,
): Block[] {
  const sequence = blocks.filter((block) => block.fixed);
  const movableGroups = blocks.filter((block) => block.kind === "group" && !block.fixed);
  const movableTabs = blocks.filter((block) => block.kind === "tab" && !block.fixed);

  for (const block of movableGroups.sort(compareGroups)) {
    const afterGroups = sequence.findLastIndex((candidate) => candidate.kind === "group") + 1;
    insertSorted(
      sequence,
      block,
      compareGroups,
      (candidate) => candidate.kind === "group" && candidate.owned,
      afterGroups,
    );
  }
  for (const block of movableTabs.sort(compareUngrouped)) {
    insertSorted(
      sequence,
      block,
      compareUngrouped,
      (candidate) => candidate.kind === "tab",
      sequence.length,
    );
  }
  return sequence;
}

function groupComparator(sort: GroupSort, snapshot: WindowSnapshot, state: State): Compare<Block> {
  const titles = new Map(snapshot.groups.map((group) => [group.id, group.title]));
  const titleOf = (block: Block) => (block.kind === "group" ? (titles.get(block.id) ?? "") : "");
  const createdAt = (block: Block) =>
    block.kind === "group" ? (state.groups[block.id]?.createdAt ?? Infinity) : Infinity;
  const size = (block: Block) => (block.kind === "group" ? block.tabs.length : 0);
  switch (sort) {
    case "title":
      return (a, b) => collator.compare(titleOf(a), titleOf(b));
    case "size":
      return (a, b) => size(b) - size(a) || collator.compare(titleOf(a), titleOf(b));
    case "firstSeen":
      return (a, b) => (createdAt(a) === createdAt(b) ? 0 : createdAt(a) < createdAt(b) ? -1 : 1);
  }
}
