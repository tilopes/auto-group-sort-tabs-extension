import assert from "node:assert/strict";
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

e2e("AC-1: a two-label public suffix groups by the registrable domain", async (_browser, w) => {
  await w.open("https://www.bbc.co.uk/news");
  await w.open("https://www.bbc.co.uk/sport");
  await w.open("https://www.bbc.co.uk/weather");
  await w.waitForLayout([
    "example.org/",
    {
      group: "bbc.co.uk",
      tabs: ["www.bbc.co.uk/news", "www.bbc.co.uk/sport", "www.bbc.co.uk/weather"],
    },
  ]);
});

e2e("AC-1: localhost groups per port", async (_browser, w) => {
  for (const path of ["a", "b", "c"]) await w.open(`http://localhost:3000/${path}`);
  await w.open("http://localhost:4000/");
  await w.open("http://localhost:4000/");
  await w.waitForLayout([
    "example.org/",
    {
      group: "localhost:3000",
      tabs: ["http://localhost:3000/a", "http://localhost:3000/b", "http://localhost:3000/c"],
    },
    "http://localhost:4000/",
    "http://localhost:4000/",
  ]);
});

e2e("AC-1: two tabs are not enough for a group", async (_browser, w) => {
  await w.open("https://en.wikipedia.org/wiki/Tab_key");
  await w.open("https://de.wikipedia.org/wiki/Tabulator");
  assert.deepEqual(await w.quietLayout(), [
    "example.org/",
    "en.wikipedia.org/wiki/Tab_key",
    "de.wikipedia.org/wiki/Tabulator",
  ]);
});
