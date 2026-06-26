output "agent_ids" {
  description = "Map of source -> Bedrock agent id."
  value       = { for k, a in aws_bedrockagent_agent.this : k => a.agent_id }
}

output "agent_alias_arns" {
  description = "Map of source -> Bedrock agent alias ARN (used by the flow)."
  value       = { for k, a in aws_bedrockagent_agent_alias.this : k => a.agent_alias_arn }
}

output "flow_id" {
  description = "Bedrock Flow id (empty when enable_flow = false)."
  value       = var.enable_flow ? aws_bedrockagent_flow.main[0].id : ""
}

output "flow_alias_name" {
  description = "Bedrock Flow alias name the trigger resolves at runtime."
  value       = var.enable_flow ? local.flow_alias_name : ""
}

output "alert_topic_arn" {
  description = "SNS topic ARN for high-severity alerts."
  value       = aws_sns_topic.alerts.arn
}

output "generic_log_bucket" {
  description = "Bucket the generic-log agent reads from."
  value       = aws_s3_bucket.generic_logs.id
}

output "alert_email_bucket" {
  description = "Bucket the email-alert agent reads from."
  value       = aws_s3_bucket.alert_emails.id
}

output "lambda_function_names" {
  description = "Deployed Lambda function names."
  value       = { for k, f in aws_lambda_function.fn : k => f.function_name }
}

output "flow_trigger_function_name" {
  description = "Name of the Lambda you can invoke to run the flow on demand."
  value       = aws_lambda_function.fn["flow-trigger"].function_name
}
