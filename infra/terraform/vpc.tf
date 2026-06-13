# Network foundation. Three AZ for HA across private (workloads), public
# (ALB/NAT) and isolated database subnet tiers. Single NAT keeps the skeleton
# cheap; see README for the prod (one-NAT-per-AZ) recommendation.

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 3)

  # Carve the VPC CIDR into three tiers x three AZ.
  private_subnets  = [for i in range(3) : cidrsubnet(var.vpc_cidr, 4, i)]
  public_subnets   = [for i in range(3) : cidrsubnet(var.vpc_cidr, 4, i + 3)]
  database_subnets = [for i in range(3) : cidrsubnet(var.vpc_cidr, 4, i + 6)]
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "medflow-${var.env}"
  cidr = var.vpc_cidr

  azs              = local.azs
  private_subnets  = local.private_subnets
  public_subnets   = local.public_subnets
  database_subnets = local.database_subnets

  create_database_subnet_group = true

  enable_nat_gateway   = true
  single_nat_gateway   = true
  enable_dns_hostnames = true
  enable_dns_support   = true

  # Tags so the AWS Load Balancer Controller can discover subnets.
  public_subnet_tags = {
    "kubernetes.io/role/elb" = "1"
  }
  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = "1"
  }

  tags = {
    Name = "medflow-${var.env}"
  }
}
