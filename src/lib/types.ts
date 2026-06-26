// Shared data contracts for the whole system. The analyzer Lambdas, the synthesis
// prompt's expected output, and the report dispatcher all agree on these shapes.

/** Normalized severity used across every source. Ordered low -> high. */
export const SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** A single issue discovered in one source. */
export interface Issue {
  /** Stable-ish identifier for dedupe (source + fingerprint of the title). */
  id: string;
  source: SourceKind;
  severity: Severity;
  title: string;
  /** Short human-readable description of what was observed. */
  description: string;
  /** Raw supporting evidence (log lines, counts, sample messages). */
  evidence: string[];
  /** Resources implicated: log groups, hosts, services, ARNs. */
  affectedResources: string[];
  /** Number of occurrences observed in the window, if countable. */
  occurrences?: number;
  /** Suggested remediation or next investigative step. */
  recommendation: string;
  /** ISO-8601 time the issue was first seen in the window, if known. */
  firstSeen?: string;
}

export type SourceKind = "cloudwatch" | "splunk" | "generic" | "email-alert";

/** What every analyzer agent returns for its source. */
export interface SourceFindings {
  source: SourceKind;
  /** Window analyzed, in minutes back from "now". */
  windowMinutes: number;
  /** One-paragraph summary of the source's health for the window. */
  summary: string;
  issues: Issue[];
  /** Whether the source could be queried at all (false on connectivity errors). */
  healthy: boolean;
  /** Populated when healthy === false. */
  error?: string;
}

/** The consolidated, cross-source report produced by the synthesis step. */
export interface Report {
  /** ISO-8601 generation time. */
  generatedAt: string;
  windowMinutes: number;
  /** Highest severity across all included issues. */
  overallSeverity: Severity;
  /** Executive summary correlating findings across sources. */
  executiveSummary: string;
  /** Deduped, correlated, severity-sorted issues. */
  issues: Issue[];
  /** Per-source one-line status for the report header. */
  sourceStatus: Array<{ source: SourceKind; healthy: boolean; issueCount: number }>;
}
