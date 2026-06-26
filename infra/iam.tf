# ---------------------------------------------------------------------------
# Per-Lambda least-privilege inline policies. Only Lambdas that need more than
# basic logging appear here.
# ---------------------------------------------------------------------------
locals {
  lambda_policies = {
    "cloudwatch-analyzer" = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        # Logs Insights APIs are not resource-scopable; restrict by action only.
        Sid    = "InsightsQueries"
        Effect = "Allow"
        Action = [
          "logs:StartQuery",
          "logs:StopQuery",
          "logs:GetQueryResults",
          "logs:DescribeLogGroups",
        ]
        Resource = "*"
      }]
    })

    "generic-log-analyzer" = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Sid      = "ReadGenericLogs"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:ListBucket"]
        Resource = [aws_s3_bucket.generic_logs.arn, "${aws_s3_bucket.generic_logs.arn}/*"]
      }]
    })

    "email-alert-parser" = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Sid      = "ReadAlertEmails"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:ListBucket"]
        Resource = [aws_s3_bucket.alert_emails.arn, "${aws_s3_bucket.alert_emails.arn}/*"]
      }]
    })

    "report-dispatcher" = jsonencode({
      Version = "2012-10-17"
      Statement = [
        {
          Sid      = "SendReportEmail"
          Effect   = "Allow"
          Action   = ["ses:SendEmail", "ses:SendRawEmail"]
          Resource = "*"
        },
        {
          Sid      = "PublishAlerts"
          Effect   = "Allow"
          Action   = "sns:Publish"
          Resource = aws_sns_topic.alerts.arn
        },
      ]
    })

    "flow-trigger" = jsonencode({
      Version = "2012-10-17"
      Statement = [
        {
          Sid    = "InvokeAndResolveFlow"
          Effect = "Allow"
          Action = [
            "bedrock:InvokeFlow",
            "bedrock:ListFlowAliases",
            "bedrock:GetFlowAlias",
          ]
          Resource = [
            "arn:${local.partition}:bedrock:${local.region}:${local.account_id}:flow/*",
            "arn:${local.partition}:bedrock:${local.region}:${local.account_id}:flow/*/alias/*",
          ]
        },
        {
          # ListFlows is account-scoped and does not support resource-level scoping.
          Sid      = "ListFlows"
          Effect   = "Allow"
          Action   = "bedrock:ListFlows"
          Resource = "*"
        },
      ]
    })
  }

  # Splunk Lambda only gets a secrets-read policy when a secret ARN is configured.
  splunk_policy = var.splunk_secret_arn == "" ? {} : {
    "splunk-analyzer" = jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Sid      = "ReadSplunkCreds"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = var.splunk_secret_arn
      }]
    })
  }
}

# Attach the conditional Splunk policy separately so an empty secret ARN doesn't
# create an invalid (resource-less) statement.
resource "aws_iam_role_policy" "splunk_secret" {
  for_each = local.splunk_policy
  name     = "${local.prefix}-${each.key}-secret-policy"
  role     = aws_iam_role.lambda[each.key].id
  policy   = each.value
}

# ---------------------------------------------------------------------------
# Bedrock Agent service role — assumed by every agent. Allows invoking the
# foundation model and the agent's own action-group Lambdas.
# ---------------------------------------------------------------------------
resource "aws_iam_role" "agent" {
  name = "${local.prefix}-bedrock-agent-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "bedrock.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = { "aws:SourceAccount" = local.account_id }
        ArnLike      = { "aws:SourceArn" = "arn:${local.partition}:bedrock:${local.region}:${local.account_id}:agent/*" }
      }
    }]
  })
}

resource "aws_iam_role_policy" "agent" {
  name = "${local.prefix}-bedrock-agent-policy"
  role = aws_iam_role.agent.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "InvokeModel"
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
        Resource = local.model_invoke_resources
      },
      {
        Sid    = "InvokeActionGroupLambdas"
        Effect = "Allow"
        Action = "lambda:InvokeFunction"
        Resource = [
          aws_lambda_function.fn["cloudwatch-analyzer"].arn,
          aws_lambda_function.fn["splunk-analyzer"].arn,
          aws_lambda_function.fn["generic-log-analyzer"].arn,
          aws_lambda_function.fn["email-alert-parser"].arn,
        ]
      },
    ]
  })
}

# ---------------------------------------------------------------------------
# Bedrock Flow service role — assumed by the flow. Allows invoking the model,
# the analyzer agent aliases, and the report-dispatcher Lambda node.
# ---------------------------------------------------------------------------
resource "aws_iam_role" "flow" {
  count = var.enable_flow ? 1 : 0
  name  = "${local.prefix}-bedrock-flow-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "bedrock.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = { "aws:SourceAccount" = local.account_id }
        ArnLike      = { "aws:SourceArn" = "arn:${local.partition}:bedrock:${local.region}:${local.account_id}:flow/*" }
      }
    }]
  })
}

resource "aws_iam_role_policy" "flow" {
  count = var.enable_flow ? 1 : 0
  name  = "${local.prefix}-bedrock-flow-policy"
  role  = aws_iam_role.flow[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "InvokeModel"
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
        Resource = local.model_invoke_resources
      },
      {
        Sid      = "InvokeAgents"
        Effect   = "Allow"
        Action   = ["bedrock:InvokeAgent"]
        Resource = "arn:${local.partition}:bedrock:${local.region}:${local.account_id}:agent-alias/*"
      },
      {
        Sid      = "InvokeDispatcher"
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = aws_lambda_function.fn["report-dispatcher"].arn
      },
    ]
  })
}
