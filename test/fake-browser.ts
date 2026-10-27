// In-memory tab strip implementing the subset of tabs/tabGroups the extension uses.
// It is the single place where browser semantics live; where real browsers are not yet
// verified (marked "ASSUMPTION") the fake documents our best understanding.

export type FakeTab = {
  id: number;
  windowId: number;
  index: number;
  url: string;
  title: string;
  pinned: boolean;
  active: boolean;
  groupId: number;
  lastAccessed: number;
};

export type FakeGroup = {
  id: number;
  windowId: number;
  title: string;
  color: string;
  collapsed: boolean;
};

export type TabSpec =
  | string
  | {
      url: string;
      title?: string;
      pinned?: boolean;
      active?: boolean;
      /** Tabs listed consecutively with the same label share one group (a user-made group). */
      group?: string;
      lastAccessed?: number;
    };

export type LayoutEntry = string | { group: string; tabs: string[] };

type Listener<A extends unknown[]> = (...args: A) => void;

class FakeEvent<A extends unknown[]> {
  #listeners = new Set<Listener<A>>();
  addListener = (listener: Listener<A>) => void this.#listeners.add(listener);
  removeListener = (listener: Listener<A>) => void this.#listeners.delete(listener);
  fire(...args: A) {
    for (const listener of [...this.#listeners]) listener(...args);
  }
  clear() {
    this.#listeners.clear();
  }
}

class FakeStorageArea {
  #data = new Map<string, unknown>();
  readonly #name: string;
  readonly #onChanged: FakeEvent<[Record<string, unknown>, string]>;
  constructor(name: string, onChanged: FakeEvent<[Record<string, unknown>, string]>) {
    this.#name = name;
    this.#onChanged = onChanged;
  }
  get = async (key: string) => (this.#data.has(key) ? { [key]: this.#data.get(key) } : {});
  set = async (items: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(items)) this.#data.set(key, structuredClone(value));
    this.#onChanged.fire(
      Object.fromEntries(Object.keys(items).map((key) => [key, {}])),
      this.#name,
    );
  };
  /** Test-side: what is stored under a key. */
  peek = (key: string) => this.#data.get(key);
  seed = (items: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(items)) this.#data.set(key, structuredClone(value));
  };
}

export const NO_GROUP = -1;
const WINDOW_ID = 1;

