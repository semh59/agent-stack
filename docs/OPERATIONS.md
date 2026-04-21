# Operations

Runbook-style notes for deploying, monitoring, rolling back, and responding to incidents.

## Deploy

### Prerequisites (one-time, per environment)

1. **VPC** with at least two private subnets (for tasks) and two public subnets (for ALB).
2. **Secrets Manager entries** for:
   - `alloy/<env>/gateway_auth_token`
   - `alloy/<env>/bridge_secret`
   - `alloy/<env>/claude_api_key`
   - `alloy/<env>/openrouter_api_key`
   Generate with `openssl rand -hex 32` and store in Secrets Manager.
3. **ECR repositories**: `alloy-gateway`, `alloy-bridge`.
4. **Terraform backend**: an S3 bucket + DynamoDB lock table (out-of-band).

### Cut a release

```bash
# 1. Build + push images
docker build -t alloy-gateway:v1.2.3 AGENT/
docker build -t alloy-bridge:v1.2.3 bridge/ --target runtime
docker tag  alloy-gateway:v1.2.3 $ACCT.dkr.ecr.$REGION.amazonaws.com/alloy-gateway:v1.2.3
docker tag  alloy-bridge:v1.2.3  $ACCT.dkr.ecr.$REGION.amazonaws.com/alloy-bridge:v1.2.3
docker push $ACCT.dkr.ecr.$REGION.amazonaws.com/alloy-gateway:v1.2.3
docker push $ACCT.dkr.ecr.$REGION.amazonaws.com/alloy-bridge:v1.2.3

# 2. Bump the tag in terraform.tfvars
sed -i 's|alloy-gateway:.*|alloy-gateway:v1.2.3"|' terraform/envs/production/terraform.tfvars
sed -i 's|alloy-bridge:.*|alloy-bridge:v1.2.3"|'   terraform/envs/production/terraform.tfvars

# 3. Apply
cd terraform/envs/production
terraform plan
terraform apply
```

ECS performs a rolling deploy. The `deployment_circuit_breaker` auto-rolls-back if the new task revision fails to go healthy.

### Verify

```bash
# ALB health
curl -fsS https://<alb-host>/api/health

# Smoke the bridge through the gateway (requires gateway token)
curl -fsS https://<alb-host>/api/optimize \
  -H "Authorization: Bearer $GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"post-deploy smoke"}'
```

## Rollback

```bash
cd terraform/envs/production
# revert the image tag in terraform.tfvars, then:
terraform apply
```

Or, fast-path without touching Terraform:

```bash
aws ecs update-service \
  --cluster alloy-production \
  --service gateway \
  --task-definition gateway:<previous-revision>
```

## Monitoring

| Signal                      | Where                            | What to look at |
|-----------------------------|----------------------------------|-----------------|
| Request rate, latency, 5xx  | CloudWatch → ALB metrics         | 5xx > 1% → page |
| Task health                 | ECS → Services                   | Tasks flapping → see logs |
| Logs                        | CloudWatch → `/ecs/gateway`, `/ecs/optimization-bridge` | Filter by `request_id` |
| Cache hit ratio             | `GET /cache-stats` on bridge     | Drop = config or cold-start |
| Circuit breaker state       | `GET /status` on bridge          | `open` = upstream model down |

## Incident response

### Gateway returning 503

1. Check bridge health: `aws ecs describe-services --cluster alloy-<env> --services optimization-bridge`
2. If bridge tasks are cycling: inspect logs for `bridge_secret_missing` — secret rotation without Terraform apply is the classic cause.
3. If bridge is healthy but unreachable from gateway: check security group rules. The gateway SG must be in the bridge SG's ingress.

### Gateway returning 504

- Timeouts. Look at bridge `/status` — Ollama or OpenRouter is likely slow/down.
- Circuit breaker state shows which upstream is failing.
- Short-term: disable the failing layer via `force_layers` or scale up the healthy upstream.

### Structured 500s from `/optimize`

- Every 500 carries `request_id` and `error_type` in the body.
- `error_type: RuntimeError` on a specific layer → layer regression, check recent deploys of that module.
- Correlate with logs: `jq 'select(.request_id=="<id>")' <(aws logs ...)`.

### Bridge secret rotation

Zero-downtime rotation:

1. Write the new secret to Secrets Manager **as a second version**.
2. Update the gateway task's `AI_STACK_BRIDGE_SECRET` secret ARN to the new version, deploy.
3. Update the bridge's `AI_STACK_BRIDGE_SECRET` to the new version, deploy.
4. Once all gateway tasks are running the new secret, delete the old version.

(If you swap both at once, there's a brief window where one side has the old secret and the other has the new one — gateway will 401.)

## Local reproduction of prod issues

```bash
# With the same image tags as prod
export BRIDGE_SECRET="<prod-secret-from-secrets-manager>"
export GATEWAY_AUTH_TOKEN="<prod-gateway-token>"
export APP_ENV=production
docker compose -f docker-compose.unified.yml up --build
```

⚠️  Using real prod secrets on a laptop is discouraged. Prefer rotating secrets and reproducing against a staging copy of the data instead.
