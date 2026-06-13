# Customer-managed KMS keys, one per data domain, all with annual rotation.
# Separating keys lets us scope grants and revoke blast radius per service.

resource "aws_kms_key" "rds" {
  description             = "MedFlow ${var.env} — RDS PostgreSQL encryption at rest"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  tags                    = { Name = "medflow-${var.env}-rds" }
}

resource "aws_kms_alias" "rds" {
  name          = "alias/medflow-${var.env}-rds"
  target_key_id = aws_kms_key.rds.key_id
}

resource "aws_kms_key" "s3" {
  description             = "MedFlow ${var.env} — S3 lakehouse + audit-WORM encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  tags                    = { Name = "medflow-${var.env}-s3" }
}

resource "aws_kms_alias" "s3" {
  name          = "alias/medflow-${var.env}-s3"
  target_key_id = aws_kms_key.s3.key_id
}

resource "aws_kms_key" "eks_secrets" {
  description             = "MedFlow ${var.env} — EKS secrets envelope encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  tags                    = { Name = "medflow-${var.env}-eks-secrets" }
}

resource "aws_kms_alias" "eks_secrets" {
  name          = "alias/medflow-${var.env}-eks-secrets"
  target_key_id = aws_kms_key.eks_secrets.key_id
}
