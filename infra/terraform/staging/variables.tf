variable "region" {
  type    = string
  default = "af-south-1" # ADR-010
}

variable "environment" {
  type    = string
  default = "staging"
}

variable "domain_name" {
  description = "Parent domain for this environment, e.g. staging.example.africa. Apps are served at api., samakios. and bluedata. under it."
  type        = string
}

variable "github_repository" {
  description = "owner/name of the GitHub repository allowed to deploy (OIDC), e.g. neshtosh/Bluedata-africa."
  type        = string
}

variable "create_github_oidc_provider" {
  description = "Create the account-wide GitHub OIDC provider. Set false if the account already has one."
  type        = bool
  default     = true
}

variable "image_tag" {
  description = "Image tag deployed for all services (set by the deploy pipeline to the git SHA)."
  type        = string
  default     = "bootstrap"
}

variable "budget_alert_email" {
  description = "Receives AWS Budgets alerts for this environment."
  type        = string
}

variable "monthly_budget_usd" {
  type    = number
  default = 250
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}
