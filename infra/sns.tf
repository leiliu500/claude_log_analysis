# Alert fan-out topic. Subscribe email, HTTPS (PagerDuty/Opsgenie), or a Slack Lambda.

resource "aws_sns_topic" "alerts" {
  name = "${local.prefix}-alerts"
}

resource "aws_sns_topic_subscription" "email" {
  for_each  = toset(var.alert_email_subscriptions)
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = each.value
}
