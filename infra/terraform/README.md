# Infrastructure (OpenTofu) — AWS af-south-1

ADR-010: AWS, region **af-south-1 (Cape Town)**. Nothing here has been applied yet. Applying
creates billable resources in your AWS account, so every `apply` is a deliberate, human step.

```
bootstrap/   S3 bucket for OpenTofu state (apply once, local state)
staging/     The staging environment
```

## Staging architecture

- **Network:** a VPC across 2 AZs. The public subnets hold only the ALB and one NAT gateway; all tasks and data stores sit in private subnets.
- **Load balancer:** one HTTPS ALB (ACM certificate for `*.<domain>`) routes by host name: `api.`, `samakios.` and `bluedata.`. HTTP redirects to HTTPS.
- **ECS on Fargate:** the `api`, `worker`, `samakios-web` and `bluedata-web` services, plus one-off `migrate` and `bootstrap-db` tasks. Failed rollouts roll back automatically.
- **RDS PostgreSQL 17 + PostGIS:** single-AZ, encrypted, TLS forced, 7-day point-in-time recovery, deletion protection. The master password is managed by RDS.
- **ElastiCache Valkey 8:** single node, TLS and encryption at rest.
- **Secrets Manager:** application secrets (generated) and the RDS master secret (RDS-managed).
- **ECR:** immutable tags (the git SHA), scan on push, keeps the 30 most recent images.
- **CloudWatch Logs:** 30-day retention. **AWS Budgets:** email alerts at 80% (forecast) and 100% (actual).
- **GitHub OIDC deploy role:** `main` branch only. It can push these images and update these services, nothing else.

`NODE_ENV=staging` behaves like production (Secure cookies, no dev shortcuts), except that sign-in codes go to CloudWatch logs until an SMS provider is contracted. **Staging must only ever hold synthetic data.**

## Indicative monthly cost (staging)

Rough order of magnitude only; af-south-1 prices are higher than US/EU regions. **Confirm with the AWS Pricing Calculator before applying.**

| Item                                             | Rough USD/month |
| ------------------------------------------------ | --------------- |
| NAT gateway (1) + data                           | 45–60           |
| Application Load Balancer                        | 20–30           |
| Fargate: 4 tasks × 0.25 vCPU / 0.5 GB, always on | 40–55           |
| RDS db.t4g.micro + 20 GB gp3 + backups           | 20–30           |
| ElastiCache cache.t4g.micro                      | 15–20           |
| Secrets Manager, CloudWatch, ECR, ACM            | 5–15            |
| **Total**                                        | **~150–210**    |

The budget alarm defaults to 250 USD. The biggest levers are the NAT gateway (VPC endpoints instead) and scaling services to zero outside working hours.

## First-time setup (in order)

1. **AWS account:** enable the **af-south-1 opt-in region** (Account → AWS Regions). Use an admin profile with MFA for these steps.
2. **State bucket:**
   ```bash
   cd infra/terraform/bootstrap && tofu init && tofu apply -var state_bucket_name=blue-ecosystem-tofu-state-<account-id>
   ```
3. **Configure staging:** copy `staging/backend.hcl.example` to `backend.hcl` and `terraform.tfvars.example` to `terraform.tfvars`, then fill in the domain, GitHub repository and alert email.
4. **Plan, review, then apply:**
   ```bash
   cd infra/terraform/staging && tofu init -backend-config=backend.hcl && tofu plan -out staging.tfplan
   ```
   Read the plan. Then `tofu apply staging.tfplan`. The first apply **waits on certificate validation**: create the CNAME records from `tofu output certificate_validation` at your DNS provider while it waits.
5. **DNS:** point `api.`, `samakios.` and `bluedata.<domain>` at the ALB (`tofu output dns_records`).
6. **GitHub environment:** in the repository, create the `staging` environment (add required reviewers). Set these variables from `tofu output deploy`:
   - `AWS_DEPLOY_ROLE_ARN`
   - `ECS_CLUSTER`
   - `PRIVATE_SUBNETS` (comma-separated)
   - `APPS_SECURITY_GROUP`
   - `API_URL`
7. **First deploy:** run **Deploy staging** with **"Run the database bootstrap first"** ticked. It pushes the images, then bootstraps the database (roles and PostGIS, as the RDS master user), runs migrations, and starts the services. Later deploys leave the box unticked; tick it again only to rotate the app role passwords.

## Validating changes locally (no AWS access needed)

```bash
docker run --rm -v "$PWD/infra/terraform:/work" -w /work ghcr.io/opentofu/opentofu:1.10 fmt -recursive -check
```

```bash
docker run --rm -v "$PWD/infra/terraform:/work" -w /work/staging ghcr.io/opentofu/opentofu:1.10 init -backend=false
```

```bash
docker run --rm -v "$PWD/infra/terraform:/work" -w /work/staging ghcr.io/opentofu/opentofu:1.10 validate
```

## Production differences (later)

- Multi-AZ RDS, plus a read replica if needed.
- Valkey with a replica and automatic failover.
- One NAT gateway per AZ.
- At least 2 tasks per service with autoscaling.
- Container Insights.
- AWS WAF on the ALB.
- A real SMS provider, with `NODE_ENV=production`.
- Separate AWS accounts for staging and production.
- Commit-SHA-pinned GitHub Actions.
