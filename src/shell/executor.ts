import type { Op } from "../core/types.ts";
import type { BrowserApi } from "./api.ts";

export type CreatedGroup = { groupId: number; title: string };

/**
 * Applies ops in order and stops at the first failure by throwing; the caller re-reads the
 * window and plans again. Returns the groups that were created.
 */
export async function execute(
  api: BrowserApi,
  windowId: number,
  ops: readonly Op[],
): Promise<CreatedGroup[]> {
  const created: CreatedGroup[] = [];
  for (const op of ops) {
    switch (op.type) {
      case "createGroup": {
        const groupId = await api.tabs.group({
          tabIds: op.tabIds,
          createProperties: { windowId },
        });
        try {
          await api.tabGroups.update(groupId, { title: op.title, color: op.color });
        } catch (error) {
          // An untitled group would look like the user's, so do not leave one behind.
          await api.tabs.ungroup(op.tabIds).catch(() => {});
          throw error;
        }
        created.push({ groupId, title: op.title });
        break;
      }
      case "addToGroup":
        await api.tabs.group({ tabIds: op.tabIds, groupId: op.groupId });
        break;
      case "ungroup":
        await api.tabs.ungroup(op.tabIds);
        break;
      case "moveTabs": {
        const moved = await api.tabs.move(op.tabIds, { windowId, index: op.index });
        // Firefox resolves with an empty list when it refuses a move (e.g. across the pinned boundary).
        if (Array.isArray(moved) ? moved.length === 0 : !moved) {
          throw new Error(`tabs.move had no effect (index ${op.index})`);
        }
        break;
      }
      case "moveGroup":
        await api.tabGroups.move(op.groupId, { windowId, index: op.index });
        break;
    }
  }
  return created;
}
