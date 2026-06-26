# Buckets the generic-log and email-alert analyzers read from.

resource "aws_s3_bucket" "generic_logs" {
  bucket        = "${local.prefix}-generic-logs-${local.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "generic_logs" {
  bucket                  = aws_s3_bucket.generic_logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "generic_logs" {
  bucket = aws_s3_bucket.generic_logs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket" "alert_emails" {
  bucket        = "${local.prefix}-alert-emails-${local.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "alert_emails" {
  bucket                  = aws_s3_bucket.alert_emails.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "alert_emails" {
  bucket = aws_s3_bucket.alert_emails.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Allow SES to deliver inbound email into the alert bucket (used only when SES
# inbound receipt is enabled). Harmless to keep in place otherwise.
resource "aws_s3_bucket_policy" "alert_emails_ses" {
  count  = var.enable_ses_inbound ? 1 : 0
  bucket = aws_s3_bucket.alert_emails.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowSESPuts"
      Effect    = "Allow"
      Principal = { Service = "ses.amazonaws.com" }
      Action    = "s3:PutObject"
      Resource  = "${aws_s3_bucket.alert_emails.arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceAccount" = local.account_id
          "AWS:SourceArn"     = "arn:${local.partition}:ses:${local.region}:${local.account_id}:receipt-rule-set/${local.prefix}-inbound:receipt-rule/${local.prefix}-to-bucket"
        }
      }
    }]
  })
}
