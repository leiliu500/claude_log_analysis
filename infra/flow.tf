# ---------------------------------------------------------------------------
# Bedrock Flow: FlowInput -> 4 analyzer agents (parallel) -> Synthesis prompt
# -> ReportDispatcher Lambda -> FlowOutput. Gated by var.enable_flow.
# Requires AWS provider >= 5.83 (aws_bedrockagent_flow*).
# ---------------------------------------------------------------------------

resource "aws_bedrockagent_flow" "main" {
  count              = var.enable_flow ? 1 : 0
  name               = local.flow_name
  execution_role_arn = aws_iam_role.flow[0].arn
  description        = "Multi-source log analysis: parallel analyzer agents -> synthesis -> report dispatch."

  definition {
    # --- Input ---
    node {
      name = "FlowInput"
      type = "Input"
      output {
        name = "document"
        type = "String"
      }
    }

    # --- Analyzer agents (run in parallel) ---
    dynamic "node" {
      for_each = {
        CloudWatchAgent = aws_bedrockagent_agent_alias.this["cloudwatch"].agent_alias_arn
        SplunkAgent     = aws_bedrockagent_agent_alias.this["splunk"].agent_alias_arn
        GenericAgent    = aws_bedrockagent_agent_alias.this["generic"].agent_alias_arn
        EmailAlertAgent = aws_bedrockagent_agent_alias.this["email_alert"].agent_alias_arn
      }
      content {
        name = node.key
        type = "Agent"
        configuration {
          agent {
            agent_alias_arn = node.value
          }
        }
        input {
          name       = "agentInputText"
          type       = "String"
          expression = "$.data"
        }
        output {
          name = "agentResponse"
          type = "String"
        }
      }
    }

    # --- Synthesis (inline prompt) ---
    node {
      name = "Synthesis"
      type = "Prompt"
      configuration {
        prompt {
          source_configuration {
            inline {
              model_id      = var.foundation_model
              template_type = "TEXT"
              inference_configuration {
                text {
                  max_tokens  = 4096
                  temperature = 0
                }
              }
              template_configuration {
                text {
                  text = local.prompts.synthesis
                  input_variable { name = "cloudwatch" }
                  input_variable { name = "splunk" }
                  input_variable { name = "generic" }
                  input_variable { name = "emailAlert" }
                }
              }
            }
          }
        }
      }
      input {
        name       = "cloudwatch"
        type       = "String"
        expression = "$.data"
      }
      input {
        name       = "splunk"
        type       = "String"
        expression = "$.data"
      }
      input {
        name       = "generic"
        type       = "String"
        expression = "$.data"
      }
      input {
        name       = "emailAlert"
        type       = "String"
        expression = "$.data"
      }
      output {
        name = "modelCompletion"
        type = "String"
      }
    }

    # --- Report dispatcher (Lambda) ---
    node {
      name = "ReportDispatcher"
      type = "LambdaFunction"
      configuration {
        lambda_function {
          lambda_arn = aws_lambda_function.fn["report-dispatcher"].arn
        }
      }
      input {
        name       = "report"
        type       = "String"
        expression = "$.data"
      }
      output {
        name = "functionResponse"
        type = "Object"
      }
    }

    # --- Output ---
    node {
      name = "FlowOutput"
      type = "Output"
      input {
        name       = "document"
        type       = "Object"
        expression = "$.data"
      }
    }

    # --- Connections ---
    dynamic "connection" {
      for_each = {
        FlowInput_to_CloudWatchAgent = { source = "FlowInput", so = "document", target = "CloudWatchAgent", ti = "agentInputText" }
        FlowInput_to_SplunkAgent     = { source = "FlowInput", so = "document", target = "SplunkAgent", ti = "agentInputText" }
        FlowInput_to_GenericAgent    = { source = "FlowInput", so = "document", target = "GenericAgent", ti = "agentInputText" }
        FlowInput_to_EmailAlertAgent = { source = "FlowInput", so = "document", target = "EmailAlertAgent", ti = "agentInputText" }
        CloudWatchAgent_to_Synthesis = { source = "CloudWatchAgent", so = "agentResponse", target = "Synthesis", ti = "cloudwatch" }
        SplunkAgent_to_Synthesis     = { source = "SplunkAgent", so = "agentResponse", target = "Synthesis", ti = "splunk" }
        GenericAgent_to_Synthesis    = { source = "GenericAgent", so = "agentResponse", target = "Synthesis", ti = "generic" }
        EmailAlertAgent_to_Synthesis = { source = "EmailAlertAgent", so = "agentResponse", target = "Synthesis", ti = "emailAlert" }
        Synthesis_to_Dispatcher      = { source = "Synthesis", so = "modelCompletion", target = "ReportDispatcher", ti = "report" }
        Dispatcher_to_Output         = { source = "ReportDispatcher", so = "functionResponse", target = "FlowOutput", ti = "document" }
      }
      content {
        name   = connection.key
        source = connection.value.source
        target = connection.value.target
        type   = "Data"
        configuration {
          data {
            source_output = connection.value.so
            target_input  = connection.value.ti
          }
        }
      }
    }
  }
}

# The AWS provider (v6.x) manages the flow itself but not its versions/aliases.
# Publish a version and upsert the "live" alias via a small Node script invoked at
# apply time. It re-runs whenever the flow definition changes. The flow-trigger
# Lambda resolves the alias id by name at runtime, so we don't need to capture it.
resource "terraform_data" "publish_flow" {
  count = var.enable_flow ? 1 : 0

  triggers_replace = [
    aws_bedrockagent_flow.main[0].id,
    sha256(jsonencode([
      var.foundation_model,
      local.prompts.synthesis,
      [for k in keys(local.agents) : aws_bedrockagent_agent_alias.this[k].agent_alias_arn],
    ])),
  ]

  provisioner "local-exec" {
    command = "node ${path.module}/../scripts/publish-flow.mjs ${aws_bedrockagent_flow.main[0].id} ${local.region} ${local.flow_alias_name}"
  }
}
