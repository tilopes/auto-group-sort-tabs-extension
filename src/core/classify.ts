import { registrableDomain } from "./domain.ts";
import type { GroupColor, KeyStrategy, Rule, Settings } from "./types.ts";

export type Classification = { title: string; color: GroupColor };

const colors: readonly GroupColor[] = [
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
];

/** Deterministic colour (FNV-1a) so a key keeps its colour across sessions. */
function colorFor(title: string): GroupColor {
  let hash = 0x811c9dc5;
  for (let i = 0; i < title.length; i++) {
    hash = Math.imul(hash ^ title.charCodeAt(i), 0x01000193);
  }
  return colors[(hash >>> 0) % colors.length] ?? "grey";
}

function parseWebUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

const isIpAddress = (host: string) => host.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(host);

/**
 * Grouping key of a web URL for a strategy, or `null` for pages that are never grouped
 * (`about:`, `chrome://`, `file:`, ...). IP addresses and single-label hosts such as
 * `localhost` are kept as-is together with an explicit port.
 */
export function hostKey(url: string, strategy: KeyStrategy): string | null {
  const parsed = parseWebUrl(url);
  if (!parsed || !parsed.hostname) return null;
  const host = parsed.hostname.replace(/\.$/, "");
  if (isIpAddress(host) || !host.includes(".")) {
    return parsed.port ? `${host}:${parsed.port}` : host;
  }
  return strategy === "domain" ? registrableDomain(host) : host;
}

type Matcher = (url: URL) => boolean;

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  // `*.example.com` also matches `example.com`, as in WebExtension match patterns.
  const withBareDomain = escaped.startsWith(".*\\.") ? `(?:.*\\.)?${escaped.slice(4)}` : escaped;
  return new RegExp(`^${withBareDomain}$`, "i");
}

function compileMatcher(rule: Rule): Matcher | null {
  const { match } = rule;
  switch (match.type) {
    case "host": {
      const pattern = globToRegExp(match.pattern.trim());
      return (url) => pattern.test(url.hostname);
    }
    case "prefix":
      return (url) => url.href.startsWith(match.prefix);
    case "regex":
      try {
        const pattern = new RegExp(match.pattern);
        return (url) => pattern.test(url.href);
      } catch {
        return null;
      }
  }
}

type CompiledRule = { classification: Classification; matches: Matcher };

const compiledRules = new WeakMap<readonly Rule[], CompiledRule[]>();

/** Compiled once per rules array, i.e. once per settings version. */
function compile(rules: readonly Rule[]): CompiledRule[] {
  let compiled = compiledRules.get(rules);
  if (!compiled) {
    compiled = [];
    for (const rule of rules) {
      const matches = rule.enabled ? compileMatcher(rule) : null;
      if (matches) {
        compiled.push({
          classification: { title: rule.name, color: rule.color ?? colorFor(rule.name) },
          matches,
        });
      }
    }
    compiledRules.set(rules, compiled);
  }
  return compiled;
}

/** The group a URL belongs to: the first matching rule wins, then the key strategy. */
export function classify(
  tab: { url: string },
  settings: Pick<Settings, "rules" | "strategy">,
): Classification | null {
  const parsed = parseWebUrl(tab.url);
  if (!parsed) return null;
  for (const rule of compile(settings.rules)) {
    if (rule.matches(parsed)) return rule.classification;
  }
  const key = hostKey(tab.url, settings.strategy);
  return key === null ? null : { title: key, color: colorFor(key) };
}
