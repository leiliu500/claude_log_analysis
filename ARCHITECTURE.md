# Architecture

## Components

### Bedrock Agents (one per source)

Each agent owns a single source domain and exposes one **action group** backed by a
Lambda function. The agent's *instruction* prompt (in `prompts/`) tells the model how
to investigate that source and what to return; the *action group* gives it a typed
tool surface (OpenAPI schema in `schemas/`) to fetch raw telemetry.

| Agent | Action group Lambda | Reaches |
|-------|---------------------|---------|
| `cloudwatch-analyzer` | `cloudwatch-analyzer` | CloudWatch Logs Insights |
| `splunk-analyzer` | `splunk-analyzer` | Splunk REST API (`/services/search/jobs`) |
| `generic-log-analyzer` | `generic-log-analyzer` | S3 objects (any text/JSON log) |
| `email-alert-analyzer` | `email-alert-parser` | S3 bucket of inbound alert emails |

Each agent returns a **structured `SourceFindings` JSON** object (see
`src/lib/types.ts`): a list of issues with `severity`, `title`, `evidence`,
`affectedResources`, and a `recommendation`.

### Bedrock Flow (orchestration)

The flow (`src/flow/definition.ts`) wires the agents together:

```
FlowInput
  ├─► CloudWatchAgent ─┐
  ├─► SplunkAgent ──────┤
  ├─► GenericAgent ─────┼─► Synthesis (prompt node) ─► ReportDispatcher (Lambda node) ─► FlowOutput
  └─► EmailAlertAgent ──┘
```

- The four agent nodes receive the same flow input (a `window_minutes` and optional
  filters) and run concurrently.
- The **Synthesis** prompt node receives all four `SourceFindings` payloads, dedupes
  and correlates them across sources, assigns an overall incident severity, and emits
  a single consolidated `Report` object.
- The **ReportDispatcher** Lambda node renders the report to HTML, emails it via SES,
  and publishes any issue at/above the alert threshold to SNS.

> Bedrock Flows runs agent nodes in parallel automatically when they share an input
> and have no data dependency between them, which is exactly this topology.

### Dispatch & alerting

- **SES** sends the consolidated HTML report to the configured recipients.
- **SNS** receives a compact alert payload for high-severity issues; subscribe email,
  HTTPS (PagerDuty/Opsgenie), Slack-via-Lambda, etc.

### Triggers

- **EventBridge Scheduler** invokes `flow-trigger` on a cron expression; that Lambda
  calls `InvokeFlow` with the configured `window_minutes`.
- On-demand: call `InvokeFlow` directly (see README).

## Data contracts

All inter-component payloads are defined in `src/lib/types.ts`:

- `SourceFindings` — what each analyzer agent returns.
- `Issue` — a single finding with a normalized `Severity`.
- `Report` — the synthesized, cross-source incident report the dispatcher consumes.

Keeping these as a single shared module means the Lambdas, the synthesis prompt's
expected schema, and the dispatcher all agree on shape.

## Security model

- Each Lambda has a least-privilege IAM role scoped to exactly its source
  (CloudWatch Logs read, S3 read on one bucket, Secrets Manager read for Splunk, etc.).
- Bedrock agents assume a dedicated service role that may only invoke their own
  action-group Lambda and the foundation model.
- Action-group Lambdas grant `lambda:InvokeFunction` to the Bedrock principal scoped
  by `SourceAccount`/`SourceArn` (the agent ARN).
- Secrets (Splunk token) live in Secrets Manager, never in environment variables.

## Extending

To add a new source (e.g. Datadog):

1. Add `src/handlers/datadog-analyzer.ts` returning `SourceFindings`.
2. Add `schemas/datadog.json` (its action group) and `prompts/datadog-agent.md`.
3. Add the Lambda + agent + action group + alias in `infra/`.
4. Add an agent node to `src/flow/definition.ts` and wire it into Synthesis.
