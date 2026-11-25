# Container platform: one ECS cluster on Fargate. Long-running services (api, worker, two web
# apps) plus one-off task definitions the deploy pipeline runs (bootstrap-db once, migrate on
# every deploy). All tasks run in private subnets with no public IP.

resource "aws_ecr_repository" "app" {
  for_each             = toset(["api", "samakios-web", "bluedata-web"])
  name                 = "blue/${each.key}"
  image_tag_mutability = "IMMUTABLE" # a tag (git SHA) always means the same image
  image_scanning_configuration { scan_on_push = true }
  encryption_configuration { encryption_type = "AES256" }
}

resource "aws_ecr_lifecycle_policy" "app" {
  for_each   = aws_ecr_repository.app
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the 30 most recent images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 30 }
      action       = { type = "expire" }
    }]
  })
}

resource "aws_ecs_cluster" "main" {
  name = local.name
  setting {
    name  = "containerInsights"
    value = "disabled" # enable ("enhanced") for production; it adds CloudWatch cost
  }
}

resource "aws_cloudwatch_log_group" "app" {
  for_each          = toset(["api", "worker", "samakios-web", "bluedata-web", "jobs"])
  name              = "/blue/${var.environment}/${each.key}"
  retention_in_days = 30 # ARCHITECTURE.md §14: application logs 30–90 days
}

locals {
  api_image     = "${aws_ecr_repository.app["api"].repository_url}:${var.image_tag}"
  secret        = aws_secretsmanager_secret.app.arn
  master_secret = aws_db_instance.main.master_user_secret[0].secret_arn
  samakios_host = "samakios.${var.domain_name}"
  bluedata_host = "bluedata.${var.domain_name}"
  api_host      = "api.${var.domain_name}"

  log_config = { for name in keys(aws_cloudwatch_log_group.app) : name => {
    logDriver = "awslogs"
    options = {
      awslogs-group         = aws_cloudwatch_log_group.app[name].name
      awslogs-region        = var.region
      awslogs-stream-prefix = name
    }
  } }

  # Shared by the API and worker. NODE_ENV=staging: production-like, but sign-in codes go to the
  # logs until an SMS provider is contracted — so staging must hold synthetic data only.
  backend_environment = [
    { name = "NODE_ENV", value = var.environment },
    { name = "LOG_LEVEL", value = "info" },
    { name = "SMS_PROVIDER", value = "log" },
    { name = "TRUST_PROXY", value = "true" },
    { name = "COOKIE_DOMAIN", value = ".${var.domain_name}" },
    { name = "CORS_ORIGINS", value = "https://${local.samakios_host},https://${local.bluedata_host}" },
  ]
  backend_secrets = [
    for key in ["AUTH_SECRET", "DATABASE_RUNTIME_URL", "VALKEY_URL"] :
    { name = key, valueFrom = "${local.secret}:${key}::" }
  ]
}

# --- IAM: the execution role starts containers; the task role is what the code may call. ---

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${local.name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  name = "read-app-secrets"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [local.secret, local.master_secret]
    }]
  })
}

# No AWS permissions yet: the application only talks to Postgres and Valkey. Grant S3 access
# here (scoped to the documents bucket) when the documents module lands in Phase 3.
resource "aws_iam_role" "task" {
  name               = "${local.name}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

# --- Task definitions ---

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name                   = "api"
    image                  = local.api_image
    essential              = true
    command                = ["node", "dist/main.api.js"]
    portMappings           = [{ containerPort = 4000, protocol = "tcp" }]
    environment            = concat(local.backend_environment, [{ name = "PORT", value = "4000" }])
    secrets                = local.backend_secrets
    logConfiguration       = local.log_config["api"]
    readonlyRootFilesystem = true
  }])
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${local.name}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  container_definitions = jsonencode([{
    name                   = "worker"
    image                  = local.api_image
    essential              = true
    command                = ["node", "dist/main.worker.js"]
    environment            = local.backend_environment
    secrets                = local.backend_secrets
    logConfiguration       = local.log_config["worker"]
    readonlyRootFilesystem = true
  }])
}

# Run on every deploy, before the services update: migrations + reference seed, as app_migrator.
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.name}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  container_definitions = jsonencode([{
    name             = "migrate"
    image            = local.api_image
    essential        = true
    command          = ["node", "dist/scripts/migrate.js"]
    secrets          = [{ name = "DATABASE_MIGRATOR_URL", valueFrom = "${local.secret}:DATABASE_MIGRATOR_URL::" }]
    logConfiguration = local.log_config["jobs"]
  }])
}

# Run once after the database is created (and again to rotate the app role passwords):
# creates app_migrator/app_runtime and PostGIS as the RDS master user.
resource "aws_ecs_task_definition" "bootstrap_db" {
  family                   = "${local.name}-bootstrap-db"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  container_definitions = jsonencode([{
    name      = "bootstrap-db"
    image     = local.api_image
    essential = true
    command   = ["node", "dist/scripts/bootstrap-db.js"]
    environment = [
      { name = "PGHOST", value = local.db_host },
      { name = "PGDATABASE", value = aws_db_instance.main.db_name },
      { name = "PGSSLMODE", value = "verify-full" },
    ]
    secrets = [
      { name = "PGUSER", valueFrom = "${local.master_secret}:username::" },
      { name = "PGPASSWORD", valueFrom = "${local.master_secret}:password::" },
      { name = "APP_MIGRATOR_PASSWORD", valueFrom = "${local.secret}:APP_MIGRATOR_PASSWORD::" },
      { name = "APP_RUNTIME_PASSWORD", valueFrom = "${local.secret}:APP_RUNTIME_PASSWORD::" },
    ]
    logConfiguration = local.log_config["jobs"]
  }])
}

resource "aws_ecs_task_definition" "web" {
  for_each                 = { samakios-web = local.samakios_host, bluedata-web = local.bluedata_host }
  family                   = "${local.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  container_definitions = jsonencode([{
    name             = each.key
    image            = "${aws_ecr_repository.app[each.key].repository_url}:${var.image_tag}"
    essential        = true
    portMappings     = [{ containerPort = 3000, protocol = "tcp" }]
    environment      = [{ name = "PORT", value = "3000" }, { name = "HOSTNAME", value = "0.0.0.0" }]
    logConfiguration = local.log_config[each.key]
  }])
}

# --- Services ---

locals {
  services = {
    api          = { task = aws_ecs_task_definition.api.arn, target_group = aws_lb_target_group.api.arn, port = 4000 }
    samakios-web = { task = aws_ecs_task_definition.web["samakios-web"].arn, target_group = aws_lb_target_group.web["samakios-web"].arn, port = 3000 }
    bluedata-web = { task = aws_ecs_task_definition.web["bluedata-web"].arn, target_group = aws_lb_target_group.web["bluedata-web"].arn, port = 3000 }
  }
}

resource "aws_ecs_service" "web" {
  for_each        = local.services
  name            = each.key
  cluster         = aws_ecs_cluster.main.id
  task_definition = each.value.task
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.apps.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = each.value.target_group
    container_name   = each.key
    container_port   = each.value.port
  }

  # Roll back automatically if new tasks fail health checks.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  health_check_grace_period_seconds = 30

  # The deploy pipeline changes task definitions; don't let a later `tofu apply` revert them.
  lifecycle {
    ignore_changes = [task_definition]
  }
  depends_on = [aws_lb_listener.https]
}

resource "aws_ecs_service" "worker" {
  name            = "worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.apps.id]
    assign_public_ip = false
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  lifecycle {
    ignore_changes = [task_definition]
  }
}
