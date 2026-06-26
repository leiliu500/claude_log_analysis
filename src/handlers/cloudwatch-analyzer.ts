// Action-group Lambda for the CloudWatch analyzer agent.
// Op: runInsightsQuery — execute a Logs Insights query over the given log groups and
// time window, returning rows for the agent to interpret into SourceFindings.
import {
  collectInputs,
  getNumber,
  getString,
  buildResponse,
  buildError,
  type ActionGroupEvent,
} from "../lib/bedrock.js";
import { runInsightsQuery } from "../lib/cloudwatch.js";
import { logger } from "../lib/logger.js";

// Default query: count errors/exceptions per log stream when the agent doesn't
// supply its own. Insights syntax.
const DEFAULT_QUERY = `
fields @timestamp, @logStream, @message
| filter @message like /(?i)(error|exception|fatal|panic|traceback|timeout|5\\d\\d )/
| stats count(*) as occurrences by @logStream
| sort occurrences desc
| limit 50`.trim();

/** Comma- or newline-separated env default of log groups to scan. */
const DEFAULT_LOG_GROUPS = (process.env.DEFAULT_LOG_GROUPS ?? "")
  .split(/[,\n]/)
  .map((s) => s.trim())
  .filter(Boolean);

export async function handler(event: ActionGroupEvent) {
  const inputs = collectInputs(event);
  logger.info("cloudwatch-analyzer invoked", { apiPath: event.apiPath, inputs });

  try {
    const logGroupsRaw = getString(inputs, "logGroupNames");
    const logGroupNames = logGroupsRaw
      ? logGroupsRaw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
      : DEFAULT_LOG_GROUPS;

    if (logGroupNames.length === 0) {
      return buildError(
        event,
        "No log groups provided and DEFAULT_LOG_GROUPS env is empty.",
      );
    }

    const windowMinutes = getNumber(inputs, "windowMinutes", 60);
    const limit = getNumber(inputs, "limit", 100);
    const queryString = getString(inputs, "queryString", DEFAULT_QUERY)!;
    const endTimeMs = Date.now();
    const startTimeMs = endTimeMs - windowMinutes * 60_000;

    const result = await runInsightsQuery({
      logGroupNames,
      queryString,
      startTimeMs,
      endTimeMs,
      limit,
    });

    return buildResponse(event, {
      logGroupNames,
      windowMinutes,
      query: queryString,
      status: result.status,
      recordsMatched: result.recordsMatched ?? null,
      rowCount: result.rows.length,
      rows: result.rows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("cloudwatch-analyzer failed", { message });
    return buildError(event, `CloudWatch query failed: ${message}`);
  }
}
