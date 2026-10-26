import type { Block, Layout } from "./plan-order.ts";
import type { Op } from "./types.ts";

type Move<T> = { items: T[]; index: number };

/**
 * Heaviest strictly increasing subsequence of `ranks` (a permutation) by `weights`,
 * returned as a set of positions into `ranks`. O(n log n) with a prefix-maximum Fenwick tree.
 */
function heaviestIncreasing(ranks: readonly number[], weights: readonly number[]): Set<number> {
  const n = ranks.length;
  const tree: { total: number; position: number }[] = Array.from({ length: n + 1 }, () => ({
    total: 0,
    position: -1,
  }));
  const best: number[] = [];
  const previous: number[] = [];
  let last = -1;
  for (let i = 0; i < n; i++) {
    let prefix = { total: 0, position: -1 };
    for (let k = ranks[i]!; k > 0; k -= k & -k) {
      if (tree[k]!.total > prefix.total) prefix = tree[k]!;
    }
    best[i] = prefix.total + weights[i]!;
    previous[i] = prefix.position;
    for (let k = ranks[i]! + 1; k <= n; k += k & -k) {
      if (best[i]! > tree[k]!.total) tree[k] = { total: best[i]!, position: i };
    }
    if (last < 0 || best[i]! > best[last]!) last = i;
  }
  const kept = new Set<number>();
  for (let i = last; i >= 0; i = previous[i]!) kept.add(i);
  return kept;
}

/**
 * Moves that turn `current` into `desired` (same items, different order), leaving a heaviest
 * already-ordered subset untouched. `index` is the item's final offset in the list measured in
 * `weight` units; consecutive moved items that `canBatch` become one move.
 */
function planMoves<T>(
  current: readonly T[],
  desired: readonly T[],
  {
    key,
    weight,
    weightToKeep,
    canBatch,
  }: {
    key: (item: T) => string;
    weight: (item: T) => number;
    weightToKeep: (item: T) => number;
    canBatch: (item: T) => boolean;
  },
): Move<T>[] {
  const rankOf = new Map(desired.map((item, i) => [key(item), i]));
  const ranks = current.map((item) => rankOf.get(key(item))!);
  const kept = heaviestIncreasing(ranks, current.map(weightToKeep));
  const stays = new Set([...kept].map((position) => ranks[position]!));

  const working = [...current];
  const moves: Move<T>[] = [];
  for (let i = 0; i < desired.length; i++) {
    if (stays.has(i)) continue;
    const batch = [desired[i]!];
    while (
      canBatch(batch[0]!) &&
      i + 1 < desired.length &&
      !stays.has(i + 1) &&
      canBatch(desired[i + 1]!)
    ) {
      batch.push(desired[++i]!);
    }
    const batchKeys = new Set(batch.map(key));
    for (let w = working.length - 1; w >= 0; w--) {
      if (batchKeys.has(key(working[w]!))) working.splice(w, 1);
    }
    const predecessor = i - batch.length >= 0 ? key(desired[i - batch.length]!) : null;
    const at =
      predecessor === null ? 0 : working.findIndex((item) => key(item) === predecessor) + 1;
    working.splice(at, 0, ...batch);
    const index = working.slice(0, at).reduce((sum, item) => sum + weight(item), 0);
    moves.push({ items: batch, index });
  }
  return moves;
}

const blockKey = (block: Block) => (block.kind === "tab" ? `t${block.tab.id}` : `g${block.id}`);
const blockSize = (block: Block) => (block.kind === "tab" ? 1 : block.tabs.length);

/** Minimal operations that turn the `current` layout into the `desired` one. */
export function diffLayout(current: Layout, desired: Layout): Op[] {
  const ops: Op[] = [];
  const keep = current.blocks.length + 1;

  const blockMoves = planMoves(current.blocks, desired.blocks, {
    key: blockKey,
    weight: blockSize,
    weightToKeep: (block) => (block.fixed ? keep : 1),
    canBatch: (block) => block.kind === "tab",
  });
  for (const { items, index } of blockMoves) {
    const first = items[0]!;
    const stripIndex = current.pinnedCount + index;
    if (first.kind === "group") {
      ops.push({ type: "moveGroup", groupId: first.id, index: stripIndex });
    } else {
      const tabIds = items.flatMap((block) => (block.kind === "tab" ? [block.tab.id] : []));
      ops.push({ type: "moveTabs", tabIds, index: stripIndex });
    }
  }

  // After the block moves the blocks are in desired order, so group starts follow from it.
  const currentGroups = new Map(
    current.blocks.flatMap((block) => (block.kind === "group" ? [[block.id, block] as const] : [])),
  );
  let start = current.pinnedCount;
  for (const block of desired.blocks) {
    const from = block.kind === "group" ? currentGroups.get(block.id) : undefined;
    if (block.kind === "group" && from) {
      const tabMoves = planMoves(from.tabs, block.tabs, {
        key: (tab) => String(tab.id),
        weight: () => 1,
        weightToKeep: (tab) => (from.fixedTabIds.has(tab.id) ? from.tabs.length + 1 : 1),
        canBatch: () => true,
      });
      for (const { items, index } of tabMoves) {
        ops.push({ type: "moveTabs", tabIds: items.map((tab) => tab.id), index: start + index });
      }
    }
    start += blockSize(block);
  }
  return ops;
}
