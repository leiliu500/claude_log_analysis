data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
data "aws_partition" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.region
  partition  = data.aws_partition.current.partition
  prefix     = var.name_prefix

  # Stable flow + alias names the trigger resolves at runtime (the trigger Lambda
  # can't take a hard dependency on the flow resource without forming a cycle, since
  # the flow itself depends on every analyzer Lambda via the agent aliases).
  flow_name       = "${local.prefix}-log-analysis"
  flow_alias_name = "live"

  # The model ARN form Bedrock agents/flows expect for a foundation model or
  # inference profile. Inference-profile IDs (geo-prefixed: us-gov./us./eu./apac.)
  # resolve to an inference-profile ARN; bare model IDs resolve to a foundation-model
  # ARN. us-gov is listed first so it wins the alternation for GovCloud profiles.
  is_inference_profile = can(regex("^(us-gov|us|eu|apac)\\.", var.foundation_model))
  model_arn = local.is_inference_profile ? (
    "arn:${local.partition}:bedrock:${local.region}:${local.account_id}:inference-profile/${var.foundation_model}"
    ) : (
    "arn:${local.partition}:bedrock:${local.region}::foundation-model/${var.foundation_model}"
  )

  # Foundation-model ARNs across all regions that an inference profile may route to,
  # for IAM. We grant the umbrella resource for simplicity; tighten per-region if
  # your security posture requires it.
  model_invoke_resources = [
    "arn:${local.partition}:bedrock:*::foundation-model/*",
    "arn:${local.partition}:bedrock:*:${local.account_id}:inference-profile/*",
  ]

  # Read prompt files once.
  prompts = {
    cloudwatch  = file("${path.module}/../prompts/cloudwatch-agent.md")
    splunk      = file("${path.module}/../prompts/splunk-agent.md")
    generic     = file("${path.module}/../prompts/generic-agent.md")
    email_alert = file("${path.module}/../prompts/email-alert-agent.md")
    synthesis   = file("${path.module}/../prompts/orchestrator-synthesis.md")
  }

  schemas = {
    cloudwatch  = file("${path.module}/../schemas/cloudwatch.json")
    splunk      = file("${path.module}/../schemas/splunk.json")
    generic     = file("${path.module}/../schemas/generic.json")
    email_alert = file("${path.module}/../schemas/email-alert.json")
  }
}
