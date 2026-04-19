variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "vpc_id" {
  type        = string
  description = "Existing VPC ID to deploy into."
}

variable "subnet_ids" {
  type        = list(string)
  description = "Private subnets for Fargate tasks."
}

variable "public_subnet_ids" {
  type        = list(string)
  description = "Public subnets for the ALB."
}

variable "gateway_image" {
  type        = string
  description = "ECR image URI for gateway (including tag)."
}

variable "bridge_image" {
  type        = string
  description = "ECR image URI for optimization bridge (including tag)."
}

variable "gateway_auth_token_arn" {
  type        = string
  description = "Secrets Manager ARN for GATEWAY_AUTH_TOKEN / LOJINEXT_GATEWAY_TOKEN."
}

variable "bridge_secret_arn" {
  type        = string
  description = "Secrets Manager ARN for AI_STACK_BRIDGE_SECRET."
}

variable "claude_api_key_arn" {
  type        = string
  description = "Secrets Manager ARN for CLAUDE_API_KEY."
}

variable "openrouter_key_arn" {
  type        = string
  description = "Secrets Manager ARN for AI_STACK_OPENROUTER_API_KEY."
}
