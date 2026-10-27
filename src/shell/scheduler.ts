export type Work = {
  full: "startup" | "manual" | null;
  dirtyTabIds: ReadonlySet<number>;
};

export type RunResult = {
  /** Active tabs left alone; they are retried once the user switches tabs. */
  deferred: readonly number[];
  failed: boolean;
};

export type SchedulerOptions = {
  debounceMs?: number;
  maxWaitMs?: number;
  /** Consecutive failed runs of one window before giving up until the next event. */
  maxAttempts?: number;
};

type Slot = {
  dirty: Set<number>;
  deferred: Set<number>;
  full: Work["full"];
  /** Something changed since the last run started; a run in progress may have missed it. */
  changed: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  firstEventAt: number;
  running: boolean;
  attempts: number;
};

const rank = { startup: 1, manual: 2 } as const;
const stronger = (a: Work["full"], b: Work["full"]) =>
  (a ? rank[a] : 0) >= (b ? rank[b] : 0) ? a : b;

/**
 * Collects events per window and runs `run` once things have calmed down: trailing debounce with
 * a maximum wait, one run at a time per window, and a single re-run for events that arrive mid-run.
 */
export function createScheduler(
  run: (windowId: number, work: Work) => Promise<RunResult>,
  { debounceMs = 300, maxWaitMs = 2000, maxAttempts = 3 }: SchedulerOptions = {},
) {
  const slots = new Map<number, Slot>();
  const inflight = new Set<Promise<void>>();

  const slotOf = (windowId: number): Slot => {
    let slot = slots.get(windowId);
    if (!slot) {
      slot = {
        dirty: new Set(),
        deferred: new Set(),
        full: null,
        changed: false,
        timer: undefined,
        firstEventAt: 0,
        running: false,
        attempts: 0,
      };
      slots.set(windowId, slot);
    }
    return slot;
  };

  function schedule(windowId: number) {
    const slot = slotOf(windowId);
    if (slot.running) return;
    if (slot.timer === undefined) slot.firstEventAt = Date.now();
    else clearTimeout(slot.timer);
    const waited = Date.now() - slot.firstEventAt;
    slot.timer = setTimeout(
      () => {
        const done = fire(windowId).finally(() => inflight.delete(done));
        inflight.add(done);
      },
      Math.max(0, Math.min(debounceMs, maxWaitMs - waited)),
    );
  }

  async function fire(windowId: number) {
    const slot = slotOf(windowId);
    slot.timer = undefined;
    const work: Work = { full: slot.full, dirtyTabIds: new Set([...slot.dirty, ...slot.deferred]) };
    slot.full = null;
    slot.changed = false;
    slot.dirty.clear();
    slot.deferred.clear();
    slot.running = true;

    let result: RunResult;
    try {
      result = await run(windowId, work);
    } catch (error) {
      console.warn("Auto Sort Tabs: run failed", error);
      result = { deferred: [], failed: true };
    }
    slot.running = false;

    if (result.failed && ++slot.attempts < maxAttempts) {
      slot.full = stronger(slot.full, work.full);
      work.dirtyTabIds.forEach((id) => slot.dirty.add(id));
    } else {
      slot.attempts = 0;
      result.deferred.forEach((id) => slot.deferred.add(id));
    }
    if (slot.full || slot.dirty.size || slot.changed) schedule(windowId);
  }

  return {
    /** A tab was created or navigated to another group key. */
    markDirty(windowId: number, tabId: number) {
      slotOf(windowId).dirty.add(tabId);
      schedule(windowId);
    },
    /** Something changed in the window that may need tidying up, e.g. a tab was closed. */
    markChanged(windowId: number) {
      slotOf(windowId).changed = true;
      schedule(windowId);
    },
    /** The whole window should be re-evaluated. */
    requestFull(windowId: number, kind: "startup" | "manual") {
      const slot = slotOf(windowId);
      slot.full = stronger(slot.full, kind);
      schedule(windowId);
    },
    /** The user switched tabs: retry whatever was held back for the active tab. */
    retryDeferred(windowId: number) {
      if (slotOf(windowId).deferred.size) schedule(windowId);
    },
    forgetTab(tabId: number) {
      for (const slot of slots.values()) {
        slot.dirty.delete(tabId);
        slot.deferred.delete(tabId);
      }
    },
    /** Resolves when no run is in flight. */
    async idle() {
      while (inflight.size) await Promise.all([...inflight]);
    },
    hasPending: () => [...slots.values()].some((slot) => slot.timer !== undefined),
  };
}
