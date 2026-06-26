import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHtml, renderText, renderAlertText } from "../src/lib/report.ts";
import type { Report } from "../src/lib/types.ts";

const sample: Report = {
  generatedAt: "2026-06-25T12:00:00Z",
  windowMinutes: 60,
  overallSeverity: "high",
  executiveSummary: "Elevated 5xx errors on the checkout service.",
  issues: [
    {
      id: "cw-5xx",
      source: "cloudwatch",
      severity: "high",
      title: "5xx spike on checkout",
      description: "HTTP 503s rose sharply.",
      evidence: ["count=412 in 10m", "<html> & \"quoted\""],
      affectedResources: ["/aws/lambda/checkout"],
      occurrences: 412,
      recommendation: "Check downstream dependency latency.",
    },
  ],
  sourceStatus: [
    { source: "cloudwatch", healthy: true, issueCount: 1 },
    { source: "splunk", healthy: false, issueCount: 0 },
  ],
};

test("renderHtml escapes evidence and includes the title", () => {
  const html = renderHtml(sample);
  assert.match(html, /5xx spike on checkout/);
  assert.match(html, /&lt;html&gt;/); // escaped
  assert.doesNotMatch(html, /<html> &/); // raw injected markup must not survive
});

test("renderText includes severity and recommendation", () => {
  const text = renderText(sample);
  assert.match(text, /\[HIGH\] 5xx spike on checkout/);
  assert.match(text, /Recommendation: Check downstream/);
});

test("renderAlertText lists only the supplied issues", () => {
  const text = renderAlertText(sample, sample.issues);
  assert.match(text, /1 alert-worthy issue/);
  assert.match(text, /checkout/);
});
