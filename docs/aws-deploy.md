# AWSへのデプロイ手順(EC2 + Nginx)

`inventory-app` はバックエンドを持たない静的SPAなので、ビルド成果物(`dist/`)を
EC2上のNginxで配信する構成でAWSにデプロイします。インフラは
`deploy/terraform/` のTerraformコードで構築し、アプリのビルド・配置は
`deploy/deploy.sh` で行います。

構成は以下の通りです。

- EC2インスタンス1台(Amazon Linux 2023, デフォルトVPC/デフォルトサブネットを使用)
- Nginxで `dist/` の静的ファイルを配信(SPA用に `try_files` でindex.htmlにフォールバック)
- Elastic IPで固定グローバルIPを付与
- セキュリティグループ: 80番(HTTP)は全開放、22番(SSH)は指定したCIDRのみ許可
- サイト全体にNginxのBasic認証をかけ、ID/パスワードを知らないと閲覧できないよう制限

GitHub Actions等のCI/CDは組み込んでおらず、手動デプロイを前提としています。

## 前提条件

- AWS CLIの認証情報が設定済みであること(`aws configure` 済み、またはSSO/環境変数)
- [Terraform](https://developer.hashicorp.com/terraform/install) (>= 1.5)
- SSH鍵ペア(なければ `ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519` で作成)
- ローカルに `rsync` があること

## 1. インフラを構築する

```bash
cd deploy/terraform
cp terraform.tfvars.example terraform.tfvars
```

`terraform.tfvars` を編集し、以下を自分の環境に合わせる。

- `ssh_public_key_path`: 上記で作成/用意したSSH公開鍵のパス
- `admin_ssh_cidr`: `curl ifconfig.me` で確認した自分のグローバルIPを `x.x.x.x/32` の形式で指定(SSHを許可する範囲。`0.0.0.0/0` は非推奨)
- `basic_auth_username` / `basic_auth_password`: サイト全体にかけるBasic認証の認証情報。`basic_auth_password` は強いパスワードに変更すること(`terraform.tfvars` はgitignore済みでコミットされない)

```bash
terraform init
terraform apply
```

適用後、出力される `public_ip` (Elastic IP) と `ssh_command` を控えておく。
この時点ではNginxは起動しているが、コンテンツは未配置のプレースホルダーページのみ。

## 2. アプリをビルドしてデプロイする

リポジトリルートから実行する。

```bash
./deploy/deploy.sh <terraform applyで出力されたpublic_ip> ~/.ssh/id_ed25519
```

このスクリプトは以下を行う。

1. `inventory-app` で `npm ci`
2. `npx vite build` でビルド(**`npm run build` ではなく `vite build` を直接実行**。理由は下記「既知の問題」を参照)
3. `dist/` をEC2に `rsync` で転送
4. リモートで `/var/www/inventory-app` に配置し、`nginx` をリロード

完了後、`http://<public_ip>` にブラウザでアクセスして動作確認する。
アクセス時にBasic認証のダイアログが表示されるので、`terraform.tfvars` に設定した
`basic_auth_username` / `basic_auth_password` を入力する。

コードを更新した際は、再度 `./deploy/deploy.sh <public_ip> <ssh鍵>` を実行するだけでよい
(インフラの再構築は不要)。

## 既知の問題: `npm run build` が失敗する

CLAUDE.mdに記載の通り、`npm run build`(= `tsc -b && vite build`)は
`useInventory.ts` のオブジェクトスプレッドでの `warehouseId` 重複や、
一部テストファイルの型不足により `tsc -b` の時点で失敗する。これは既存の型エラーであり、
`vite build` 自体(esbuildによるトランスパイル)には影響しないため、
`deploy.sh` では `npx vite build` を直接呼び出して型チェックをスキップしている。
型エラーを修正した場合は `deploy.sh` を `npm run build` に戻して問題ない。

## リソースの削除

```bash
cd deploy/terraform
terraform destroy
```

## コストの目安

- `t3.micro` インスタンス1台 + Elastic IP(インスタンスに紐付けている間は無料)+ 8GiB gp3 EBS
- 東京リージョンで概算 月数ドル程度(無料利用枠対象アカウントであれば実質無料〜わずか)。詳細は
  [AWS料金計算ツール](https://calculator.aws)で確認すること。
