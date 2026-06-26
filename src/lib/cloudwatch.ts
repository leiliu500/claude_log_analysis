// Thin wrapper over CloudWatch Logs Insights: start a query, poll to completion,
// return rows as plain objects. Used by the cloudwatch-analyzer action group.
import {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
  type QueryStatus,
} from "@aws-sdk/client-cloudwatch-logs";

const client = new CloudWatchLogsClient({});

export interface InsightsQuery {
  logGroupNames: string[];
  queryString: string;
  startTimeMs: number;
  endTimeMs: number;
  limit?: number;
}

export interface InsightsResult {
  status: QueryStatus | string;
  /** Each row is a field->value map (the `@ptr`/`@timestamp` system fields included). */
  rows: Array<Record<string, string>>;
  recordsMatched?: number;
}

const TERMINAL: ReadonlyArray<string> = ["Complete", "Failed", "Cancelled", "Timeout"];

/** Run an Insights query and poll until it finishes (or the deadline elapses). */
export async function runInsightsQuery(
  q: InsightsQuery,
  pollTimeoutMs = 50_000,
): Promise<InsightsResult> {
  const start = await client.send(
    new StartQueryCommand({
      logGroupNames: q.logGroupNames,
      queryString: q.queryString,
      startTime: Math.floor(q.startTimeMs / 1000),
      endTime: Math.floor(q.endTimeMs / 1000),
      limit: q.limit ?? 100,
    }),
  );
  const queryId = start.queryId;
  if (!queryId) throw new Error("CloudWatch StartQuery returned no queryId");

  const deadline = Date.now() + pollTimeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    // Backoff: 500ms, 1s, then steady 1.5s.
    await sleep(attempt === 0 ? 500 : attempt === 1 ? 1000 : 1500);
    attempt++;
    const res = await client.send(new GetQueryResultsCommand({ queryId }));
    const status = res.status ?? "Unknown";
    if (TERMINAL.includes(status)) {
      const rows = (res.results ?? []).map((row) => {
        const obj: Record<string, string> = {};
        for (const field of row) if (field.field) obj[field.field] = field.value ?? "";
        return obj;
      });
      return { status, rows, recordsMatched: res.statistics?.recordsMatched };
    }
  }
  return { status: "Timeout", rows: [] };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
