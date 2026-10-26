// The slice of the WebExtension API the shell uses, so the shell can run against the real
// browser or the in-memory fake in tests.

type BrowserEvent<A extends unknown[]> = { addListener(listener: (...args: A) => void): void };

export type ApiTab = {
  id?: number;
  windowId: number;
  url?: string;
  pendingUrl?: string;
  title?: string;
  pinned: boolean;
  active: boolean;
  groupId: number;
  lastAccessed?: number;
};

export type ApiGroup = { id: number; title?: string; color: string; collapsed: boolean };

type StorageArea = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

export type BrowserApi = {
  windows: {
    get(windowId: number): Promise<{ focused: boolean }>;
    getAll(): Promise<{ id?: number }[]>;
    onCreated: BrowserEvent<[{ id?: number }]>;
  };
  tabs: {
    query(info: { windowId: number }): Promise<ApiTab[]>;
    move(tabIds: number[], props: { windowId: number; index: number }): Promise<unknown>;
    group(options: {
      tabIds: number[];
      groupId?: number;
      createProperties?: { windowId: number };
    }): Promise<number>;
    ungroup(tabIds: number[]): Promise<void>;
    onCreated: BrowserEvent<[ApiTab]>;
    onUpdated: BrowserEvent<[number, { url?: string }, ApiTab]>;
    onRemoved: BrowserEvent<[number]>;
    onActivated: BrowserEvent<[{ tabId: number; windowId: number }]>;
  };
  tabGroups: {
    query(info: { windowId: number }): Promise<ApiGroup[]>;
    update(groupId: number, props: { title: string; color: string }): Promise<unknown>;
    move(groupId: number, props: { windowId: number; index: number }): Promise<unknown>;
    onRemoved: BrowserEvent<[{ id: number }]>;
  };
  storage: {
    session: StorageArea;
    sync: StorageArea;
    onChanged: BrowserEvent<[Record<string, unknown>, string]>;
  };
  runtime: {
    onStartup: BrowserEvent<[]>;
    onInstalled: BrowserEvent<[{ reason: string }]>;
  };
};

const root = globalThis as unknown as { browser?: unknown; chrome?: unknown };

/** Firefox exposes promise-based `browser`; Chrome MV3 promise-based `chrome`. */
export const browserApi = (root.browser ?? root.chrome) as BrowserApi;
