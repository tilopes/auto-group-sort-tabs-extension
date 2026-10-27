import assert from "node:assert/strict";
import type { Page } from "playwright";
import { e2e } from "./harness.ts";

type RuleForm = {
  name: string;
  type: "Host" | "URL prefix" | "Regular expression";
  pattern: string;
  color?: string;
};

/** Adds a rule row in the options page and fills it in, as a user would. */
async function addRule(page: Page, { name, type, pattern, color }: RuleForm) {
  await page.click("#addRule");
  const row = page.locator("li.rule").last();
  await row.getByLabel("Group name").fill(name);
  await row.getByLabel("Match type").selectOption({ label: type });
  await row.getByLabel("Pattern").fill(pattern);
  if (color) await row.getByLabel("Colour").selectOption(color);
}

const docsRule: RuleForm = {
  name: "Docs",
  type: "Regular expression",
  pattern: "^https://(developer\\.mozilla\\.org|docs\\.github\\.com)/",
  color: "blue",
};

e2e("options: a new rule is saved and groups the next tabs", async (browser, w) => {
  const page = await w.openOptions();
  await addRule(page, docsRule);

  const stored = await browser.savedSettings((s) => s.rules?.[0]?.color === "blue");
  assert.deepEqual(stored.rules, [
    {
      name: "Docs",
      color: "blue",
      enabled: true,
      match: { type: "regex", pattern: docsRule.pattern },
    },
  ]);

  await w.open("https://developer.mozilla.org/en-US/docs/Web/API");
  await w.open("https://docs.github.com/en");
  await w.open("https://github.com/a");
  await w.open("https://developer.mozilla.org/en-US/docs/Learn");
  await w.waitForLayout([
    "example.org/",
    {
      group: "Docs",
      tabs: [
        "developer.mozilla.org/en-US/docs/Web/API",
        "docs.github.com/en",
        "developer.mozilla.org/en-US/docs/Learn",
      ],
    },
    "github.com/a",
  ]);
  assert.equal(await w.groupColor("Docs"), "blue");
});

e2e("options: strategy and group size apply without restarting", async (browser, w) => {
  const page = await w.openOptions();
  assert.equal(await page.locator("#minTabs").inputValue(), "3");
  await page.selectOption("#strategy", "hostname");
  await page.fill("#minTabs", "2");

  const stored = await browser.savedSettings((s) => s.strategy === "hostname" && s.minTabs === 2);
  assert.equal(stored.strategy, "hostname");
  assert.equal(stored.minTabs, 2);

  await w.open("https://docs.github.com/a");
  await w.open("https://docs.github.com/b");
  await w.open("https://gist.github.com/");
  await w.waitForLayout([
    "example.org/",
    { group: "docs.github.com", tabs: ["docs.github.com/a", "docs.github.com/b"] },
    "gist.github.com/",
  ]);
});

e2e(
  "options: a regex that does not compile is reported and nothing is saved",
  async (browser, w) => {
    const page = await w.openOptions();
    await addRule(page, { name: "Broken", type: "Regular expression", pattern: "^https://(docs" });
    await page.locator("li.rule .value").blur();

    const error = page.locator("li.rule .error");
    await error.getByText(/regular expression/i).waitFor();
    await page.getByText(/Not saved/).waitFor();
    assert.equal(await browser.storedSettings(), undefined);

    await page.locator("li.rule").getByLabel("Pattern").fill("^https://docs\\.");
    await browser.savedSettings((s) => s.rules?.length === 1);
    assert.equal(await error.innerText(), "");
  },
);

e2e("options: a group size out of range is reported and not saved", async (browser, w) => {
  const page = await w.openOptions();
  await page.fill("#minTabs", "1");
  await page.locator("#minTabs").blur();
  await page
    .locator("#minTabsError")
    .getByText(/2 to 20/)
    .waitFor();
  assert.equal(await browser.storedSettings(), undefined);

  await page.fill("#minTabs", "4");
  await browser.savedSettings((s) => s.minTabs === 4);
  assert.equal(await page.locator("#minTabsError").innerText(), "");
});

