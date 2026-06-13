# PostgreSQL 16 for MedFlow's transactional + audit stores. Encrypted at rest
# with a customer-managed KMS key, private-only, deletion-protected, with
# encrypted Performance Insights and 7-day automated backups.

resource "aws_security_group" "rds" {
  name        = "medflow-${var.env}-rds"
  description = "Ingress to MedFlow RDS PostgreSQL from EKS node group only"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "PostgreSQL from EKS nodes"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [module.eks.node_security_group_id]
  }

  egress {
    description = "Allow all egress"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "medflow-${var.env}-rds" }
}

resource "aws_db_instance" "postgres" {
  identifier     = "medflow-${var.env}"
  engine         = "postgres"
  engine_version = "16"

  instance_class    = var.rds_instance_class
  allocated_storage = 100
  storage_type      = "gp3"

  db_name  = "medflow"
  username = "medflow_admin"
  # Manage the password out of band (Secrets Manager) — see README.
  manage_master_user_password = true

  storage_encrypted = true
  kms_key_id        = aws_kms_key.rds.arn

  multi_az               = var.rds_multi_az
  db_subnet_group_name   = module.vpc.database_subnet_group_name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false

  deletion_protection     = true
  backup_retention_period = 7
  skip_final_snapshot     = false
  final_snapshot_identifier = "medflow-${var.env}-final"

  performance_insights_enabled    = true
  performance_insights_kms_key_id = aws_kms_key.rds.arn

  tags = { Name = "medflow-${var.env}" }
}
