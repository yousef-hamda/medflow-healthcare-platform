# MedFlow — AWS infrastructure (Terraform)

This module provisions the cloud foundation for MedFlow: a VPC, an EKS cluster,
a PostgreSQL RDS instance, S3 storage (lakehouse + immutable audit WORM),
customer-managed KMS keys, IRSA roles, and a regional WAF.

> ⚠️ **COST WARNING** — `terraform apply` here creates real, billed AWS
> resources: an EKS control plane (~$0.10/hr) + 3× `t3.large` nodes, a NAT
> gateway, an RDS instance (default `db.r6g.large`), and KMS keys. Expect this
> to cost **hundreds of USD per month**. Run `terraform destroy` when you are
> done evaluating. RDS has `deletion_protection = true` and the audit bucket
> uses **COMPLIANCE** Object Lock — see *Teardown* below.

## Usage

```bash
cd infra/terraform

terraform init          # local state until the S3 backend is enabled
terraform plan  -var "env=dev"
terraform apply -var "env=dev"
```

Wire up the kubeconfig after apply:

```bash
aws eks update-kubeconfig --name "$(terraform output -raw eks_cluster_name)" \
  --region "$(terraform output -raw region 2>/dev/null || echo us-east-1)"
```

### Remote state

`providers.tf` ships with a **commented-out** S3 backend block and the exact
commands to pre-create the state bucket + DynamoDB lock table. Uncomment it and
run `terraform init -migrate-state` before collaborating.

## What this is — and isn't

This is a **skeleton**: it is structured to `terraform plan` cleanly by
inspection (registry modules, valid resource arguments) but is intentionally
minimal. Notably:

- `module.vpc` / `module.eks` are the official `terraform-aws-modules` registry
  modules (`~> 5.0` / `~> 20.0`); `terraform init` will download them.
- The ALB is created **inside** the cluster by the AWS Load Balancer
  Controller, so `waf.tf` only associates the Web ACL when
  `alb_arn_for_waf` is supplied (otherwise `count = 0`).
- The RDS master password is managed by AWS Secrets Manager
  (`manage_master_user_password = true`), not Terraform state.

## Production TODO

- [ ] Enable the S3 remote state backend + DynamoDB locking.
- [ ] One NAT gateway **per AZ** (`single_nat_gateway = false`) for HA.
- [ ] Restrict `cluster_endpoint_public_access_cidrs` (or go private-only +
      bastion/VPN).
- [ ] Set `rds_multi_az = true` and right-size `rds_instance_class`.
- [ ] Add EKS control-plane logging, GuardDuty, Security Hub, AWS Config.
- [ ] Scope KMS key policies explicitly (least-privilege grants).
- [ ] Pin module + provider versions to exact releases.
- [ ] Add VPC flow logs and S3 access logging for the audit trail.
- [ ] Review the WAF rate limit (2000/5min) against real traffic.

## Teardown

```bash
# RDS deletion protection must be removed first:
terraform apply -var "env=dev" -var 'rds_deletion_protection=false'   # if exposed as a var
terraform destroy -var "env=dev"
```

The `audit-worm` bucket uses **COMPLIANCE** Object Lock (2190 days ≈ 6 years).
Locked object versions **cannot be deleted before expiry by anyone, including
root**, so `terraform destroy` will fail to remove that bucket until all
retained versions expire. This is intentional (HIPAA audit immutability).
