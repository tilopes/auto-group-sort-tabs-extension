// What the extension's pages can ask the background worker to do.

export type OrganizeNowMessage = { type: "organize-now"; windowId: number };

export const isOrganizeNowMessage = (message: unknown): message is OrganizeNowMessage =>
  typeof message === "object" &&
  message !== null &&
  "type" in message &&
  message.type === "organize-now" &&
  "windowId" in message &&
  typeof message.windowId === "number";
