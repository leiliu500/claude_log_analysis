// Action-group Lambda for the email-alert analyzer agent.
// Inbound alert emails are delivered to an S3 bucket by an SES receipt rule.
// Ops:
//   listAlertEmails — list recent alert-email objects.
//   readAlertEmail  — fetch + parse one email into {from, subject, date, body}.
import {
  collectInputs,
  getNumber,
  getString,
  buildResponse,
  buildError,
  type ActionGroupEvent,
} from "../lib/bedrock.js";
import { listObjects, getObjectText } from "../lib/s3.js";
import { parseEmail } from "../lib/email.js";
import { logger } from "../lib/logger.js";

const BUCKET = process.env.EMAIL_BUCKET ?? "";
const PREFIX = process.env.EMAIL_PREFIX ?? "";

export async function handler(event: ActionGroupEvent) {
  const inputs = collectInputs(event);
  logger.info("email-alert-parser invoked", { apiPath: event.apiPath });

  if (!BUCKET) return buildError(event, "EMAIL_BUCKET env is not configured.");

  try {
    if (event.apiPath.includes("read")) {
      const key = getString(inputs, "key");
      if (!key) return buildError(event, "Missing required 'key'.");
      const raw = await getObjectText(BUCKET, key, 1024 * 1024);
      const parsed = parseEmail(raw);
      return buildResponse(event, { bucket: BUCKET, key, ...parsed });
    }

    const max = getNumber(inputs, "max", 25);
    const objects = await listObjects(BUCKET, PREFIX, max);
    return buildResponse(event, {
      bucket: BUCKET,
      prefix: PREFIX,
      emailCount: objects.length,
      emails: objects.map((o) => ({
        key: o.key,
        receivedAt: o.lastModified?.toISOString() ?? null,
        size: o.size ?? null,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("email-alert-parser failed", { message });
    return buildError(event, `Email alert access failed: ${message}`);
  }
}
