output "eks_cluster_name" {
  description = "Name of the EKS cluster."
  value       = module.eks.cluster_name
}

output "eks_cluster_endpoint" {
  description = "Endpoint of the EKS Kubernetes API server."
  value       = module.eks.cluster_endpoint
}

output "rds_endpoint" {
  description = "Connection endpoint for the RDS PostgreSQL instance."
  value       = aws_db_instance.postgres.endpoint
  sensitive   = true
}

output "lakehouse_bucket" {
  description = "Name of the lakehouse S3 bucket."
  value       = aws_s3_bucket.lakehouse.bucket
}

output "audit_worm_bucket" {
  description = "Name of the audit WORM S3 bucket."
  value       = aws_s3_bucket.audit_worm.bucket
}

output "kms_key_arns" {
  description = "ARNs of the customer-managed KMS keys."
  value = {
    rds         = aws_kms_key.rds.arn
    s3          = aws_kms_key.s3.arn
    eks_secrets = aws_kms_key.eks_secrets.arn
  }
}
