import {
  defaultSettings,
  groupColors,
  type GroupColor,
  type Rule,
  type RuleMatch,
  type Settings,
} from "./types.ts";

export const minTabsLimits = { min: 2, max: 20 };

export type RuleResult = { rule: Rule } | { error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.find((candidate) => candidate === value) ?? fallback;

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function validateMatch(raw: unknown): { match: RuleMatch } | { error: string } {
  if (!isRecord(raw)) return { error: "Choose how the rule matches" };
  switch (raw.type) {
    case "host": {
      const pattern = text(raw.pattern);
      return pattern ? { match: { type: "host", pattern } } : { error: "Enter a host pattern" };
    }
    case "prefix": {
      const prefix = text(raw.prefix);
      return prefix ? { match: { type: "prefix", prefix } } : { error: "Enter a URL prefix" };
    }
    case "regex": {
      const pattern = text(raw.pattern);
      if (!pattern) return { error: "Enter a regular expression" };
      try {
        new RegExp(pattern);
      } catch (error) {
        return { error: error instanceof Error ? error.message : "Invalid regular expression" };
      }
      return { match: { type: "regex", pattern } };
    }
    default:
      return { error: "Choose how the rule matches" };
  }
}

/** A rule as the user entered it, normalised, or the reason it cannot be used. */
export function validateRule(raw: unknown): RuleResult {
  if (!isRecord(raw)) return { error: "Not a rule" };
  const name = text(raw.name);
  if (!name) return { error: "Enter a group name" };
  if (typeof raw.enabled !== "boolean") return { error: "Rule is missing its enabled flag" };
  let color: GroupColor | undefined;
  if (raw.color !== undefined) {
    color = groupColors.find((candidate) => candidate === raw.color);
    if (!color) return { error: "Unknown colour" };
  }
  const checked = validateMatch(raw.match);
  if ("error" in checked) return checked;
  return {
    rule: {
      name,
      ...(color && { color }),
      enabled: raw.enabled,
      match: checked.match,
    },
  };
}

/**
 * The effective settings for whatever was stored: every field that is missing or invalid takes
 * its default, and rules that cannot be used are dropped. Settings written by a schema version
 * this code does not know are ignored as a whole.
 */
export function parseSettings(raw: unknown): Settings {
  if (!isRecord(raw)) return defaultSettings;
  if (raw.version !== undefined && raw.version !== defaultSettings.version) return defaultSettings;
  const isMinTabs =
    typeof raw.minTabs === "number" &&
    Number.isInteger(raw.minTabs) &&
    raw.minTabs >= minTabsLimits.min &&
    raw.minTabs <= minTabsLimits.max;
  return {
    version: defaultSettings.version,
    autoGroup: typeof raw.autoGroup === "boolean" ? raw.autoGroup : defaultSettings.autoGroup,
    autoSort: typeof raw.autoSort === "boolean" ? raw.autoSort : defaultSettings.autoSort,
    strategy: oneOf(raw.strategy, ["domain", "hostname"], defaultSettings.strategy),
    minTabs: isMinTabs ? (raw.minTabs as number) : defaultSettings.minTabs,
    rules: Array.isArray(raw.rules)
      ? raw.rules.flatMap((candidate) => {
          const result = validateRule(candidate);
          return "rule" in result ? [result.rule] : [];
        })
      : defaultSettings.rules,
    tabSort: oneOf(raw.tabSort, ["title", "url", "lastAccessed"], defaultSettings.tabSort),
    groupSort: oneOf(raw.groupSort, ["title", "size", "firstSeen"], defaultSettings.groupSort),
  };
}
