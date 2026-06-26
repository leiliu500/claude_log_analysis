// Splunk REST API client. Runs a blocking search job and returns result rows as
// JSON. Credentials come from Secrets Manager (a JSON secret with `host` + `token`).
import { getJsonSecret } from "./secrets.js";

interface SplunkCreds {
  /** e.g. https://splunk.example.com:8089 */
  host: string;
  /** Splunk authentication (HEC-style) bearer token. */
  token: string;
}

export interface SplunkSearchResult {
  rows: Array<Record<string, unknown>>;
  resultCount: number;
}

/**
 * Run an SPL search as a oneshot/blocking job via the REST API and return parsed
 * JSON rows. `earliest`/`latest` accept Splunk relative-time syntax (e.g. "-60m").
 */
export async function runSplunkSearch(opts: {
  secretId: string;
  search: string;
  earliest: string;
  latest: string;
  maxCount?: number;
  timeoutMs?: number;
}): Promise<SplunkSearchResult> {
  const { host, token } = await getJsonSecret<SplunkCreds>(opts.secretId);
  const base = host.replace(/\/+$/, "");

  // SPL must begin with `search` (or another generating command); enforce it.
  const spl = /^\s*(search|tstats|\|)/i.test(opts.search)
    ? opts.search
    : `search ${opts.search}`;

  const body = new URLSearchParams({
    search: spl,
    earliest_time: opts.earliest,
    latest_time: opts.latest,
    output_mode: "json",
    exec_mode: "oneshot",
    count: String(opts.maxCount ?? 200),
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 50_000);
  try {
    const res = await fetch(`${base}/services/search/jobs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Splunk search failed: HTTP ${res.status} ${text.slice(0, 500)}`);
    }
    const json = (await res.json()) as { results?: Array<Record<string, unknown>> };
    const rows = json.results ?? [];
    return { rows, resultCount: rows.length };
  } finally {
    clearTimeout(timer);
  }
}
