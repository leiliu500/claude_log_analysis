variable "aws_region" {
  description = "AWS region to deploy into. Must have Bedrock + the chosen model enabled."
  type        = string
  default     = "us-gov-west-1" # AWS GovCloud (US-West)
}

variable "name_prefix" {
  description = "Prefix for all resource names."
  type        = string
  default     = "logai"
}

variable "foundation_model" {
  description = <<-EOT
    Bedrock model ID or cross-region inference profile ID used by every agent and the
    synthesis prompt. Must be enabled in your account/region (Bedrock console -> Model
    access) AND supported by Bedrock Agents/Flows. Bare model IDs (e.g.
    'openai.gpt-oss-120b-1:0', 'anthropic.claude-...') resolve to a foundation-model
    ARN; geo-prefixed inference-profile IDs ('us-gov.'/'us.'/'eu.'/'apac.') resolve to
    an inference-profile ARN. In GovCloud the inference-profile prefix is 'us-gov.'.
    List what's available with:
      aws bedrock list-foundation-models --region us-gov-west-1 \
        --query "modelSummaries[].modelId"
      aws bedrock list-inference-profiles --region us-gov-west-1 \
        --query "inferenceProfileSummaries[].inferenceProfileId"
  EOT
  type        = string
  default     = "openai.gpt-oss-120b-1:0"
}

variable "report_sender" {
  description = "SES-verified 'From' address for report emails."
  type        = string
}

variable "report_recipients" {
  description = "Recipients for the consolidated report email."
  type        = list(string)
}

variable "alert_threshold" {
  description = "Minimum severity that triggers an SNS alert (info|low|medium|high|critical)."
  type        = string
  default     = "high"

  validation {
    condition     = contains(["info", "low", "medium", "high", "critical"], var.alert_threshold)
    error_message = "alert_threshold must be one of: info, low, medium, high, critical."
  }
}

variable "alert_email_subscriptions" {
  description = "Email addresses to subscribe to the SNS alert topic (each must confirm)."
  type        = list(string)
  default     = []
}

variable "default_log_groups" {
  description = "CloudWatch log groups the CloudWatch agent scans when none are specified."
  type        = list(string)
  default     = []
}

variable "splunk_secret_arn" {
  description = <<-EOT
    ARN of a Secrets Manager secret holding Splunk creds as JSON {\"host\":\"...\",\"token\":\"...\"}.
    Leave empty to deploy without Splunk (the Splunk Lambda will report itself unhealthy).
  EOT
  type        = string
  default     = ""
}

variable "schedule_expression" {
  description = "EventBridge schedule for periodic runs (rate() or cron())."
  type        = string
  default     = "rate(1 hour)"
}

variable "window_minutes" {
  description = "Default look-back window for scheduled runs."
  type        = number
  default     = 60
}

variable "enable_schedule" {
  description = "Whether to create the EventBridge schedule that triggers the flow."
  type        = bool
  default     = true
}

variable "enable_flow" {
  description = <<-EOT
    Whether to create the Bedrock Flow and publish its "live" alias (the alias is
    published by scripts/publish-flow.mjs at apply time). Set false to deploy the
    agents/Lambdas only — the analyzer agents remain individually invocable.
  EOT
  type        = bool
  default     = true
}

variable "log_retention_days" {
  description = "CloudWatch log retention for Lambda log groups."
  type        = number
  default     = 30
}

variable "enable_ses_inbound" {
  description = <<-EOT
    Create an SES inbound receipt rule that writes alert emails to the alert bucket.
    SES inbound is only available in certain regions (us-east-1, us-west-2, eu-west-1).
    Leave false and deliver alert emails to the bucket by other means if unsupported.
  EOT
  type        = bool
  default     = false
}

variable "ses_inbound_recipients" {
  description = "Recipient addresses the SES inbound rule matches (when enable_ses_inbound)."
  type        = list(string)
  default     = []
}

variable "email_prefix" {
  description = "S3 key prefix the email-alert agent lists under in the alert bucket."
  type        = string
  default     = ""
}
