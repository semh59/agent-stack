variable "name" {
  description = "Logical service name, e.g. 'gateway' or 'optimization-bridge'."
  type        = string
}

variable "cluster_id" {
  description = "ECS cluster ID to deploy into."
  type        = string
}

variable "image" {
  description = "Full container image URI (including tag) to deploy."
  type        = string
}

variable "container_port" {
  description = "Port the container listens on."
  type        = number
}

variable "cpu" {
  description = "Fargate task CPU units (1024 = 1 vCPU)."
  type        = number
  default     = 512
}

variable "memory" {
  description = "Fargate task memory (MiB)."
  type        = number
  default     = 1024
}

variable "desired_count" {
  description = "Number of tasks to run."
  type        = number
  default     = 2
}

variable "environment" {
  description = "Plain env vars (non-sensitive)."
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = "Sensitive env vars — map of env var name to Secrets Manager ARN."
  type        = map(string)
  default     = {}
}

variable "subnet_ids" {
  description = "Private subnets for the task ENIs."
  type        = list(string)
}

variable "security_group_ids" {
  description = "Security groups attached to the task ENIs."
  type        = list(string)
}

variable "target_group_arn" {
  description = "If set, attach the service to this LB target group."
  type        = string
  default     = ""
}

variable "healthcheck_path" {
  description = "HTTP path used by the container healthcheck command."
  type        = string
  default     = "/health"
}

variable "log_retention_days" {
  description = "CloudWatch log retention."
  type        = number
  default     = 30
}

variable "execution_role_arn" {
  description = "IAM role ARN the ECS agent uses to pull images and read secrets."
  type        = string
}

variable "task_role_arn" {
  description = "IAM role ARN assumed by the container at runtime."
  type        = string
}

variable "tags" {
  description = "Tags applied to every resource."
  type        = map(string)
  default     = {}
}
