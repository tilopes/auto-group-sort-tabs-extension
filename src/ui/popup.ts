import { loadSettings, saveSettings } from "../shell/settings.ts";
import { byId, pageApi } from "./page-api.ts";

const status = byId<HTMLElement>("status");

for (const key of ["autoGroup", "autoSort"] as const) {
  const box = byId<HTMLInputElement>(key);
  box.checked = (await loadSettings(pageApi.storage))[key];
  box.addEventListener("change", async () => {
    try {
      // Read again so a change made on the options page in the meantime is kept.
      await saveSettings(pageApi.storage, {
        ...(await loadSettings(pageApi.storage)),
        [key]: box.checked,
      });
      status.textContent = "";
    } catch (error) {
      box.checked = !box.checked;
      status.textContent = `Not saved: ${error instanceof Error ? error.message : error}`;
    }
  });
}

byId("organize").addEventListener("click", async () => {
  const { id } = await pageApi.windows.getCurrent();
  if (id !== undefined) await pageApi.runtime.sendMessage({ type: "organize-now", windowId: id });
  window.close();
});
