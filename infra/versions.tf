terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source = "hashicorp/aws"
      # 5.65+ provides aws_bedrockagent_agent / action_group / agent_alias.
      # 5.83+ provides aws_bedrockagent_flow / flow_version / flow_alias.
      version = ">= 5.83.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = ">= 2.4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.6.0"
    }
  }
}
