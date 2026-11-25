terraform {
  required_version = ">= 1.10"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 6.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
  # Partial configuration: bucket and region come from backend.hcl (see backend.hcl.example).
  # use_lockfile = S3-native state locking (no DynamoDB table needed).
  backend "s3" {
    key          = "staging/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project     = "blue-ecosystem"
      Environment = var.environment
      ManagedBy   = "opentofu"
    }
  }
}
