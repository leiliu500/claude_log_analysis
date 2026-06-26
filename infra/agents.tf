# ---------------------------------------------------------------------------
# One Bedrock Agent per source, each with a single OpenAPI action group backed by
# its analyzer Lambda, plus a stable alias the flow points at.
# ---------------------------------------------------------------------------
locals {
  agents = {
    cloudwatch = {
      display           = "CloudWatch"
      instruction       = local.prompts.cloudwatch
      schema            = local.schemas.cloudwatch
      lambda_key        = "cloudwatch-analyzer"
      action_group_name = "CloudWatchTools"
    }
    splunk = {
      display           = "Splunk"
      instruction       = local.prompts.splunk
      schema            = local.schemas.splunk
      lambda_key        = "splunk-analyzer"
      action_group_name = "SplunkTools"
    }
    generic = {
      display           = "GenericLog"
      instruction       = local.prompts.generic
      schema            = local.schemas.generic
      lambda_key        = "generic-log-analyzer"
      action_group_name = "GenericLogTools"
    }
    email_alert = {
      display           = "EmailAlert"
      instruction       = local.prompts.email_alert
      schema            = local.schemas.email_alert
      lambda_key        = "email-alert-parser"
      action_group_name = "EmailAlertTools"
    }
  }
}

resource "aws_bedrockagent_agent" "this" {
  for_each = local.agents

  agent_name                  = "${local.prefix}-${each.value.display}"
  agent_resource_role_arn     = aws_iam_role.agent.arn
  foundation_model            = var.foundation_model
  instruction                 = each.value.instruction
  idle_session_ttl_in_seconds = 600

  # Re-prepare the DRAFT version whenever instruction/model changes.
  prepare_agent = true
}

resource "aws_bedrockagent_agent_action_group" "this" {
  for_each = local.agents

  agent_id                   = aws_bedrockagent_agent.this[each.key].agent_id
  agent_version              = "DRAFT"
  action_group_name          = each.value.action_group_name
  skip_resource_in_use_check = true

  action_group_executor {
    lambda = aws_lambda_function.fn[each.value.lambda_key].arn
  }

  api_schema {
    payload = each.value.schema
  }

  depends_on = [aws_lambda_permission.bedrock_agent_invoke]
}

# A versioned alias per agent. Creating/updating the alias publishes a new agent
# version capturing the current action group. The flow references these aliases.
resource "aws_bedrockagent_agent_alias" "this" {
  for_each = local.agents

  agent_id         = aws_bedrockagent_agent.this[each.key].agent_id
  agent_alias_name = "live"

  depends_on = [aws_bedrockagent_agent_action_group.this]
}
