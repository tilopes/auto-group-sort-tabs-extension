import { browserApi, type BrowserApi } from "../shell/api.ts";
import type { OrganizeNowMessage } from "../shell/messages.ts";

/** The slice of the WebExtension API the popup and the options page use. */
export type PageApi = Pick<BrowserApi, "storage"> & {
  runtime: {
    sendMessage(message: OrganizeNowMessage): Promise<unknown>;
  };
  windows: { getCurrent(): Promise<{ id?: number }> };
};

export const pageApi = browserApi as unknown as PageApi;

export const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
