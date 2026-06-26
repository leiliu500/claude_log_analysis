// Action-group Lambda for the Splunk analyzer agent.
// Op: runSearch — execute an SPL search over a time window via the Splunk REST API.
import {
  collectInputs,
  getNumber,
  getString,
  buildResponse,
  buildError,
  type ActionGroupEvent,
} from "../lib/bedrock.js";
import { runSplunkSearch } from "../lib/splunk.js";
import { logger } from "../lib/logger.js";

const SPLUNK_SECRET_ARN = process.env.SPLUNK_SECRET_ARN ?? "";

// Default search surfaces error-level events grouped by source/host when the agent
// supplies none.
const DEFAULT_SEARCH =
  process.env.DEFAULT_SPLUNK_SEARCH ??
  'search (error OR exception OR fatal OR critical) | stats count by host, source, sourcetype | sort -count | head 50';

export async function handler(event: ActionGroupEvent) {
  const inputs = collectInputs(event);
  logger.info("splunk-analyzer invoked", { apiPath: event.apiPath });

  if (!SPLUNK_SECRET_ARN) {
    return buildError(event, "SPLUNK_SECRET_ARN env is not configured.");
  }

  try {
    const search = getString(inputs, "search", DEFAULT_SEARCH)!;
    const windowMinutes = getNumber(inputs, "windowMinutes", 60);
    const maxCount = getNumber(inputs, "maxCount", 200);

    const result = await runSplunkSearch({
      secretId: SPLUNK_SECRET_ARN,
      search,
      earliest: `-${windowMinutes}m`,
      latest: "now",
      maxCount,
    });

    return buildResponse(event, {
      search,
      windowMinutes,
      resultCount: result.resultCount,
      rows: result.rows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("splunk-analyzer failed", { message });
    return buildError(event, `Splunk search failed: ${message}`);
  }
}
