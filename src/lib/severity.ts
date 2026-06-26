import { SEVERITIES, type Severity } from "./types.js";

/** Numeric rank for comparisons; higher = more severe. */
export function severityRank(s: Severity): number {
  return SEVERITIES.indexOf(s);
}

/** Returns the more severe of two severities. */
export function maxSeverity(a: Severity, b: Severity): Severity {
  return severityRank(a) >= severityRank(b) ? a : b;
}

/** Highest severity across a list of severities; defaults to "info" when empty. */
export function highestSeverity(values: Severity[]): Severity {
  return values.reduce<Severity>((acc, v) => maxSeverity(acc, v), "info");
}

/** True when `s` meets or exceeds `threshold`. */
export function atOrAbove(s: Severity, threshold: Severity): boolean {
  return severityRank(s) >= severityRank(threshold);
}

/** Coerce arbitrary model output into a valid Severity, defaulting to "low". */
export function coerceSeverity(value: unknown): Severity {
  const v = String(value ?? "").toLowerCase().trim();
  return (SEVERITIES as readonly string[]).includes(v) ? (v as Severity) : "low";
}
