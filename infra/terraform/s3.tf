# Object storage. Two buckets:
#   * lakehouse  — versioned, KMS-encrypted analytics data lake.
#   * audit-worm — same, plus S3 Object Lock in COMPLIANCE mode so audit
#                  records are immutable for the HIPAA 6-year retention window.
# Both fully block public access.

# ---------------------------------------------------------------------------
# Lakehouse bucket
# ---------------------------------------------------------------------------
resource "aws_s3_bucket" "lakehouse" {
  bucket = "medflow-${var.env}-lakehouse"
  tags   = { Name = "medflow-${var.env}-lakehouse" }
}

resource "aws_s3_bucket_versioning" "lakehouse" {
  bucket = aws_s3_bucket.lakehouse.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "lakehouse" {
  bucket = aws_s3_bucket.lakehouse.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.s3.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "lakehouse" {
  bucket                  = aws_s3_bucket.lakehouse.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ---------------------------------------------------------------------------
# Audit WORM bucket
# ---------------------------------------------------------------------------
resource "aws_s3_bucket" "audit_worm" {
  bucket              = "medflow-${var.env}-audit-worm"
  object_lock_enabled = true
  tags                = { Name = "medflow-${var.env}-audit-worm" }
}

resource "aws_s3_bucket_versioning" "audit_worm" {
  bucket = aws_s3_bucket.audit_worm.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audit_worm" {
  bucket = aws_s3_bucket.audit_worm.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.s3.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "audit_worm" {
  bucket                  = aws_s3_bucket.audit_worm.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# COMPLIANCE mode: not even the root account can shorten or remove the lock
# before expiry. 2190 days ~ 6 years (HIPAA audit retention).
resource "aws_s3_bucket_object_lock_configuration" "audit_worm" {
  bucket = aws_s3_bucket.audit_worm.id

  rule {
    default_retention {
      mode = "COMPLIANCE"
      days = 2190
    }
  }

  depends_on = [aws_s3_bucket_versioning.audit_worm]
}
