# Application secrets, generated here and stored in Secrets Manager; ECS injects them as
# environment variables at task start. They are also in OpenTofu state, which is why the state
# bucket is encrypted and private (bootstrap/). The RDS master password is managed by RDS itself.

resource "random_password" "app_migrator" {
  length  = 32
  special = false # used inside connection URLs
}

resource "random_password" "app_runtime" {
  length  = 32
  special = false
}

resource "random_password" "auth_secret" {
  length  = 64
  special = false
}

locals {
  db_host     = aws_db_instance.main.address
  db_url_tail = "${local.db_host}:5432/${aws_db_instance.main.db_name}?sslmode=verify-full"
}

resource "aws_secretsmanager_secret" "app" {
  name                    = "${local.name}/app"
  description             = "Blue Ecosystem ${var.environment}: API/worker secrets"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    AUTH_SECRET           = random_password.auth_secret.result
    DATABASE_RUNTIME_URL  = "postgres://app_runtime:${random_password.app_runtime.result}@${local.db_url_tail}"
    DATABASE_MIGRATOR_URL = "postgres://app_migrator:${random_password.app_migrator.result}@${local.db_url_tail}"
    APP_RUNTIME_PASSWORD  = random_password.app_runtime.result
    APP_MIGRATOR_PASSWORD = random_password.app_migrator.result
    VALKEY_URL            = "rediss://${aws_elasticache_replication_group.valkey.primary_endpoint_address}:6379"
  })
}
