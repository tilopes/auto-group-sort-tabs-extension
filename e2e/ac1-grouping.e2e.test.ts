import { e2e } from "./harness.ts";

e2e("AC-1: three github.com tabs are grouped within a second", async (_browser, w) => {
  await w.open("https://github.com/microsoft/TypeScript");
  await w.open("https://gist.github.com/");
  await w.open("https://github.com/nodejs/node");
  await w.waitForLayout(
    [
      "example.org/",
      {
        group: "github.com",
        tabs: ["github.com/microsoft/TypeScript", "gist.github.com/", "github.com/nodejs/node"],
      },
    ],
    1_000,
  );
});
