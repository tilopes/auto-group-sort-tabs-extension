export const groupColors = [
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
] as const;
export type GroupColor = (typeof groupColors)[number];

export type TabInfo = {
  id: number;
  url: string;
  title: string;
  pinned: boolean;
  active: boolean;
  /** `null` when the tab is not in a group. */
  groupId: number | null;
  lastAccessed: number;
};

export type GroupInfo = {
  id: number;
  title: string;
  color: GroupColor;
  collapsed: boolean;
};

/** One window as the browser reports it. `tabs` are in tab-strip order. */
export type WindowSnapshot = {
  windowId: number;
  focused: boolean;
  tabs: readonly TabInfo[];
  groups: readonly GroupInfo[];
};

export type RuleMatch =
  | { type: "host"; pattern: string }
  | { type: "prefix"; prefix: string }
  | { type: "regex"; pattern: string };

export type Rule = {
  name: string;
  color?: GroupColor;
  enabled: boolean;
  match: RuleMatch;
};

export type KeyStrategy = "domain" | "hostname";
export type TabSort = "title" | "url" | "lastAccessed";
export type GroupSort = "title" | "size" | "firstSeen";

export type Settings = {
  /** Schema version of the stored settings; see `parseSettings`. */
  version: 1;
  autoGroup: boolean;
  autoSort: boolean;
  strategy: KeyStrategy;
  /** Tabs sharing a key needed to create a group; an existing group dissolves at 1 tab. */
  minTabs: number;
  rules: readonly Rule[];
  tabSort: TabSort;
  groupSort: GroupSort;
};

/** Durable data the extension keeps between runs (storage.session). */
export type State = {
  /**
   * Groups created or adopted by the extension, by group id. A group whose title no longer
   * matches the recorded one was renamed by the user and is theirs from then on.
   */
  groups: Readonly<Record<number, { createdAt: number; title: string }>>;
  /**
   * Tabs left ungrouped only because their key is below `minTabs`. They join the next group
   * formed for that key; a tab the user took out of a group is never in this set.
   */
  pending: readonly number[];
};

export type Trigger =
  /** "Organize now": the whole window is re-evaluated, active tab included. */
  | { mode: "manual" }
  /** Browser start: the whole window, but only what the automatic settings allow; the active tab stays put. */
  | { mode: "startup" }
  /** Event-driven run: only these tabs (just created or navigated) are classified and placed. */
  | { mode: "auto"; dirtyTabIds: ReadonlySet<number> };

export type Op =
  | { type: "createGroup"; tabIds: number[]; title: string; color: GroupColor }
  | { type: "addToGroup"; groupId: number; tabIds: number[] }
  | { type: "ungroup"; tabIds: number[] }
  /** `index` is the final position of the first tab in the strip; the other tabs follow in order. */
  | { type: "moveTabs"; tabIds: number[]; index: number }
  /** `index` is the final position of the group's first tab in the strip. */
  | { type: "moveGroup"; groupId: number; index: number };

export type OrganizeInput = {
  snapshot: WindowSnapshot;
  settings: Settings;
  state: State;
  trigger: Trigger;
};

export type OrganizeResult = {
  /**
   * Operations to apply in order. Group membership changes and tab ordering are never mixed:
   * apply the ops, re-read the window and run again until `ops` is empty.
   */
  ops: Op[];
  /** Groups not in `state` that were recognised as ours (by title) and should be recorded. */
  adopted: number[];
  /** The pending tabs of this window after the run; the shell replaces its previous entries. */
  pending: number[];
  /** Active tabs of a focused window that an automatic run left alone and should be retried later. */
  deferred: number[];
};

export const defaultSettings: Settings = {
  version: 1,
  autoGroup: true,
  autoSort: false,
  strategy: "domain",
  minTabs: 3,
  rules: [],
  tabSort: "title",
  groupSort: "title",
};
