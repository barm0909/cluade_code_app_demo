# AWSインフラ構成(EC2インスタンス設定)

`deploy/terraform/` で構築されるAWSリソースの設定内容をまとめたドキュメントです。
デプロイの実行手順は [aws-deploy.md](./aws-deploy.md) を参照してください。
Terraformコードを変更した場合は、このドキュメントも合わせて更新すること。

## 構成図

```
インターネット
    │
    │ HTTP :80 (全IP許可 / Basic認証あり)
    │ SSH  :22 (admin_ssh_cidr のみ許可)
    ▼
Elastic IP (固定グローバルIP)
    │
    ▼
EC2インスタンス (inventory-app-web)
  Amazon Linux 2023 / t3.micro
  └─ Nginx ── /var/www/inventory-app (SPAの静的ファイル)
    [デフォルトVPC / デフォルトサブネット]
```

## EC2インスタンス

| 項目 | 設定値 | 備考 |
|------|--------|------|
| Nameタグ | `inventory-app-web` | `${project_name}-web` |
| AMI | Amazon Linux 2023 (x86_64) 最新版 | `al2023-ami-*-x86_64` をデータソースで自動解決。applyのたびに最新AMIを参照するため、AMI更新時はインスタンス再作成になる |
| インスタンスタイプ | `t3.micro` | 変数 `instance_type` で変更可 |
| サブネット | デフォルトVPCの先頭サブネット | 専用VPCは作成せず、既存のデフォルトVPCを利用 |
| ルートボリューム | gp3 / 8GiB | 変数 `root_volume_size` で変更可 |
| SSH鍵ペア | `inventory-app-key` | `ssh_public_key_path` の公開鍵を登録。接続ユーザーは `ec2-user` |
| パブリックIP | Elastic IP (`inventory-app-web-eip`) | インスタンスの停止・再起動でIPが変わらないよう固定 |

## セキュリティグループ (`inventory-app-web-sg`)

| 方向 | ポート | プロトコル | 許可範囲 | 用途 |
|------|--------|-----------|----------|------|
| インバウンド | 80 | TCP | `0.0.0.0/0` (全IP) | HTTP。ただしNginxのBasic認証で閲覧を制限 |
| インバウンド | 22 | TCP | `admin_ssh_cidr` で指定したCIDRのみ | SSH(管理・デプロイ用) |
| アウトバウンド | 全て | 全て | `0.0.0.0/0` | パッケージ取得等 |

- HTTPS(443)は開けていない。TLS化する場合はドメイン取得 + 証明書(Let's Encrypt等)の設定が別途必要。
- SSHの許可元IPが変わった場合は `terraform.tfvars` の `admin_ssh_cidr` を更新して `terraform apply`。

## アクセス制限(Basic認証)

- サイト全体にNginxのBasic認証をかけている(`auth_basic` / `auth_basic_user_file`)。
- 認証情報は変数 `basic_auth_username` / `basic_auth_password` で設定し、
  Terraformの `bcrypt()` でハッシュ化した上で、初回起動時に `/etc/nginx/.htpasswd`
  (所有者 `root:nginx`、権限 640)へ書き込まれる。平文パスワードはサーバーに保存されない。
- パスワードは `terraform.tfvars`(gitignore済み)とTerraformのstateにのみ存在する。
  stateファイルの管理にも注意すること。

## 初回起動時のプロビジョニング(user_data)

インスタンス初回起動時に `deploy/terraform/user_data.sh.tpl` が cloud-init 経由で実行され、
以下をセットアップする。**user_dataは初回起動時のみ実行される**点に注意
(変更して `terraform apply` するとインスタンスが再作成される)。

1. `dnf install nginx` でNginxをインストール
2. ドキュメントルート `/var/www/inventory-app` を作成(所有者 `ec2-user`)
3. `deploy/nginx/inventory-app.conf` の内容を `/etc/nginx/conf.d/inventory-app.conf` に配置
4. Basic認証用の `/etc/nginx/.htpasswd` を作成
5. プレースホルダーの `index.html` を配置(初回デプロイ前でも動作確認できるように)
6. `systemctl enable nginx && systemctl restart nginx`

## Nginx設定 (`deploy/nginx/inventory-app.conf`)

| 項目 | 設定 |
|------|------|
| listen | 80 (default_server) |
| ドキュメントルート | `/var/www/inventory-app` |
| SPAフォールバック | `try_files $uri $uri/ /index.html`(直リンク・リロード対応) |
| Basic認証 | サイト全体(`auth_basic_user_file /etc/nginx/.htpasswd`) |
| gzip | 有効(css / js / json / svg) |

設定を変更した場合、既存インスタンスには自動反映されない(user_dataは初回のみのため)。
SSHで入って `/etc/nginx/conf.d/inventory-app.conf` を直接更新して `sudo systemctl reload nginx`
するか、`terraform apply` でインスタンスを作り直す。

## サーバー上のファイル配置

| パス | 内容 |
|------|------|
| `/var/www/inventory-app/` | アプリの静的ファイル(`deploy.sh` が `dist/` を配置) |
| `/etc/nginx/conf.d/inventory-app.conf` | Nginxのサイト設定 |
| `/etc/nginx/.htpasswd` | Basic認証の認証情報(bcryptハッシュ) |
| `/tmp/inventory-app-dist/` | `deploy.sh` のrsync転送先(一時領域) |

## Terraform変数一覧

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `aws_region` | `ap-northeast-1` | 構築先リージョン |
| `project_name` | `inventory-app` | リソース名のプレフィックス |
| `instance_type` | `t3.micro` | EC2インスタンスタイプ |
| `ssh_public_key_path` | (必須) | SSH公開鍵のパス |
| `admin_ssh_cidr` | (必須) | SSHを許可するCIDR(`x.x.x.x/32` 推奨) |
| `root_volume_size` | `8` | ルートEBSサイズ(GiB) |
| `basic_auth_username` | `admin` | Basic認証のユーザー名 |
| `basic_auth_password` | (必須, sensitive) | Basic認証のパスワード |

## Terraform出力

| 出力 | 内容 |
|------|------|
| `public_ip` | Elastic IPのグローバルIP |
| `url` | アプリのURL(`http://<public_ip>`) |
| `ssh_command` | SSH接続コマンド(`ssh ec2-user@<public_ip>`) |

## 運用メモ

- **Basic認証のパスワード変更**: `terraform.tfvars` の `basic_auth_password` を変更して
  `terraform apply`(user_data変更のためインスタンス再作成 → 再作成後に `deploy.sh` を再実行)。
  再作成を避けたい場合はSSHで入り `sudo htpasswd -B /etc/nginx/.htpasswd <ユーザー名>` で直接更新する
  (要 `dnf install httpd-tools`)。
- **アプリの更新**: `./deploy/deploy.sh <public_ip> <ssh鍵>` を再実行するだけ。インフラ操作は不要。
- **インスタンス再作成時**: Elastic IPは自動で新インスタンスに付け替わるが、
  ホスト鍵が変わるためSSH時に既知ホストの警告が出る場合がある。
  また、コンテンツはプレースホルダーに戻るので `deploy.sh` の再実行が必要。
- **データについて**: アプリのデータは各利用者のブラウザのlocalStorageに保存されるため、
  サーバー側にはバックアップすべきデータは存在しない。
