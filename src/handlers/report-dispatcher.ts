// Bedrock Flow Lambda-node that terminates the flow: it receives the synthesized
// cross-source Report, emails it via SES, and publishes alert-worthy issues to SNS.
//
// Flow Lambda nodes pass the configured node input as the event payload. The exact
// envelope varies (raw object, {report}, or an `inputs[]` array of {value}), and the
// model's JSON can be a string, so we extract + normalize defensively.
import type { Issue, Report, Severity, SourceKind } from "../lib/types.js";
import { coerceSeverity, atOrAbove, highestSeverity } from "../lib/severity.js";
import { renderHtml, renderText, renderAlertText } from "../lib/report.js";
import { sendEmail } from "../lib/ses.js";
import { publishAlert } from "../lib/sns.js";
import { logger } from "../lib/logger.js";

const SENDER = process.env.REPORT_SENDER ?? "";
const RECIPIENTS = (process.env.REPORT_RECIPIENTS ?? "")
  .split(/[,\n]/)
  .map((s) => s.trim())
  .filter(Boolean);
const ALERT_TOPIC_ARN = process.env.ALERT_TOPIC_ARN ?? "";
const ALERT_THRESHOLD = coerceSeverity(process.env.ALERT_THRESHOLD ?? "high");

export async function handler(event: unknown) {
  const report = normalizeReport(extractReport(event));
  logger.info("report-dispatcher invoked", {
    overallSeverity: report.overallSeverity,
    issueCount: report.issues.length,
  });

  const alertIssues = report.issues.filter((i) => atOrAbove(i.severity, ALERT_THRESHOLD));

  const tasks: Array<Promise<unknown>> = [];

  if (SENDER && RECIPIENTS.length > 0) {
    const subject = `[${report.overallSeverity.toUpperCase()}] Log Analysis Report — ${report.issues.length} issue(s)`;
    tasks.push(
      sendEmail({
        sender: SENDER,
        recipients: RECIPIENTS,
        subject,
        html: renderHtml(report),
        text: renderText(report),
      }).then(() => logger.info("report email sent", { recipients: RECIPIENTS.length })),
    );
  } else {
    logger.warn("SES not configured (REPORT_SENDER/REPORT_RECIPIENTS); skipping email");
  }

  if (ALERT_TOPIC_ARN && alertIssues.length > 0) {
    tasks.push(
      publishAlert({
        topicArn: ALERT_TOPIC_ARN,
        subject: `[${report.overallSeverity.toUpperCase()}] ${alertIssues.length} alert(s)`,
        message: renderAlertText(report, alertIssues),
        attributes: { severity: report.overallSeverity, alertCount: String(alertIssues.length) },
      }).then(() => logger.info("alert published", { alertCount: alertIssues.length })),
    );
  }

  const results = await Promise.allSettled(tasks);
  const failures = results.filter((r) => r.status === "rejected");
  for (const f of failures) {
    if (f.status === "rejected") logger.error("dispatch task failed", { reason: String(f.reason) });
  }

  // Returned value becomes the flow output.
  return {
    dispatched: true,
    overallSeverity: report.overallSeverity,
    issueCount: report.issues.length,
    alertCount: alertIssues.length,
    emailSent: SENDER !== "" && RECIPIENTS.length > 0,
    failures: failures.length,
  };
}

// ---------------------------------------------------------------------------

/**
 * Pull the Report out of whatever envelope the Bedrock Flow Lambda node delivers.
 * Observed shape: { messageVersion, node: { name, inputs: [{ name, value }] }, flow }
 * where `value` is `{ document: "<JSON string of the Report>" }` (the synthesis
 * prompt node wraps its text output in `document`). We also tolerate direct invokes
 * and action-group-style envelopes. Every candidate is `resolve()`d — strings are
 * JSON-parsed and `{document}` wrappers unwrapped, recursively — until we find an
 * object with an `issues` array.
 */
