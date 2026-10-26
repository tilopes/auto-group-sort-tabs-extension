import type { State } from "../core/types.ts";
import type { BrowserApi } from "./api.ts";

const KEY = "state";
/** The core's state plus the shell's own bookkeeping. */
export type StoredState = State & {
  /** Group key each tab had when last seen (null: not groupable); lets same-key navigations be ignored. */
  keys: Readonly<Record<number, string | null>>;
};

const empty: StoredState = { groups: {}, pending: [], keys: {} };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parse(stored: unknown): StoredState {
  if (!isRecord(stored)) return empty;
  return {
    groups: isRecord(stored.groups) ? (stored.groups as State["groups"]) : {},
    pending: Array.isArray(stored.pending) ? (stored.pending as number[]) : [],
    keys: isRecord(stored.keys) ? (stored.keys as StoredState["keys"]) : {},
  };
}

/**
 * The extension's memory (owned groups, pending tabs, last-known group keys), kept in `storage.session` so it survives the
 * background script being stopped but not a browser restart. Updates are chained in call order,
 * so concurrent windows never overwrite each other.
 */
export function createStateStore(api: BrowserApi) {
  let current: Promise<StoredState> | undefined;
  let writes: Promise<unknown> = Promise.resolve();

  const load = () => (current ??= api.storage.session.get(KEY).then((items) => parse(items[KEY])));

  return {
    get: load,
    async update(change: (state: StoredState) => StoredState): Promise<void> {
      const next = load().then(change);
      current = next;
      writes = writes
        .then(async () => api.storage.session.set({ [KEY]: await next }))
        .catch(() => {});
      await writes;
    },
  };
}
