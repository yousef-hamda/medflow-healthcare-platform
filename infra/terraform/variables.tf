variable "region" {
  description = "AWS region to deploy MedFlow infrastructure into."
  type        = string
  default     = "us-east-1"
}

variable "env" {
  description = "Deployment environment (e.g. dev, staging, prod). Used in resource names and tags."
  type        = string
  default     = "dev"
}

variable "vpc_cidr" {
  description = "CIDR block for the MedFlow VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "eks_cluster_version" {
  description = "Kubernetes control-plane version for the EKS cluster."
  type        = string
  default     = "1.29"
}

variable "rds_instance_class" {
  description = "Instance class for the PostgreSQL RDS instance."
  type        = string
  default     = "db.r6g.large"
}

variable "rds_multi_az" {
  description = "Whether to run RDS in Multi-AZ for high availability (recommended for prod)."
  type        = bool
  default     = false
}

variable "alb_arn_for_waf" {
  description = "ARN of the Application Load Balancer to associate the WAFv2 Web ACL with."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Common tags applied to all resources via the provider default_tags."
  type        = map(string)
  default = {
    Project    = "medflow"
    ManagedBy  = "terraform"
    Compliance = "hipaa"
  }
}
