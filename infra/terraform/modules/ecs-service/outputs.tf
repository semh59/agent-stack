output "service_name" {
  value       = aws_ecs_service.this.name
  description = "Name of the ECS service."
}

output "task_definition_arn" {
  value       = aws_ecs_task_definition.this.arn
  description = "ARN of the task definition revision."
}

output "log_group_name" {
  value       = aws_cloudwatch_log_group.this.name
  description = "CloudWatch log group for container stdout/stderr."
}
