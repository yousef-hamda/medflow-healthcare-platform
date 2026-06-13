# IRSA roles. Each role trusts the EKS OIDC provider and is scoped to a single
# Kubernetes service account, granting least-privilege access to S3 data.

locals {
  oidc_provider_arn = module.eks.oidc_provider_arn
  oidc_provider_url = replace(module.eks.cluster_oidc_issuer_url, "https://", "")
}

# ---------------------------------------------------------------------------
# ml-serving — read-only on the mlflow-artifacts/ prefix of the lakehouse.
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "ml_serving_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_provider_url}:sub"
      values   = ["system:serviceaccount:medflow:ml-serving"]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_provider_url}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "ml_serving" {
  statement {
    sid       = "ListMlflowArtifacts"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.lakehouse.arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["mlflow-artifacts/*"]
    }
  }
  statement {
    sid       = "ReadMlflowArtifacts"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.lakehouse.arn}/mlflow-artifacts/*"]
  }
  statement {
    sid       = "UseS3Key"
    effect    = "Allow"
    actions   = ["kms:Decrypt", "kms:DescribeKey"]
    resources = [aws_kms_key.s3.arn]
  }
}

resource "aws_iam_role" "ml_serving" {
  name               = "medflow-${var.env}-ml-serving"
  assume_role_policy = data.aws_iam_policy_document.ml_serving_assume.json
  tags               = { Name = "medflow-${var.env}-ml-serving" }
}

resource "aws_iam_role_policy" "ml_serving" {
  name   = "ml-serving-s3"
  role   = aws_iam_role.ml_serving.id
  policy = data.aws_iam_policy_document.ml_serving.json
}

# ---------------------------------------------------------------------------
# audit-service — append-only to audit-worm; explicitly DENIED any delete.
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "audit_service_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_provider_url}:sub"
      values   = ["system:serviceaccount:medflow:audit-service"]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_provider_url}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "audit_service" {
  statement {
    sid    = "WriteImmutableAudit"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:PutObjectRetention",
      "s3:GetObject",
      "s3:ListBucket",
      "s3:GetBucketObjectLockConfiguration",
    ]
    resources = [
      aws_s3_bucket.audit_worm.arn,
      "${aws_s3_bucket.audit_worm.arn}/*",
    ]
  }
  # Defence in depth on top of Object Lock: never allow deletes.
  statement {
    sid    = "DenyAuditDeletes"
    effect = "Deny"
    actions = [
      "s3:DeleteObject",
      "s3:DeleteObjectVersion",
    ]
    resources = ["${aws_s3_bucket.audit_worm.arn}/*"]
  }
  statement {
    sid       = "UseS3Key"
    effect    = "Allow"
    actions   = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"]
    resources = [aws_kms_key.s3.arn]
  }
}

resource "aws_iam_role" "audit_service" {
  name               = "medflow-${var.env}-audit-service"
  assume_role_policy = data.aws_iam_policy_document.audit_service_assume.json
  tags               = { Name = "medflow-${var.env}-audit-service" }
}

resource "aws_iam_role_policy" "audit_service" {
  name   = "audit-service-s3"
  role   = aws_iam_role.audit_service.id
  policy = data.aws_iam_policy_document.audit_service.json
}

# ---------------------------------------------------------------------------
# spark — read/write on the lakehouse bucket.
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "spark_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_provider_url}:sub"
      values   = ["system:serviceaccount:medflow-data:spark"]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_provider_url}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "spark" {
  statement {
    sid       = "ListLakehouse"
    effect    = "Allow"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.lakehouse.arn]
  }
  statement {
    sid    = "ReadWriteLakehouse"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:AbortMultipartUpload",
      "s3:ListMultipartUploadParts",
    ]
    resources = ["${aws_s3_bucket.lakehouse.arn}/*"]
  }
  statement {
    sid       = "UseS3Key"
    effect    = "Allow"
    actions   = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"]
    resources = [aws_kms_key.s3.arn]
  }
}

resource "aws_iam_role" "spark" {
  name               = "medflow-${var.env}-spark"
  assume_role_policy = data.aws_iam_policy_document.spark_assume.json
  tags               = { Name = "medflow-${var.env}-spark" }
}

resource "aws_iam_role_policy" "spark" {
  name   = "spark-lakehouse-s3"
  role   = aws_iam_role.spark.id
  policy = data.aws_iam_policy_document.spark.json
}