function extractReport(event: unknown): unknown {
  const candidates: unknown[] = [event];
  if (event && typeof event === "object") {
    const e = event as Record<string, unknown>;
    const node = e.node as Record<string, unknown> | undefined;
    // Flow Lambda node: inputs live under event.node.inputs (or, defensively, top-level).
    for (const arr of [node?.inputs, e.inputs]) {
      if (Array.isArray(arr)) {
        for (const item of arr) candidates.push((item as Record<string, unknown>)?.value);
      }
    }
    candidates.push(e.report, e.input, e.body, e.payload);
  }
  for (const c of candidates) {
    const r = resolve(c);
    if (isReportLike(r)) return r;
  }
  // Diagnostic only on failure to locate a report-shaped payload.
  logger.warn("report-dispatcher could not extract a report from the event", {
    raw: JSON.stringify(event ?? null).slice(0, 2000),
  });
  return {};
}

/** Recursively unwrap strings (JSON.parse) and `{document}` wrappers to a plain value. */
function resolve(v: unknown, depth = 0): unknown {
  if (depth > 6 || v == null) return v;
  if (typeof v === "string") {
    const parsed = safeParse(v);
    return parsed === undefined ? v : resolve(parsed, depth + 1);
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (isReportLike(o)) return o;
    if ("document" in o) return resolve(o.document, depth + 1);
  }
  return v;
}

// Plain boolean (not a type predicate): a predicate of the same type as the input
// would narrow the negative branch to `never` and break the fall-through logic.
function isReportLike(v: unknown): boolean {
  return !!v && typeof v === "object" && Array.isArray((v as Record<string, unknown>).issues);
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** Coerce arbitrary model output into a valid, fully-populated Report. */
function normalizeReport(raw: unknown): Report {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const issues = Array.isArray(r.issues) ? r.issues.map(normalizeIssue) : [];
  const windowMinutes = Number(r.windowMinutes) || 60;

  const overallSeverity: Severity =
    typeof r.overallSeverity === "string" && r.overallSeverity
      ? coerceSeverity(r.overallSeverity)
      : highestSeverity(issues.map((i) => i.severity));

  // Sort issues most-severe first for both email and alert rendering.
  issues.sort((a, b) => severityRankDesc(a.severity, b.severity));

  const bySource = new Map<SourceKind, number>();
  for (const i of issues) bySource.set(i.source, (bySource.get(i.source) ?? 0) + 1);
  const sourceStatus = Array.isArray(r.sourceStatus)
    ? (r.sourceStatus as Array<Record<string, unknown>>).map((s) => ({
        source: (s.source as SourceKind) ?? "generic",
        healthy: s.healthy !== false,
        issueCount: Number(s.issueCount) || bySource.get(s.source as SourceKind) || 0,
      }))
    : [...bySource.entries()].map(([source, issueCount]) => ({ source, healthy: true, issueCount }));

  return {
    generatedAt: typeof r.generatedAt === "string" ? r.generatedAt : new Date().toISOString(),
    windowMinutes,
    overallSeverity,
    executiveSummary:
      typeof r.executiveSummary === "string" && r.executiveSummary
        ? r.executiveSummary
        : "No executive summary was produced.",
    issues,
    sourceStatus,
  };
}

function normalizeIssue(raw: unknown, idx: number): Issue {
  const i = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const source = (["cloudwatch", "splunk", "generic", "email-alert"] as const).includes(
    i.source as SourceKind,
  )
    ? (i.source as SourceKind)
    : "generic";
  return {
    id: typeof i.id === "string" && i.id ? i.id : `issue-${idx}`,
    source,
    severity: coerceSeverity(i.severity),
    title: String(i.title ?? "Untitled issue"),
    description: String(i.description ?? ""),
    evidence: toStringArray(i.evidence),
    affectedResources: toStringArray(i.affectedResources),
    occurrences: Number.isFinite(Number(i.occurrences)) ? Number(i.occurrences) : undefined,
    recommendation: String(i.recommendation ?? "Investigate further."),
    firstSeen: typeof i.firstSeen === "string" ? i.firstSeen : undefined,
  };
}

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string" && v) return [v];
  return [];
}

function severityRankDesc(a: Severity, b: Severity): number {
  const order: Severity[] = ["info", "low", "medium", "high", "critical"];
  return order.indexOf(b) - order.indexOf(a);
}
