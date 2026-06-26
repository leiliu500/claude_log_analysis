// Very small RFC-822/MIME extractor — enough to pull subject, from, date, and a
// best-effort plain-text body out of an alert email stored in S3. We intentionally
// avoid a heavy MIME dependency; the analyzer agent tolerates rough bodies.

export interface ParsedEmail {
  from: string;
  subject: string;
  date: string;
  /** Best-effort decoded text body (HTML stripped to text when no text part). */
  body: string;
}

export function parseEmail(raw: string): ParsedEmail {
  const normalized = raw.replace(/\r\n/g, "\n");
  const splitIdx = normalized.indexOf("\n\n");
  const headerBlock = splitIdx >= 0 ? normalized.slice(0, splitIdx) : normalized;
  const bodyBlock = splitIdx >= 0 ? normalized.slice(splitIdx + 2) : "";

  const headers = parseHeaders(headerBlock);
  const contentType = headers["content-type"] ?? "text/plain";

  let body = bodyBlock;
  const boundaryMatch = /boundary="?([^";\n]+)"?/i.exec(contentType);
  if (boundaryMatch?.[1]) {
    body = extractTextPart(bodyBlock, boundaryMatch[1]) ?? bodyBlock;
  } else if (/text\/html/i.test(contentType)) {
    body = stripHtml(bodyBlock);
  }

  return {
    from: headers["from"] ?? "",
    subject: headers["subject"] ?? "(no subject)",
    date: headers["date"] ?? "",
    body: body.trim().slice(0, 16_000),
  };
}

function parseHeaders(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Unfold continuation lines (leading whitespace) then split on first colon.
  const unfolded = block.replace(/\n[ \t]+/g, " ");
  for (const line of unfolded.split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) out[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return out;
}

function extractTextPart(body: string, boundary: string): string | undefined {
  const parts = body.split(`--${boundary}`);
  let htmlFallback: string | undefined;
  for (const part of parts) {
    const headerEnd = part.indexOf("\n\n");
    if (headerEnd < 0) continue;
    const partHeaders = part.slice(0, headerEnd).toLowerCase();
    const content = part.slice(headerEnd + 2);
    if (partHeaders.includes("text/plain")) return content.trim();
    if (partHeaders.includes("text/html")) htmlFallback = stripHtml(content);
  }
  return htmlFallback;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}
