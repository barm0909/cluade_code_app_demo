terraform {
  # use_lockfile(S3ネイティブのstateロック)に1.10以上が必要
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # bucket / region は backend.hcl で指定する(terraform init -backend-config=backend.hcl)
  backend "s3" {
    key          = "inventory-app/terraform.tfstate"
    use_lockfile = true
  }
}

provider "aws" {
  region = var.aws_region
}
