# EKS control plane + a single managed node group. IRSA is enabled so the
# IAM roles in iam.tf can be assumed by service accounts via the cluster's
# OIDC provider. Secrets are envelope-encrypted with a dedicated KMS key.

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = "medflow-${var.env}"
  cluster_version = var.eks_cluster_version

  # Public for operator kubectl access + private for in-VPC traffic. Lock the
  # public CIDRs down in prod (see README).
  cluster_endpoint_public_access  = true
  cluster_endpoint_private_access = true

  enable_irsa = true

  # Envelope-encrypt Kubernetes secrets with a customer-managed KMS key.
  cluster_encryption_config = {
    provider_key_arn = aws_kms_key.eks_secrets.arn
    resources        = ["secrets"]
  }

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  eks_managed_node_groups = {
    default = {
      instance_types = ["t3.large"]
      min_size       = 1
      max_size       = 5
      desired_size   = 3
    }
  }

  tags = {
    Name = "medflow-${var.env}"
  }
}
