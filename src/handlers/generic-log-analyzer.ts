// Action-group Lambda for the generic-log analyzer agent.
// Ops:
//   listLogObjects  — list recent log objects under a prefix in the log bucket.
//   readLogObject   — read one object's text content for the agent to analyze.
import {
  collectInputs,
  getNumber,
  getString,
  buildResponse,
  buildError,
  type ActionGroupEvent,
} from "../lib/bedrock.js";
import { listObjects, getObjectText } from "../lib/s3.js";
import { logger } from "../lib/logger.js";

const BUCKET = process.env.GENERIC_LOG_BUCKET ?? "";

export async function handler(event: ActionGroupEvent) {
  const inputs = collectInputs(event);
  logger.info("generic-log-analyzer invoked", { apiPath: event.apiPath });

  if (!BUCKET) return buildError(event, "GENERIC_LOG_BUCKET env is not configured.");

  try {
    if (event.apiPath.includes("read")) {
      const key = getString(inputs, "key");
      if (!key) return buildError(event, "Missing required 'key'.");
      const text = await getObjectText(BUCKET, key);
      return buildResponse(event, { bucket: BUCKET, key, contentLength: text.length, content: text });
    }

    // default / list path
    const prefix = getString(inputs, "prefix", "") ?? "";
    const max = getNumber(inputs, "max", 25);
    const objects = await listObjects(BUCKET, prefix, max);
    return buildResponse(event, {
      bucket: BUCKET,
      prefix,
      objectCount: objects.length,
      objects: objects.map((o) => ({
        key: o.key,
        lastModified: o.lastModified?.toISOString() ?? null,
        size: o.size ?? null,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("generic-log-analyzer failed", { message });
    return buildError(event, `Generic log access failed: ${message}`);
  }
}
