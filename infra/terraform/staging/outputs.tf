resource "aws_budgets_budget" "monthly" {
  name         = "${local.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_filter {
    name   = "TagKeyValue"
    values = ["user:Environment$${var.environment}"]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_alert_email]
  }
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_alert_email]
  }
}

output "certificate_validation" {
  description = "Create these CNAME records at the DNS provider so ACM can issue the certificate."
  value = [for o in aws_acm_certificate.main.domain_validation_options : {
    name  = o.resource_record_name
    type  = o.resource_record_type
    value = o.resource_record_value
  }]
}

output "dns_records" {
  description = "Point these host names (CNAME or alias) at the load balancer."
  value = {
    for host in [local.api_host, local.samakios_host, local.bluedata_host] : host => aws_lb.main.dns_name
  }
}

output "ecr_repositories" {
  value = { for name, repo in aws_ecr_repository.app : name => repo.repository_url }
}

output "deploy" {
  description = "Values for the deploy workflow (GitHub environment variables)."
  value = {
    aws_role_arn        = aws_iam_role.github_deploy.arn
    cluster             = aws_ecs_cluster.main.name
    private_subnets     = aws_subnet.private[*].id
    apps_security_group = aws_security_group.apps.id
    migrate_task        = aws_ecs_task_definition.migrate.family
    bootstrap_db_task   = aws_ecs_task_definition.bootstrap_db.family
    api_url             = "https://${local.api_host}"
  }
}

output "database_endpoint" {
  value = aws_db_instance.main.address
}
