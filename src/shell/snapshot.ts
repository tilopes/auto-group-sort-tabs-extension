import type { GroupColor, WindowSnapshot } from "../core/types.ts";
import type { BrowserApi } from "./api.ts";

export async function readSnapshot(api: BrowserApi, windowId: number): Promise<WindowSnapshot> {
  const [tabs, groups, window] = await Promise.all([
    api.tabs.query({ windowId }),
    api.tabGroups.query({ windowId }),
    api.windows.get(windowId),
  ]);
  return {
    windowId,
    focused: window.focused,
    tabs: tabs.flatMap((tab) =>
      tab.id === undefined
        ? []
        : [
            {
              id: tab.id,
              // Chrome leaves `url` empty while a navigation is still pending.
              url: tab.url || tab.pendingUrl || "",
              title: tab.title ?? "",
              pinned: tab.pinned,
              active: tab.active,
              groupId: tab.groupId < 0 ? null : tab.groupId,
              lastAccessed: tab.lastAccessed ?? 0,
            },
          ],
    ),
    groups: groups.map((group) => ({
      id: group.id,
      title: group.title ?? "",
      color: group.color as GroupColor,
      collapsed: group.collapsed,
    })),
  };
}
