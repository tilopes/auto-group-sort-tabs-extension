import { isMinTabs, minTabsLimits, parseSettings, validateRule } from "../core/settings.ts";
import { groupColors, type Rule, type Settings } from "../core/types.ts";
import { loadSettings, saveSettings } from "../shell/settings.ts";
import { byId, pageApi } from "./page-api.ts";

const status = byId<HTMLElement>("status");
const list = byId<HTMLOListElement>("rules");
const template = byId<HTMLTemplateElement>("rule-template");
const fields = {
  strategy: byId<HTMLSelectElement>("strategy"),
  minTabs: byId<HTMLInputElement>("minTabs"),
  tabSort: byId<HTMLSelectElement>("tabSort"),
  groupSort: byId<HTMLSelectElement>("groupSort"),
};

const placeholders = {
  host: "*.example.com",
  prefix: "https://example.com/docs/",
  regex: "^https://(docs|help)\\.example\\.com/",
};

fields.minTabs.min = String(minTabsLimits.min);
fields.minTabs.max = String(minTabsLimits.max);

const field = <T extends HTMLElement>(row: Element, selector: string) =>
  row.querySelector<T>(selector)!;

function addRule(rule?: Rule) {
  const row = template.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
  for (const color of groupColors) {
    field<HTMLSelectElement>(row, ".color").append(new Option(color, color));
  }
  const match = rule?.match ?? { type: "host" as const, pattern: "" };
  field<HTMLInputElement>(row, ".name").value = rule?.name ?? "";
  field<HTMLSelectElement>(row, ".type").value = match.type;
  field<HTMLInputElement>(row, ".value").value =
    match.type === "prefix" ? match.prefix : match.pattern;
  field<HTMLSelectElement>(row, ".color").value = rule?.color ?? "";
  field<HTMLInputElement>(row, ".enabled").checked = rule?.enabled ?? true;
  showPlaceholder(row);
  list.append(row);
}

function showPlaceholder(row: Element) {
  const type = field<HTMLSelectElement>(row, ".type").value as keyof typeof placeholders;
  field<HTMLInputElement>(row, ".value").placeholder = placeholders[type];
}

/** The rule as typed into a row, not yet validated. */
function readRule(row: Element) {
  const type = field<HTMLSelectElement>(row, ".type").value;
  const value = field<HTMLInputElement>(row, ".value").value;
  const color = field<HTMLSelectElement>(row, ".color").value;
  return {
    name: field<HTMLInputElement>(row, ".name").value,
    ...(color && { color }),
    enabled: field<HTMLInputElement>(row, ".enabled").checked,
    match: type === "prefix" ? { type, prefix: value } : { type, pattern: value },
  };
}

function render(settings: Settings) {
  fields.strategy.value = settings.strategy;
  fields.minTabs.value = String(settings.minTabs);
  fields.tabSort.value = settings.tabSort;
  fields.groupSort.value = settings.groupSort;
  list.replaceChildren();
  settings.rules.forEach(addRule);
}

const describe = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return /quota/i.test(message)
    ? `${message}. Settings sync is limited in size; remove some rules.`
    : message;
};

byId("addRule").addEventListener("click", () => addRule());

list.addEventListener("click", ({ target }) => {
  const row = (target as Element).closest("li");
  const button = (target as Element).closest("button");
  if (!row || !button) return;
  if (button.classList.contains("remove")) row.remove();
  else if (button.classList.contains("up")) row.previousElementSibling?.before(row);
  else if (button.classList.contains("down")) row.nextElementSibling?.after(row);
});

list.addEventListener("change", ({ target }) => {
  if ((target as Element).classList.contains("type"))
    showPlaceholder((target as Element).closest("li")!);
});

byId("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const rows = [...list.children];
  const results = rows.map((row) => validateRule(readRule(row)));
  rows.forEach((row, i) => {
    const result = results[i]!;
    field(row, ".error").textContent = "error" in result ? result.error : "";
  });
  if (results.some((result) => "error" in result)) {
    status.textContent = "Not saved: fix the rules marked below.";
    return;
  }
  if (!isMinTabs(Number(fields.minTabs.value))) return;
  try {
    const current = await loadSettings(pageApi.storage);
    await saveSettings(
      pageApi.storage,
      parseSettings({
        ...current,
        strategy: fields.strategy.value,
        minTabs: Number(fields.minTabs.value),
        tabSort: fields.tabSort.value,
        groupSort: fields.groupSort.value,
        rules: results.flatMap((result) => ("rule" in result ? [result.rule] : [])),
      }),
    );
    status.textContent = "Saved.";
  } catch (error) {
    status.textContent = `Not saved: ${describe(error)}`;
  }
});

render(await loadSettings(pageApi.storage));
