# Scheduled trigger: an EventBridge rule invokes the flow-trigger Lambda, which calls
# InvokeFlow. Gated by enable_schedule (and only meaningful when the flow exists).

resource "aws_cloudwatch_event_rule" "schedule" {
  count               = var.enable_schedule ? 1 : 0
  name                = "${local.prefix}-schedule"
  description         = "Periodic log-analysis flow run."
  schedule_expression = var.schedule_expression
}

resource "aws_cloudwatch_event_target" "schedule" {
  count     = var.enable_schedule ? 1 : 0
  rule      = aws_cloudwatch_event_rule.schedule[0].name
  target_id = "flow-trigger"
  arn       = aws_lambda_function.fn["flow-trigger"].arn
  input     = jsonencode({ windowMinutes = var.window_minutes })
}

resource "aws_lambda_permission" "allow_eventbridge" {
  count         = var.enable_schedule ? 1 : 0
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.fn["flow-trigger"].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.schedule[0].arn
}
