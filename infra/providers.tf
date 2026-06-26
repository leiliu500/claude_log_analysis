provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "bedrock-agentic-log-analysis"
      ManagedBy = "terraform"
      Component = "log-analysis"
    }
  }
}
