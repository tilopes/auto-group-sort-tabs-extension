import { twoLabelSuffixes } from "./suffixes.generated.ts";

/**
 * Registrable domain (eTLD+1) of a DNS hostname, e.g. `a.b.example.co.uk` → `example.co.uk`.
 * Only two-label ICANN suffixes are known, see scripts/gen-suffixes.ts.
 */
export function registrableDomain(hostname: string): string {
  const labels = hostname.split(".");
  if (labels.length <= 2) return hostname;
  const lastTwo = labels.slice(-2).join(".");
  return twoLabelSuffixes.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}
