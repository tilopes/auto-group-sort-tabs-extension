import {
  importSettings,
  isMinTabs,
  minTabsLimits,
  parseSettings,
  validateRule,
} from "../core/settings.ts";
import { groupColors, type Rule, type Settings } from "../core/types.ts";
import { loadSettings, saveSettings } from "../shell/settings.ts";
import { byId, pageApi } from "./page-api.ts";

const status = byId<HTMLElement>("status");
const backupStatus = byId<HTMLElement>("backupStatus");
const minTabsError = byId<HTMLElement>("minTabsError");
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
    field<HTMLSelectElement>(row, ".color").append(
      new Option(color[0]!.toUpperCase() + color.slice(1), color),
    );
  }
  const match = rule?.match ?? { type: "host" as const, pattern: "" };
  field<HTMLInputElement>(row, ".name").value = rule?.name ?? "";
  field<HTMLSelectElement>(row, ".type").value = match.type;
  field<HTMLInputElement>(row, ".value").value =
    match.type === "prefix" ? match.prefix : match.pattern;
  field<HTMLSelectElement>(row, ".color").value = rule?.color ?? "";
  field<HTMLInputElement>(row, ".enabled").checked = rule?.enabled ?? true;
  showPlaceholder(row);
  showColor(row);
  list.append(row);
  return row;
}

function showColor(row: HTMLElement) {
  const color = field<HTMLSelectElement>(row, ".color").value;
  if (color) row.dataset.color = color;
  else delete row.dataset.color;
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

let saveQueue = Promise.resolve();
let debounce: ReturnType<typeof setTimeout> | undefined;
let clearStatus: ReturnType<typeof setTimeout> | undefined;

/** Writes to storage.sync are rate limited, so typing is saved after a pause. */
const saveSoon = () => {
  clearTimeout(debounce);
  debounce = setTimeout(saveNow, 600);
};

function saveNow() {
  clearTimeout(debounce);
  saveQueue = saveQueue.then(save);
}

function show(element: HTMLElement, text: string, kind: "saved" | "error" | "" = "") {
  element.textContent = text;
  element.className = kind;
  if (element === status) {
    clearTimeout(clearStatus);
    if (kind === "saved") clearStatus = setTimeout(() => show(status, ""), 2500);
  }
}

/** Saves what is valid; invalid rules and an invalid tab count keep their stored value. */
async function save() {
  const rows = [...list.children] as HTMLElement[];
  const results = rows.map((row) => validateRule(readRule(row)));
  let hasErrors = false;
  rows.forEach((row, i) => {
    const result = results[i]!;
    const error = "error" in result && row.dataset.touched ? result.error : "";
    field(row, ".error").textContent = error;
    hasErrors ||= error !== "";
  });
  const rulesValid = results.every((result) => "rule" in result);
  const minTabs = Number(fields.minTabs.value);
  const minTabsValid = isMinTabs(minTabs);
  minTabsError.textContent = minTabsValid
    ? ""
    : `Enter a whole number from ${minTabsLimits.min} to ${minTabsLimits.max}.`;
  hasErrors ||= !minTabsValid;

  try {
    const current = await loadSettings(pageApi.storage);
    const next = parseSettings({
      ...current,
      strategy: fields.strategy.value,
      minTabs: minTabsValid ? minTabs : current.minTabs,
      tabSort: fields.tabSort.value,
      groupSort: fields.groupSort.value,
      rules: rulesValid
        ? results.flatMap((result) => ("rule" in result ? [result.rule] : []))
        : current.rules,
    });
    if (JSON.stringify(next) !== JSON.stringify(current)) {
      await saveSettings(pageApi.storage, next);
      show(status, hasErrors ? "Saved, except the fields marked below." : "Saved", "saved");
    } else if (hasErrors) {
      show(status, "Not saved: fix the fields marked below.", "error");
    }
    if (!hasErrors && status.className === "error") show(status, "");
  } catch (error) {
    show(status, `Not saved: ${describe(error)}`, "error");
  }
}

byId("addRule").addEventListener("click", () => {
  addRule().querySelector<HTMLInputElement>(".name")!.focus();
});

list.addEventListener("click", ({ target }) => {
  const row = (target as Element).closest("li");
  const button = (target as Element).closest("button");
  if (!row || !button) return;
  if (button.classList.contains("remove")) row.remove();
  else if (button.classList.contains("up")) row.previousElementSibling?.before(row);
  else if (button.classList.contains("down")) row.nextElementSibling?.after(row);
  else return;
  saveNow();
});

list.addEventListener("change", ({ target }) => {
  const row = (target as Element).closest<HTMLElement>("li")!;
  if ((target as Element).classList.contains("type")) showPlaceholder(row);
  if ((target as Element).classList.contains("color")) showColor(row);
});

// A rule's errors are shown once the user has left the row, not while they move between fields.
list.addEventListener("focusout", ({ target, relatedTarget }) => {
  const row = (target as Element).closest<HTMLElement>("li");
  if (!row || row.contains(relatedTarget as Node | null)) return;
  row.dataset.touched = "true";
  saveNow();
});

// Text is saved after a pause or on blur; selects and switches fire only `change`.
for (const target of [list, ...Object.values(fields)]) {
  target.addEventListener("input", saveSoon);
  target.addEventListener("change", saveNow);
}

const json = byId<HTMLTextAreaElement>("json");

byId("export").addEventListener("click", async () => {
  json.value = JSON.stringify(await loadSettings(pageApi.storage), null, 2);
  show(backupStatus, "");
});

byId("import").addEventListener("click", async () => {
  const result = importSettings(json.value);
  if ("error" in result) {
    show(backupStatus, `Not imported: ${result.error}.`, "error");
    return;
  }
  try {
    await saveSettings(pageApi.storage, result.settings);
  } catch (error) {
    show(backupStatus, `Not imported: ${describe(error)}`, "error");
    return;
  }
  render(result.settings);
  show(
    backupStatus,
    result.skippedRules
      ? `Imported. ${result.skippedRules} rule(s) were not valid and were skipped.`
      : "Imported.",
    "saved",
  );
});

render(await loadSettings(pageApi.storage));
