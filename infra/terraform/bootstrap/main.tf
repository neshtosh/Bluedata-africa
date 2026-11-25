# Creates the S3 bucket that holds OpenTofu state for every environment. Applied once, by hand,
# with local state (this directory's state file is small and contains no secrets; keep it safe
# or import the bucket later). Everything else uses the S3 backend this creates.

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
}

variable "region" {
  type    = string
  default = "af-south-1"
}

variable "state_bucket_name" {
  description = "Globally unique bucket name, e.g. blue-ecosystem-tofu-state-<account-id>."
  type        = string
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = "blue-ecosystem", ManagedBy = "opentofu", Purpose = "tofu-state" }
  }
}

resource "aws_s3_bucket" "state" {
  bucket = var.state_bucket_name
  lifecycle { prevent_destroy = true }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

output "state_bucket" {
  value = aws_s3_bucket.state.bucket
}
