import { planGroups, resolveOwnership } from "./plan-groups.ts";
import { planOrder } from "./plan-order.ts";
import type { OrganizeInput, OrganizeResult } from "./types.ts";

/**
 * The whole decision pipeline: what should change in this window right now.
 * Pure and idempotent: applying the result and calling again eventually returns no `ops`.
 */
export function organize({ snapshot, settings, state, trigger }: OrganizeInput): OrganizeResult {
  const { owned, adopted } = resolveOwnership(snapshot, settings, state);
  const manual = trigger.mode === "manual";
  const deferred =
    !manual && snapshot.focused
      ? snapshot.tabs
          .filter(
            (tab) => tab.active && (trigger.mode === "startup" || trigger.dirtyTabIds.has(tab.id)),
          )
          .map((tab) => tab.id)
      : [];

  let pending = state.pending.filter((id) => snapshot.tabs.some((tab) => tab.id === id));
  if (manual || settings.autoGroup) {
    const grouping = planGroups(snapshot, settings, state, trigger, owned);
    pending = grouping.pending;
    if (grouping.ops.length) return { ops: grouping.ops, adopted, pending, deferred };
  }
  const ops =
    manual || settings.autoSort ? planOrder(snapshot, settings, state, trigger, owned) : [];
  return { ops, adopted, pending, deferred };
}
