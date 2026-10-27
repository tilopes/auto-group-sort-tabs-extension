import { e2e } from "./harness.ts";

e2e("AC-4: pinned tabs are never grouped or moved", async (_browser, w) => {
  await w.open("https://github.com/notifications", { pinned: true });
  for (const path of ["a", "b", "c"]) await w.open(`https://github.com/${path}`);
  await w.waitForLayout([
    "pinned: github.com/notifications",
    "example.org/",
    { group: "github.com", tabs: ["github.com/a", "github.com/b", "github.com/c"] },
  ]);
});
