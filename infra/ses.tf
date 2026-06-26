# SES sender identity for the report email. (You must confirm the verification email,
# or use a domain identity with DKIM for production sending.)
resource "aws_ses_email_identity" "sender" {
  email = var.report_sender
}

# ---- Optional inbound receipt: deliver alert emails to the alert bucket ----

resource "aws_ses_receipt_rule_set" "inbound" {
  count         = var.enable_ses_inbound ? 1 : 0
  rule_set_name = "${local.prefix}-inbound"
}

resource "aws_ses_active_receipt_rule_set" "inbound" {
  count         = var.enable_ses_inbound ? 1 : 0
  rule_set_name = aws_ses_receipt_rule_set.inbound[0].rule_set_name
}

resource "aws_ses_receipt_rule" "to_bucket" {
  count         = var.enable_ses_inbound ? 1 : 0
  name          = "${local.prefix}-to-bucket"
  rule_set_name = aws_ses_receipt_rule_set.inbound[0].rule_set_name
  recipients    = var.ses_inbound_recipients
  enabled       = true
  scan_enabled  = true

  s3_action {
    bucket_name       = aws_s3_bucket.alert_emails.id
    object_key_prefix = var.email_prefix
    position          = 1
  }

  depends_on = [aws_s3_bucket_policy.alert_emails_ses]
}
