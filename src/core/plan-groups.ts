import { classify, type Classification } from "./classify.ts";
import type { Op, Settings, State, TabInfo, Trigger, WindowSnapshot } from "./types.ts";

export type Ownership = { owned: ReadonlySet<number>; adopted: number[] };

/**
 * Groups we own: those recorded in `state` under their recorded title, plus groups without such a
 * record (browser restart, user renamed one back) whose title is the key we would generate for one
 * of their tabs.
 */
export function resolveOwnership(
  snapshot: WindowSnapshot,
  settings: Settings,
  state: State,
): Ownership {
  const owned = new Set<number>();
  const adopted: number[] = [];
  for (const group of snapshot.groups) {
    if (state.groups[group.id]?.title === group.title) {
      owned.add(group.id);
    } else if (
      snapshot.tabs.some(
        (tab) => tab.groupId === group.id && classify(tab, settings)?.title === group.title,
      )
    ) {
      owned.add(group.id);
      adopted.push(group.id);
    }
  }
  return { owned, adopted };
}

type Target = { groupId: number } | { newGroup: Classification } | null;

const sameTarget = (target: Target, groupId: number | null) =>
  target === null ? groupId === null : "groupId" in target && target.groupId === groupId;

/**
 * Group membership changes: which tabs join, leave, or form groups, plus the tabs that stay
 * ungrouped only because their key is below the threshold (`pending`).
 */
export function planGroups(
  snapshot: WindowSnapshot,
  settings: Settings,
  state: State,
  trigger: Trigger,
  owned: ReadonlySet<number>,
): { ops: Op[]; pending: number[]; held: number[] } {
  const minTabs = Math.max(2, settings.minTabs);
  const eligible = snapshot.tabs.filter(
    (tab) => !tab.pinned && (tab.groupId === null || owned.has(tab.groupId)),
  );
  const auto = trigger.mode === "auto";
  const activeId =
    trigger.mode !== "manual" && snapshot.focused
      ? eligible.find((tab) => tab.active)?.id
      : undefined;

  const classes = new Map(eligible.map((tab) => [tab.id, classify(tab, settings)]));
  const ownedGroupByTitle = new Map<string, number>();
  for (const group of snapshot.groups) {
    if (owned.has(group.id) && !ownedGroupByTitle.has(group.title)) {
      ownedGroupByTitle.set(group.title, group.id);
    }
  }

  const targets = new Map<number, Target>(
    eligible.map((tab) => [tab.id, tab.groupId === null ? null : { groupId: tab.groupId }]),
  );

  const wasPending = new Set(state.pending);
  const retarget = eligible.filter(
    (tab) =>
      !auto || trigger.dirtyTabIds.has(tab.id) || (tab.groupId === null && wasPending.has(tab.id)),
  );
  const retargetByTitle = new Map<string, TabInfo[]>();
  for (const tab of retarget) {
    const title = classes.get(tab.id)?.title;
    if (title === undefined) targets.set(tab.id, null);
    else retargetByTitle.set(title, [...(retargetByTitle.get(title) ?? []), tab]);
  }

  for (const [title, tabs] of retargetByTitle) {
    const existing = ownedGroupByTitle.get(title);
    if (existing !== undefined) {
      for (const tab of tabs) targets.set(tab.id, { groupId: existing });
      continue;
    }
    const classification = classes.get(tabs[0]!.id)!;
    for (const tab of tabs) targets.set(tab.id, null);
    if (tabs.length >= minTabs) {
      for (const tab of tabs) targets.set(tab.id, { newGroup: classification });
    }
  }

  // The active tab never moves in automatic runs, but still counts towards the threshold.
  if (activeId !== undefined) {
    const active = eligible.find((tab) => tab.id === activeId)!;
    targets.set(activeId, active.groupId === null ? null : { groupId: active.groupId });
  }

  const newGroupMembers = new Map<string, number[]>();
  for (const [tabId, target] of targets) {
    if (target && "newGroup" in target) {
      const title = target.newGroup.title;
      newGroupMembers.set(title, [...(newGroupMembers.get(title) ?? []), tabId]);
    }
  }
  for (const members of newGroupMembers.values()) {
    if (members.length < 2) {
      for (const tabId of members) targets.set(tabId, null);
    }
  }

  const membersOfOwned = new Map<number, number[]>();
  for (const [tabId, target] of targets) {
    if (target && "groupId" in target) {
      membersOfOwned.set(target.groupId, [...(membersOfOwned.get(target.groupId) ?? []), tabId]);
    }
  }
  const dissolved = new Set<number>();
  const held: number[] = [];
  for (const members of membersOfOwned.values()) {
    const [only] = members;
    if (members.length !== 1) continue;
    if (only === activeId) {
      held.push(only!);
    } else {
      targets.set(only!, null);
      dissolved.add(only!);
    }
  }

  const retargeted = new Set(retarget.map((tab) => tab.id));
  const pending = eligible
    .filter(
      (tab) =>
        targets.get(tab.id) === null &&
        classes.get(tab.id) !== null &&
        (retargeted.has(tab.id) || dissolved.has(tab.id)),
    )
    .map((tab) => tab.id);

  return { ops: toOps(eligible, targets), pending, held };
}

function toOps(eligible: readonly TabInfo[], targets: ReadonlyMap<number, Target>): Op[] {
  const ungroup: number[] = [];
  const additions = new Map<number, number[]>();
  const creations = new Map<string, { classification: Classification; tabIds: number[] }>();
  for (const tab of eligible) {
    const target = targets.get(tab.id) ?? null;
    if (sameTarget(target, tab.groupId)) continue;
    if (target === null) {
      ungroup.push(tab.id);
    } else if ("groupId" in target) {
      additions.set(target.groupId, [...(additions.get(target.groupId) ?? []), tab.id]);
    } else {
      const { title } = target.newGroup;
      const creation = creations.get(title) ?? { classification: target.newGroup, tabIds: [] };
      creation.tabIds.push(tab.id);
      creations.set(title, creation);
    }
  }
  return [
    ...(ungroup.length ? [{ type: "ungroup" as const, tabIds: ungroup }] : []),
    ...[...additions].map(([groupId, tabIds]) => ({
      type: "addToGroup" as const,
      groupId,
      tabIds,
    })),
    ...[...creations.values()].map(({ classification, tabIds }) => ({
      type: "createGroup" as const,
      tabIds,
      title: classification.title,
      color: classification.color,
    })),
  ];
}
