terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # ---------------------------------------------------------------------------
  # Remote state backend (commented out for the skeleton — `terraform init`
  # uses local state until you wire this up).
  #
  # To enable, pre-create the bucket + DynamoDB lock table once, out of band:
  #
  #   aws s3api create-bucket --bucket medflow-tfstate-<acct-id> \
  #     --region us-east-1
  #   aws s3api put-bucket-versioning --bucket medflow-tfstate-<acct-id> \
  #     --versioning-configuration Status=Enabled
  #   aws dynamodb create-table --table-name medflow-tfstate-lock \
  #     --attribute-definitions AttributeName=LockID,AttributeType=S \
  #     --key-schema AttributeName=LockID,KeyType=HASH \
  #     --billing-mode PAY_PER_REQUEST
  #
  # then uncomment and run `terraform init -migrate-state`:
  #
  # backend "s3" {
  #   bucket         = "medflow-tfstate-<acct-id>"
  #   key            = "medflow/${var.env}/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "medflow-tfstate-lock"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = var.tags
  }
}
