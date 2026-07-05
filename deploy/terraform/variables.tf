variable "aws_region" {
  description = "Webサーバーを構築するAWSリージョン"
  type        = string
  default     = "ap-northeast-1"
}

variable "project_name" {
  description = "リソース名のプレフィックスとして使う識別子"
  type        = string
  default     = "inventory-app"
}

variable "instance_type" {
  description = "EC2インスタンスタイプ"
  type        = string
  default     = "t3.micro"
}

variable "ssh_public_key_path" {
  description = "EC2にSSH接続するための公開鍵ファイルのパス(例: ~/.ssh/id_ed25519.pub)"
  type        = string
}

variable "admin_ssh_cidr" {
  description = "SSH(22番ポート)接続を許可するCIDR。自分のグローバルIPを \"x.x.x.x/32\" の形式で指定すること(curl ifconfig.me で確認可能)。0.0.0.0/0は非推奨。"
  type        = string
}

variable "root_volume_size" {
  description = "ルートEBSボリュームサイズ(GiB)"
  type        = number
  default     = 8
}

variable "basic_auth_username" {
  description = "サイト全体にかけるBasic認証のユーザー名"
  type        = string
  default     = "admin"
}

variable "basic_auth_password" {
  description = "サイト全体にかけるBasic認証のパスワード。terraform.tfvarsにのみ記載しコミットしないこと。"
  type        = string
  sensitive   = true
}
