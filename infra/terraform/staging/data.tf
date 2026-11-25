# Managed data stores (ADR-010): RDS PostgreSQL with PostGIS, ElastiCache Valkey.
# Staging is single-AZ for cost; production adds Multi-AZ before the paid pilot.

resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_parameter_group" "postgres" {
  name   = "${local.name}-postgres17"
  family = "postgres17"

  # Reject unencrypted connections; clients use sslmode=verify-full with the RDS CA bundle.
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  # Slow-query visibility (ARCHITECTURE.md §15.3).
  parameter {
    name  = "log_min_duration_statement"
    value = "500"
  }
}

resource "aws_db_instance" "main" {
  identifier     = local.name
  engine         = "postgres"
  engine_version = "17"
  instance_class = "db.t4g.micro"

  db_name  = "blue"
  username = "blue_admin"
  # RDS creates and rotates the master password in Secrets Manager; it never appears in state.
  manage_master_user_password = true

  allocated_storage     = 20
  max_allocated_storage = 100
  storage_type          = "gp3"
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.data.id]
  parameter_group_name   = aws_db_parameter_group.postgres.name
  publicly_accessible    = false
  multi_az               = false

  backup_retention_period    = 7 # point-in-time recovery window
  backup_window              = "01:00-02:00"
  maintenance_window         = "sun:02:30-sun:03:30"
  auto_minor_version_upgrade = true
  copy_tags_to_snapshot      = true
  deletion_protection        = true
  skip_final_snapshot        = false
  final_snapshot_identifier  = "${local.name}-final"
}

resource "aws_elasticache_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_elasticache_replication_group" "valkey" {
  replication_group_id = local.name
  description          = "Queues, rate limits and caches (ADR-015)"
  engine               = "valkey"
  engine_version       = "8.0"
  node_type            = "cache.t4g.micro"
  num_cache_clusters   = 1
  port                 = 6379

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.data.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true # clients connect with rediss://
  automatic_failover_enabled = false
  snapshot_retention_limit   = 1
}
