output "alb_dns_name" {
  value       = aws_lb.public.dns_name
  description = "Public DNS name of the ALB."
}

output "cluster_name" {
  value       = aws_ecs_cluster.this.name
  description = "ECS cluster name."
}

output "gateway_service_name" {
  value       = module.gateway.service_name
  description = "ECS service name for gateway."
}

output "bridge_service_name" {
  value       = module.bridge.service_name
  description = "ECS service name for optimization bridge."
}
