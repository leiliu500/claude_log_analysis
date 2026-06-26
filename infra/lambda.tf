# ---------------------------------------------------------------------------
# Lambda packaging + functions. Each handler is bundled by `npm run build` into
# dist/<name>/index.js (mjs). archive_file zips each directory for deployment.
# ---------------------------------------------------------------------------

locals {
  dist_dir = "${path.module}/../dist"

  # name -> handler bundle directory + runtime config.
  lambdas = {
    "cloudwatch-analyzer" = {
      env = { DEFAULT_LOG_GROUPS = join(",", var.default_log_groups) }
    }
    "splunk-analyzer" = {
      env = { SPLUNK_SECRET_ARN = var.splunk_secret_arn }
    }
    "generic-log-analyzer" = {
      env = { GENERIC_LOG_BUCKET = aws_s3_bucket.generic_logs.id }
    }
    "email-alert-parser" = {
      env = {
        EMAIL_BUCKET = aws_s3_bucket.alert_emails.id
        EMAIL_PREFIX = var.email_prefix
      }
    }
    "report-dispatcher" = {
      env = {
        REPORT_SENDER     = var.report_sender
        REPORT_RECIPIENTS = join(",", var.report_recipients)
        ALERT_TOPIC_ARN   = aws_sns_topic.alerts.arn
        ALERT_THRESHOLD   = var.alert_threshold
      }
    }
    "flow-trigger" = {
      # Resolved by name at runtime (no resource reference -> no dependency cycle).
      env = {
        FLOW_NAME       = local.flow_name
        FLOW_ALIAS_NAME = local.flow_alias_name
        WINDOW_MINUTES  = tostring(var.window_minutes)
      }
    }
  }
}

data "archive_file" "lambda" {
  for_each    = local.lambdas
  type        = "zip"
  source_dir  = "${local.dist_dir}/${each.key}"
  output_path = "${path.module}/.build/${each.key}.zip"
}

# Per-Lambda execution role.
resource "aws_iam_role" "lambda" {
  for_each = local.lambdas
  name     = "${local.prefix}-${each.key}-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  for_each   = local.lambdas
  role       = aws_iam_role.lambda[each.key].name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Per-Lambda least-privilege inline policy (see iam.tf for the statement docs).
resource "aws_iam_role_policy" "lambda_inline" {
  for_each = local.lambda_policies
  name     = "${local.prefix}-${each.key}-policy"
  role     = aws_iam_role.lambda[each.key].id
  policy   = each.value
}

resource "aws_cloudwatch_log_group" "lambda" {
  for_each          = local.lambdas
  name              = "/aws/lambda/${local.prefix}-${each.key}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "fn" {
  for_each = local.lambdas

  function_name    = "${local.prefix}-${each.key}"
  role             = aws_iam_role.lambda[each.key].arn
  filename         = data.archive_file.lambda[each.key].output_path
  source_code_hash = data.archive_file.lambda[each.key].output_base64sha256
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  architectures    = ["arm64"]
  timeout          = 60
  memory_size      = 512

  environment {
    variables = each.value.env
  }

  depends_on = [aws_cloudwatch_log_group.lambda]
}

# Allow Bedrock agents to invoke the four action-group Lambdas. Scoped by
# source_account + an agent-ARN wildcard to avoid a Terraform dependency cycle
# (the agent's action group already references the Lambda ARN).
resource "aws_lambda_permission" "bedrock_agent_invoke" {
  for_each = toset([
    "cloudwatch-analyzer",
    "splunk-analyzer",
    "generic-log-analyzer",
    "email-alert-parser",
  ])
  statement_id   = "AllowBedrockAgentInvoke"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.fn[each.value].function_name
  principal      = "bedrock.amazonaws.com"
  source_account = local.account_id
  source_arn     = "arn:${local.partition}:bedrock:${local.region}:${local.account_id}:agent/*"
}

# Allow the Bedrock flow to invoke the report-dispatcher Lambda node.
resource "aws_lambda_permission" "bedrock_flow_invoke" {
  count          = var.enable_flow ? 1 : 0
  statement_id   = "AllowBedrockFlowInvoke"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.fn["report-dispatcher"].function_name
  principal      = "bedrock.amazonaws.com"
  source_account = local.account_id
  source_arn     = "arn:${local.partition}:bedrock:${local.region}:${local.account_id}:flow/*"
}