const SCHEME = /^(https?|chrome|about|file|moz-extension|chrome-extension|edge):/;
const fullUrl = (url: string) => (SCHEME.test(url) ? url : `https://${url}`);
const displayUrl = (url: string) => url.replace(/^https:\/\//, "");

export class FakeBrowser {
  focused = true;
  /** Every API call that was made, in order, as `namespace.method`. */
  calls: string[] = [];
  /** Tab ids the extension explicitly asked the browser to move, group or ungroup. */
  touched = new Set<number>();

  #faults = new Map<string, number>();
  #refusedMoves = 0;
  #loading = new Map<number, string>();
  #tabs: FakeTab[] = [];
  #groups = new Map<number, FakeGroup>();
  #nextTabId = 1;
  #nextGroupId = 1000;

  readonly onCreated = new FakeEvent<[FakeTab & { pendingUrl?: string }]>();
  readonly onUpdated = new FakeEvent<[number, { url?: string; groupId?: number }, FakeTab]>();
  readonly onRemoved = new FakeEvent<[number, { windowId: number; isWindowClosing: boolean }]>();
  readonly onActivated = new FakeEvent<[{ tabId: number; windowId: number }]>();
  readonly onGroupRemoved = new FakeEvent<[{ id: number }]>();
  readonly onWindowCreated = new FakeEvent<[{ id: number }]>();
  readonly onStartup = new FakeEvent<[]>();
  readonly onInstalled = new FakeEvent<[{ reason: string }]>();
  readonly onStorageChanged = new FakeEvent<[Record<string, unknown>, string]>();
  readonly storage = {
    session: new FakeStorageArea("session", this.onStorageChanged),
    sync: new FakeStorageArea("sync", this.onStorageChanged),
  };

  constructor(specs: readonly TabSpec[] = []) {
    const groupIds = new Map<string, number>();
    let previousLabel: string | undefined;
    specs.forEach((spec, i) => {
      const options = typeof spec === "string" ? { url: spec } : spec;
      let groupId = NO_GROUP;
      if (options.group !== undefined) {
        if (options.group !== previousLabel || !groupIds.has(options.group)) {
          groupIds.set(options.group, this.#nextGroupId++);
          this.#groups.set(groupIds.get(options.group)!, {
            id: groupIds.get(options.group)!,
            windowId: WINDOW_ID,
            title: options.group,
            color: "grey",
            collapsed: false,
          });
        }
        groupId = groupIds.get(options.group)!;
      }
      previousLabel = options.group;
      const url = fullUrl(options.url);
      this.#tabs.push({
        id: this.#nextTabId++,
        windowId: WINDOW_ID,
        index: i,
        url,
        title: options.title ?? displayUrl(url),
        pinned: options.pinned ?? false,
        active: options.active ?? false,
        groupId,
        lastAccessed: options.lastAccessed ?? i,
      });
    });
    if (!this.#tabs.some((tab) => tab.active) && this.#tabs.length)
      this.#tabs.at(-1)!.active = true;
    this.#assertValid();
  }

  // ----- test-side helpers (not part of the browser API) -----

  /**
   * User opens a tab at the end of the strip. A `loading` tab reports `pendingUrl` in `onCreated`
   * but has no URL in queries until `finishLoading`, as observed in Chromium.
   */
  openTab(spec: TabSpec, { activate = false, loading = false } = {}): number {
    const options = typeof spec === "string" ? { url: spec } : spec;
    const url = fullUrl(options.url);
    const tab: FakeTab = {
      id: this.#nextTabId++,
      windowId: WINDOW_ID,
      index: this.#tabs.length,
      url: loading ? "" : url,
      title: loading ? "" : (options.title ?? displayUrl(url)),
      pinned: false,
      active: false,
      groupId: NO_GROUP,
      lastAccessed: Date.now(),
    };
    this.#tabs.push(tab);
    this.#reindex();
    if (loading) this.#loading.set(tab.id, url);
    this.onCreated.fire(loading ? { ...tab, pendingUrl: url } : { ...tab });
    if (activate) this.activate(tab.id);
    return tab.id;
  }

  /** The navigation of a `loading` tab commits. */
  finishLoading(tabId: number) {
    const tab = this.#tab(tabId);
    const url = this.#loading.get(tabId)!;
    this.#loading.delete(tabId);
    tab.url = url;
    tab.title = displayUrl(url);
    this.onUpdated.fire(tab.id, { url }, { ...tab });
  }

  /** User navigates a tab to another URL. */
  navigate(tabId: number | string, url: string) {
    const tab = this.#tab(this.idOf(tabId));
    tab.url = fullUrl(url);
    tab.title = displayUrl(tab.url);
    this.onUpdated.fire(tab.id, { url: tab.url }, { ...tab });
  }

  activate(tabId: number | string) {
    const target = this.#tab(this.idOf(tabId));
    for (const tab of this.#tabs) tab.active = tab === target;
    this.onActivated.fire({ tabId: target.id, windowId: target.windowId });
  }

  closeTab(tabId: number | string, { windowClosing = false } = {}) {
    const tab = this.#tab(this.idOf(tabId));
    this.#tabs.splice(tab.index, 1);
    this.#reindex();
    this.#dropEmptyGroups();
    if (tab.active && this.#tabs.length) {
      const next = this.#tabs[Math.min(tab.index, this.#tabs.length - 1)]!;
      next.active = true;
      this.onActivated.fire({ tabId: next.id, windowId: next.windowId });
    }
    this.onRemoved.fire(tab.id, { windowId: tab.windowId, isWindowClosing: windowClosing });
  }

  /** User drags a tab to a position (final index). Not recorded as an API call. */
  dragTab(tabId: number | string, index: number) {
    this.#moveTabs([this.idOf(tabId)], index);
  }

  /** User groups tabs by hand; the group is not ours. */
  userGroup(tabIds: (number | string)[], title: string): number {
    const id = this.#createGroup(tabIds.map((tab) => this.idOf(tab)));
    this.#groups.get(id)!.title = title;
    return id;
  }

  /** The next `times` calls of an API method (e.g. "tabs.group") reject. */
  failNext(call: string, times = 1) {
    this.#faults.set(call, times);
  }

  /** The next `times` `tabs.move` calls do nothing and resolve with an empty list, as Firefox does on refusal. */
  refuseMoves(times = 1) {
    this.#refusedMoves = times;
  }

  #call(name: string) {
    this.calls.push(name);
    const remaining = this.#faults.get(name) ?? 0;
    if (remaining > 0) {
      this.#faults.set(name, remaining - 1);
      throw new Error(`${name} failed`);
    }
  }

  /** The background script is stopped: its listeners are gone, session storage stays. */
  stopWorker() {
    for (const event of [
      this.onCreated,
      this.onUpdated,
      this.onRemoved,
      this.onActivated,
      this.onGroupRemoved,
      this.onWindowCreated,
      this.onStartup,
      this.onInstalled,
      this.onStorageChanged,
    ])
      event.clear();
  }

  idOf(tab: number | string): number {
    if (typeof tab === "number") return tab;
    const matches = this.#tabs.filter((candidate) => displayUrl(candidate.url) === tab);
    if (matches.length !== 1)
      throw new Error(`Expected exactly one tab "${tab}", found ${matches.length}`);
    return matches[0]!.id;
  }

  /** Details of the group with this title. */
  group(title: string): FakeGroup {
    const group = [...this.#groups.values()].find((candidate) => candidate.title === title);
    if (!group) throw new Error(`No group titled "${title}"`);
    return { ...group };
  }

  /** User renames or collapses a group. */
  userUpdateGroup(title: string, props: { title?: string; collapsed?: boolean }) {
    Object.assign(this.#group(this.group(title).id), props);
  }

  /** Current index of a tab. */
  indexOf(tab: number | string): number {
    return this.#tab(this.idOf(tab)).index;
  }

  /** The tab strip as a user sees it: ungrouped tabs as URLs, groups as `{ group, tabs }`. */
  layout(): LayoutEntry[] {
    const entries: LayoutEntry[] = [];
    for (const tab of this.#tabs) {
      const label = (tab.pinned ? "pinned: " : "") + displayUrl(tab.url);
      const last = entries.at(-1);
      if (tab.groupId === NO_GROUP) {
        entries.push(label);
      } else if (typeof last === "object" && last.group === this.#groups.get(tab.groupId)!.title) {
        last.tabs.push(label);
      } else {
        entries.push({ group: this.#groups.get(tab.groupId)!.title, tabs: [label] });
      }
    }
    return entries;
  }

  /** Calls that change the browser (everything except queries). */
  mutations(): string[] {
    return this.calls.filter((call) => !/\.(query|get|getAll)$/.test(call));
  }

  // ----- browser API -----

  readonly api = {
    windows: {
      get: async (windowId: number) => {
        this.calls.push("windows.get");
        return { id: windowId, focused: this.focused };
      },
      getAll: async () => {
        this.calls.push("windows.getAll");
        return [{ id: WINDOW_ID }];
      },
      onCreated: this.onWindowCreated,
    },
    runtime: { onStartup: this.onStartup, onInstalled: this.onInstalled },
    storage: {
      session: this.storage.session,
      sync: this.storage.sync,
      onChanged: this.onStorageChanged,
    },
    tabs: {
      onCreated: this.onCreated,
      onUpdated: this.onUpdated,
      onRemoved: this.onRemoved,
      onActivated: this.onActivated,
      query: async ({ windowId }: { windowId?: number } = {}) => {
        this.calls.push("tabs.query");
        return this.#tabs
          .filter((tab) => windowId === undefined || tab.windowId === windowId)
          .map((tab) => ({ ...tab }));
      },
      move: async (tabIds: number | number[], { index }: { windowId?: number; index: number }) => {
        this.#call("tabs.move");
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        if (this.#refusedMoves > 0) {
          this.#refusedMoves--;
          return [];
        }
        ids.forEach((id) => this.touched.add(id));
        return this.#moveTabs(ids, index).map((tab) => ({ ...tab }));
      },
      group: async ({
        tabIds,
        groupId,
      }: {
        tabIds: number | number[];
        groupId?: number;
        createProperties?: { windowId: number };
      }) => {
        this.#call("tabs.group");
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        ids.forEach((id) => this.touched.add(id));
        return groupId === undefined ? this.#createGroup(ids) : this.#addToGroup(ids, groupId);
      },
      ungroup: async (tabIds: number | number[]) => {
        this.#call("tabs.ungroup");
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        ids.forEach((id) => this.touched.add(id));
        this.#ungroup(ids);
      },
    },
    tabGroups: {
      onRemoved: this.onGroupRemoved,
      query: async ({ windowId }: { windowId?: number } = {}) => {
        this.calls.push("tabGroups.query");
        return [...this.#groups.values()]
          .filter((group) => windowId === undefined || group.windowId === windowId)
          .map((group) => ({ ...group }));
      },
      update: async (
        groupId: number,
        props: { title?: string; color?: string; collapsed?: boolean },
      ) => {
        this.#call("tabGroups.update");
        const group = this.#group(groupId);
        Object.assign(group, props);
        return { ...group };
      },
      move: async (groupId: number, { index }: { windowId?: number; index: number }) => {
        this.#call("tabGroups.move");
        this.#moveGroup(groupId, index);
        return { ...this.#group(groupId) };
      },
    },
  };

  // ----- internals -----

  #tab(id: number): FakeTab {
    const tab = this.#tabs.find((candidate) => candidate.id === id);
    if (!tab) throw new Error(`No tab with id ${id}`);
    return tab;
  }

  #group(id: number): FakeGroup {
    const group = this.#groups.get(id);
    if (!group) throw new Error(`No tab group with id ${id}`);
    return group;
  }

  #reindex() {
    this.#tabs.forEach((tab, i) => (tab.index = i));
  }

  #dropEmptyGroups() {
    for (const id of this.#groups.keys()) {
      if (!this.#tabs.some((tab) => tab.groupId === id)) {
        this.#groups.delete(id);
        this.onGroupRemoved.fire({ id });
      }
    }
  }

  #pinnedCount() {
    return this.#tabs.filter((tab) => tab.pinned).length;
  }

  #setGroup(tab: FakeTab, groupId: number) {
    if (tab.groupId === groupId) return;
    tab.groupId = groupId;
    this.onUpdated.fire(tab.id, { groupId }, { ...tab });
  }

  /** Removes `moving` from the strip and inserts them, in order, at final position `index`. */
  #place(moving: FakeTab[], index: number) {
    const rest = this.#tabs.filter((tab) => !moving.includes(tab));
    const at = index < 0 ? rest.length : Math.min(index, rest.length);
    this.#tabs = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
    this.#reindex();
  }

  /** The start/end (exclusive) of the group span that strictly contains `index`, if any. */
  #spanAround(tabs: readonly FakeTab[], index: number): { start: number; end: number } | null {
    const before = tabs[index - 1];
    const after = tabs[index];
    if (!before || !after || before.groupId === NO_GROUP || before.groupId !== after.groupId)
      return null;
    const start = tabs.findIndex((tab) => tab.groupId === before.groupId);
    const end = tabs.findLastIndex((tab) => tab.groupId === before.groupId) + 1;
    return { start, end };
  }

  // tabs.move: pinned rules fail silently (empty result), as documented on MDN.
  #moveTabs(ids: number[], index: number): FakeTab[] {
    const moving = ids.map((id) => this.#tab(id));
    const pinnedCount = this.#tabs.filter((tab) => tab.pinned && !moving.includes(tab)).length;
    const at = index < 0 ? this.#tabs.length - moving.length : index;
    if (moving.some((tab) => tab.pinned) ? at > pinnedCount : at < pinnedCount) return [];
    this.#place(moving, index);
    // ASSUMPTION (verify in the contract suite): a tab dropped between two members of a group
    // joins it; a grouped tab dropped away from its group leaves it.
    for (const tab of moving) {
      const before = this.#tabs[tab.index - 1];
      const after = this.#tabs[tab.index + 1];
      if (before && before.groupId !== NO_GROUP && before.groupId === after?.groupId) {
        this.#setGroup(tab, before.groupId);
      } else if (
        tab.groupId !== NO_GROUP &&
        before?.groupId !== tab.groupId &&
        after?.groupId !== tab.groupId
      ) {
        this.#setGroup(tab, NO_GROUP);
      }
    }
    this.#dropEmptyGroups();
    this.#assertValid();
    return moving;
  }

  #addToGroup(ids: number[], groupId: number): number {
    const group = this.#group(groupId);
    const moving = ids.map((id) => this.#tab(id));
    if (moving.some((tab) => tab.pinned)) throw new Error("Cannot group pinned tabs");
    const members = this.#tabs.filter((tab) => tab.groupId === group.id && !moving.includes(tab));
    // Verified in Chromium (e2e): a tab from the left of the group lands before its first member,
    // any other tab after its last member.
    const start = members.length ? this.#tabs.indexOf(members[0]!) : this.#tabs.length;
    const fromLeft = moving.filter((tab) => tab.index < start);
    if (fromLeft.length) this.#place(fromLeft, start - fromLeft.length);
    const fromRight = moving.filter((tab) => !fromLeft.includes(tab));
    if (fromRight.length) {
      const end = members.length ? this.#tabs.indexOf(members.at(-1)!) + 1 : this.#tabs.length;
      this.#place(fromRight, end - fromRight.filter((tab) => tab.index < end).length);
    }
    for (const tab of moving) this.#setGroup(tab, groupId);
    this.#dropEmptyGroups();
    this.#assertValid();
    return groupId;
  }

  #createGroup(ids: number[]): number {
    const moving = ids.map((id) => this.#tab(id));
    if (moving.some((tab) => tab.pinned)) throw new Error("Cannot group pinned tabs");
    const id = this.#nextGroupId++;
    this.#groups.set(id, { id, windowId: WINDOW_ID, title: "", color: "grey", collapsed: false });
    // ASSUMPTION: the new group appears where its leftmost tab was, and never splits another group.
    // (Consistent with the e2e layouts in real Chromium; not isolated by a dedicated scenario.)
    const sorted = [...moving].sort((a, b) => a.index - b.index);
    const rest = this.#tabs.filter((tab) => !moving.includes(tab));
    let at = sorted[0]!.index;
    const span = this.#spanAround(rest, at);
    if (span) at = span.end;
    this.#tabs = [...rest.slice(0, at), ...sorted, ...rest.slice(at)];
    this.#reindex();
    for (const tab of sorted) this.#setGroup(tab, id);
    this.#dropEmptyGroups();
    this.#assertValid();
    return id;
  }

  #ungroup(ids: number[]) {
    for (const tab of ids.map((id) => this.#tab(id))) {
      if (tab.groupId === NO_GROUP) continue;
      const groupId = tab.groupId;
      const members = this.#tabs.filter((candidate) => candidate.groupId === groupId);
      const position = members.indexOf(tab);
      this.#setGroup(tab, NO_GROUP);
      // Verified in Chromium (e2e): a tab leaves towards the nearer end of its group, after it on a tie.
      const rest = this.#tabs.filter((candidate) => candidate !== tab);
      const first = rest.findIndex((candidate) => candidate.groupId === groupId);
      if (first === -1) continue;
      const before = position < members.length - 1 - position;
      this.#place([tab], before ? first : rest.findLastIndex((t) => t.groupId === groupId) + 1);
    }
    this.#dropEmptyGroups();
    this.#assertValid();
  }

  #moveGroup(groupId: number, index: number) {
    const moving = this.#tabs.filter((tab) => tab.groupId === groupId);
    if (!moving.length) throw new Error(`No tab group with id ${groupId}`);
    const rest = this.#tabs.filter((tab) => !moving.includes(tab));
    const at = index < 0 ? rest.length : index;
    if (at < this.#pinnedCount()) throw new Error("Cannot move a group before pinned tabs");
    if (this.#spanAround(rest, Math.min(at, rest.length)))
      throw new Error("Cannot move a group inside another group");
    this.#place(moving, index);
    this.#assertValid();
  }

  #assertValid() {
    const seen = new Set<number>();
    let previous: number | undefined;
    let unpinnedSeen = false;
    for (const tab of this.#tabs) {
      if (tab.pinned && unpinnedSeen)
        throw new Error("Fake browser: pinned tab after unpinned tab");
      if (!tab.pinned) unpinnedSeen = true;
      if (tab.groupId !== NO_GROUP && tab.groupId !== previous && seen.has(tab.groupId)) {
        throw new Error(`Fake browser: group ${tab.groupId} is not contiguous`);
      }
      if (tab.groupId !== NO_GROUP) seen.add(tab.groupId);
      if (tab.pinned && tab.groupId !== NO_GROUP)
        throw new Error("Fake browser: pinned tab in a group");
      previous = tab.groupId;
    }
  }
}

export const fakeBrowser = (tabs: readonly TabSpec[] = []) => new FakeBrowser(tabs);
export { WINDOW_ID };
