# Terraform — Sovereign AI infrastructure

Single-region AWS deployment targeting ECS Fargate. Two environments (staging / production) share the same module definitions; their backends, VPCs, and secrets are isolated.

## Layout

```
terraform/
├── modules/
│   └── ecs-service/         Reusable Fargate service (task def + service + target group)
└── envs/
    ├── production/          Wires the module into prod VPC/secrets
    └── staging/             Same, but against staging VPC/secrets
```

## What it creates

Per environment:

- ECS cluster (one per env)
- Two Fargate services behind an Application Load Balancer:
  - `gateway` on port 3000 (public ALB target)
  - `optimization-bridge` on port 9100 (internal, service-to-service only)
- CloudWatch log groups with 30-day retention
- IAM task + execution roles
- Security groups
- Secrets wired from AWS Secrets Manager into task environment via `secrets = [...]`

## Usage

```bash
cd terraform/envs/staging
terraform init
terraform plan -var-file=terraform.tfvars
terraform apply -var-file=terraform.tfvars
```

Required variables (populate `terraform.tfvars` from your secure store):

- `aws_region` — deployment region
- `vpc_id` — existing VPC
- `subnet_ids` — private subnets for Fargate tasks
- `public_subnet_ids` — public subnets for the ALB
- `gateway_image` — full ECR image URI for the gateway
- `bridge_image` — full ECR image URI for the bridge
- `gateway_auth_token_arn` — Secrets Manager ARN for `GATEWAY_AUTH_TOKEN`
- `bridge_secret_arn` — Secrets Manager ARN for `AI_STACK_BRIDGE_SECRET`
- `claude_api_key_arn` — Secrets Manager ARN for `CLAUDE_API_KEY`
- `openrouter_key_arn` — Secrets Manager ARN for `AI_STACK_OPENROUTER_API_KEY`

## Remote state

Each env uses its own S3 backend (`backend.tf`). Provision the bucket and DynamoDB lock table out-of-band — do NOT let this Terraform manage its own backend.

## Validation

```bash
terraform fmt -check -recursive
terraform -chdir=envs/staging init -backend=false
terraform -chdir=envs/staging validate
```

CI runs these checks on every push.
