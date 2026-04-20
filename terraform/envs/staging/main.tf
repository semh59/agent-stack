terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = local.common_tags
  }
}

locals {
  env = "staging"
  common_tags = {
    Environment = local.env
    System      = "sovereign-ai"
    ManagedBy   = "terraform"
  }
}

resource "aws_ecs_cluster" "this" {
  name = "sovereign-${local.env}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

data "aws_iam_policy_document" "ecs_task_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "sovereign-${local.env}-exec"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "secrets_read" {
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      var.gateway_auth_token_arn,
      var.bridge_secret_arn,
      var.claude_api_key_arn,
      var.openrouter_key_arn,
    ]
  }
}

resource "aws_iam_role_policy" "secrets_read" {
  name   = "secrets-read"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.secrets_read.json
}

resource "aws_iam_role" "task" {
  name               = "sovereign-${local.env}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume.json
}

resource "aws_security_group" "alb" {
  name        = "sovereign-${local.env}-alb"
  description = "Public ALB for gateway"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "gateway_task" {
  name        = "sovereign-${local.env}-gateway-task"
  description = "Gateway Fargate tasks"
  vpc_id      = var.vpc_id

  ingress {
    description     = "From ALB"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "bridge_task" {
  name        = "sovereign-${local.env}-bridge-task"
  description = "Optimization bridge Fargate tasks"
  vpc_id      = var.vpc_id

  ingress {
    description     = "From gateway"
    from_port       = 9100
    to_port         = 9100
    protocol        = "tcp"
    security_groups = [aws_security_group.gateway_task.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_lb" "public" {
  name               = "sovereign-${local.env}"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids
}

resource "aws_lb_target_group" "gateway" {
  name        = "sovereign-${local.env}-gw"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/api/health"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.public.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.gateway.arn
  }
}

module "gateway" {
  source = "../../modules/ecs-service"

  name           = "gateway"
  cluster_id     = aws_ecs_cluster.this.id
  image          = var.gateway_image
  container_port = 3000
  cpu            = 512
  memory         = 1024
  desired_count  = 1

  subnet_ids         = var.subnet_ids
  security_group_ids = [aws_security_group.gateway_task.id]
  target_group_arn   = aws_lb_target_group.gateway.arn
  healthcheck_path   = "/api/health"

  execution_role_arn = aws_iam_role.execution.arn
  task_role_arn      = aws_iam_role.task.arn

  environment = {
    NODE_ENV              = "staging"
    APP_ENV               = "staging"
    SOVEREIGN_GATEWAY_PORT = "3000"
    SOVEREIGN_GATEWAY_HOST = "0.0.0.0"
    AI_STACK_BRIDGE_HOST  = "optimization-bridge.staging.internal"
    AI_STACK_BRIDGE_PORT  = "9100"
  }

  secrets = {
    SOVEREIGN_GATEWAY_TOKEN = var.gateway_auth_token_arn
    AI_STACK_BRIDGE_SECRET = var.bridge_secret_arn
    CLAUDE_API_KEY         = var.claude_api_key_arn
  }

  tags = local.common_tags
}

module "bridge" {
  source = "../../modules/ecs-service"

  name           = "optimization-bridge"
  cluster_id     = aws_ecs_cluster.this.id
  image          = var.bridge_image
  container_port = 9100
  cpu            = 512
  memory         = 1024
  desired_count  = 1

  subnet_ids         = var.subnet_ids
  security_group_ids = [aws_security_group.bridge_task.id]
  target_group_arn   = ""
  healthcheck_path   = "/ready"

  execution_role_arn = aws_iam_role.execution.arn
  task_role_arn      = aws_iam_role.task.arn

  environment = {
    APP_ENV           = "staging"
    AI_STACK_DATA_DIR = "/data"
    LOG_LEVEL         = "INFO"
  }

  secrets = {
    AI_STACK_BRIDGE_SECRET      = var.bridge_secret_arn
    AI_STACK_OPENROUTER_API_KEY = var.openrouter_key_arn
  }

  tags = local.common_tags
}
