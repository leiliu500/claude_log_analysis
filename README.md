# Bedrock Agentic Log Analysis

A production AWS **Bedrock Agentic** system that analyzes operational telemetry from
multiple sources, surfaces issues, alerts on them, and emails consolidated reports —
orchestrated by **Amazon Bedrock Flows** over a fleet of specialized **Bedrock Agents**.

## What it does

1. **Analyzes each source independently** with a purpose-built agent:
   - **CloudWatch Logs** — runs Logs Insights queries, summarizes errors/anomalies.
   - **Splunk** — runs SPL search jobs via the Splunk REST API.
   - **Generic logs** — pulls arbitrary log files/objects from S3 and analyzes them.
   - **Email alerts** — parses inbound alert emails (delivered to S3 via SES receipt).
2. **Orchestrates findings** in a Bedrock Flow: the four analyzer agents run in
   parallel, then a synthesis step correlates findings into one prioritized report.
3. **Alerts on potential issues** — anything at or above a configurable severity
   threshold is pushed to an SNS topic (PagerDuty/Slack/email subscribers).
4. **Emails the report** — a rich HTML report is sent via Amazon SES.
5. Runs on a schedule (EventBridge) and/or on demand (`InvokeFlow`).

## Architecture at a glance

```
                          ┌──────────────── Bedrock Flow ─────────────────┐
EventBridge (cron)        │                                                │
  │                       │   ┌─ Agent: CloudWatch ─┐                      │
  └─► flow-trigger Lambda ─►──┼─ Agent: Splunk ─────┼─► Synthesis prompt ──┼─► report-dispatcher Lambda
        (InvokeFlow)      │   ├─ Agent: Generic logs┤   (correlate +       │      ├─ SES   (HTML report email)
                          │   └─ Agent: Email alerts┘    prioritize)       │      └─ SNS   (alerts ≥ threshold)
                          └────────────────────────────────────────────────┘
       each Agent ──► OpenAPI action group ──► Lambda ──► CloudWatch Logs / Splunk REST / S3
```

Full detail in [ARCHITECTURE.md](ARCHITECTURE.md).

## Repository layout

| Path | Purpose |
|------|---------|
| `src/handlers/` | Lambda entry points — one per agent action group plus dispatch & flow trigger |
| `src/lib/` | Shared code: Bedrock action-group event parsing, source clients, severity, SES/SNS |
| `src/flow/` | Programmatic Bedrock Flow definition (consumed by Terraform) |
| `schemas/` | OpenAPI 3 schemas describing each agent's action group |
| `prompts/` | Agent instruction prompts + the synthesis prompt |
| `infra/` | Terraform: agents, action groups, aliases, flow, Lambdas, IAM, SES, SNS, EventBridge, S3 |
| `scripts/` | Convenience deploy script |

## Prerequisites

- An AWS account with **Amazon Bedrock model access enabled** for the chosen Claude
  model in your region (Bedrock console → *Model access*).
- Terraform ≥ 1.6 and Node.js ≥ 20.
- A domain/email verified in **Amazon SES** (and SES production access if you send to
  unverified recipients).
- (Optional) A reachable Splunk instance with a REST token, stored in Secrets Manager.

## Quick start

```bash
npm install
npm run build                 # bundle Lambda handlers into dist/
cp infra/terraform.tfvars.example infra/terraform.tfvars   # then edit
npm run tf:init
npm run tf:plan               # review
npm run deploy                # build + terraform apply
```

After apply, trigger an on-demand run via the trigger Lambda (it resolves the flow +
alias by name and drains the run to completion):

```bash
aws lambda invoke \
  --function-name "$(terraform -chdir=infra output -raw flow_trigger_function_name)" \
  --payload '{"windowMinutes":60}' \
  --cli-binary-format raw-in-base64-out /dev/stdout
```

## Model selection

The foundation model is the Terraform variable `foundation_model`. It must be a
Bedrock model ID or **cross-region inference profile ID** that is *enabled in your
account/region* and *supported by Bedrock Agents/Flows*. Bare model IDs (e.g.
`openai.gpt-oss-120b-1:0`, `anthropic.claude-...`) resolve to a foundation-model ARN;
geo-prefixed inference-profile IDs add a prefix — `us-gov.` in **GovCloud**, otherwise
`us.` / `eu.` / `apac.`. The Terraform config detects which form you gave and builds
the right ARN (partition-aware, so `aws-us-gov` is handled). Verify the exact ID with:

```bash
aws bedrock list-foundation-models  --region us-gov-west-1 --query "modelSummaries[].modelId"
aws bedrock list-inference-profiles --region us-gov-west-1 --query "inferenceProfileSummaries[].inferenceProfileId"
```

> **GovCloud note:** Bedrock model availability and Bedrock Agents/Flows support
> differ from commercial regions — confirm your chosen `foundation_model` is offered
> by **Bedrock Agents** in `us-gov-west-1` before applying.

## Cost & safety notes

- Each scheduled run invokes 4 agents + 1 synthesis step; tune the EventBridge rate.
- Log-source queries are time-boxed (`window_minutes`) and result-capped to bound cost.
- The report-dispatcher only emails/alerts; it never mutates source systems.