e2e("options: changes show a Saved indicator", async (_browser, w) => {
  const page = await w.openOptions();
  await page.selectOption("#tabSort", "url");
  await page.locator("#status").getByText("Saved").waitFor();
});

e2e("options: rules can be reordered, switched off and removed", async (browser, w) => {
  const page = await w.openOptions();
  await addRule(page, { name: "First", type: "Host", pattern: "a.example" });
  await addRule(page, { name: "Second", type: "URL prefix", pattern: "https://b.example/" });
  await addRule(page, { name: "Third", type: "Host", pattern: "c.example" });
  await page.locator("li.rule").nth(1).getByLabel("Move up").click();
  await page.locator("li.rule").nth(2).getByLabel("Remove rule").click();
  await page.locator("li.rule").nth(1).locator(".enabled").uncheck();

  const { rules } = await browser.savedSettings(
    (s) => s.rules?.length === 2 && s.rules[1].enabled === false,
  );
  assert.deepEqual(
    rules.map(({ name, enabled }: { name: string; enabled: boolean }) => [name, enabled]),
    [
      ["Second", true],
      ["First", false],
    ],
  );

  const reloaded = await w.openOptions();
  assert.deepEqual(
    await reloaded
      .locator("li.rule .name")
      .evaluateAll((all) => all.map((e) => (e as HTMLInputElement).value)),
    ["Second", "First"],
  );
});

e2e("options: the popup links to the options page", async (_browser, w) => {
  const popup = await w.openPopup();
  const opened = popup.context().waitForEvent("page");
  await popup.click("#options");
  const page = await opened;
  assert.match(page.url(), /\/ui\/options\.html$/);
});

e2e("options: exported settings can be imported again", async (browser, w) => {
  const page = await w.openOptions();
  await addRule(page, docsRule);
  await page.selectOption("#strategy", "hostname");
  const saved = await browser.savedSettings((s) => s.strategy === "hostname" && s.rules?.length);

  await page.click("#export");
  const exported = await page.locator("#json").inputValue();
  assert.deepEqual(JSON.parse(exported), saved);

  await page.locator("li.rule").getByLabel("Remove rule").click();
  await page.selectOption("#strategy", "domain");
  await browser.savedSettings((s) => s.strategy === "domain" && s.rules.length === 0);

  await page.locator("#json").fill(exported);
  await page.click("#import");
  await page.getByText("Imported.").waitFor();
  assert.deepEqual(await browser.storedSettings(), saved);
  assert.equal(await page.locator("#strategy").inputValue(), "hostname");
  assert.equal(await page.locator("li.rule").count(), 1);
});

e2e("options: an import that is not settings changes nothing", async (browser, w) => {
  const page = await w.openOptions();
  await page.locator("#json").fill('{"version": 2, "autoSort": true}');
  await page.click("#import");
  await page.getByText(/Not imported: Unsupported settings version/).waitFor();
  await page.locator("#json").fill("{ nope");
  await page.click("#import");
  await page.getByText(/Not imported: Not valid JSON/).waitFor();
  assert.equal(await browser.storedSettings(), undefined);
});

e2e("options: an import skips invalid rules and reports it", async (browser, w) => {
  const page = await w.openOptions();
  const good = { name: "Docs", enabled: true, match: { type: "host", pattern: "docs.github.com" } };
  const bad = { name: "Bad", enabled: true, match: { type: "regex", pattern: "(" } };
  await page.locator("#json").fill(JSON.stringify({ rules: [good, bad] }));
  await page.click("#import");
  await page.getByText("Imported. 1 rule(s) were not valid and were skipped.").waitFor();
  assert.deepEqual((await browser.storedSettings()).rules, [good]);
  assert.equal(await page.locator("li.rule").count(), 1);
});
