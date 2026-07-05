# Terraformのstateを保存するS3バケットを作成するブートストラップ構成。
# 本体(deploy/terraform)より先に、初回だけ apply する。
# この構成自体のstateはローカル管理でよい(バケット名等しか含まず機密情報がないため)。

terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  description = "stateバケットを作成するリージョン(本体と同じにすること)"
  type        = string
  default     = "ap-northeast-1"
}

variable "state_bucket_name" {
  description = "Terraform state用S3バケット名。全世界で一意である必要があるため、アカウントID等を含めること(例: inventory-app-tfstate-123456789012)"
  type        = string
}

resource "aws_s3_bucket" "tfstate" {
  bucket = var.state_bucket_name

  # state置き場を誤って destroy しないための保険
  lifecycle {
    prevent_destroy = true
  }
}

# 誤った上書き・削除からstateを守るためバージョニングを有効化
resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  versioning_configuration {
    status = "Enabled"
  }
}

# stateには basic_auth_password が平文で入るため、保存時暗号化を明示
resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

output "state_bucket_name" {
  description = "作成されたstateバケット名。deploy/terraform/backend.hcl の bucket に設定する"
  value       = aws_s3_bucket.tfstate.id
}
