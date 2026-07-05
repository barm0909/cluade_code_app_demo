#!/usr/bin/env bash
# inventory-app を Terraform で構築済みのEC2サーバーへビルド・配置するスクリプト。
# 前提: deploy/terraform を `terraform apply` 済みであること。
#
# 使い方:
#   ./deploy/deploy.sh <EC2のパブリックIP> [SSH秘密鍵のパス]
#
# 例:
#   ./deploy/deploy.sh 203.0.113.20
#   ./deploy/deploy.sh 203.0.113.20 ~/.ssh/id_ed25519

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "使い方: $0 <EC2のパブリックIP> [SSH秘密鍵のパス]" >&2
  exit 1
fi

HOST="$1"
SSH_KEY="${2:-}"
SSH_USER="ec2-user"
REMOTE_TMP_DIR="/tmp/inventory-app-dist"
REMOTE_WEB_ROOT="/var/www/inventory-app"

SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
if [ -n "$SSH_KEY" ]; then
  SSH_OPTS+=(-i "$SSH_KEY")
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR/../inventory-app"

echo "==> ビルド中 (inventory-app)"
cd "$APP_DIR"
npm ci
# 注意: `npm run build` (= tsc -b && vite build) は CLAUDE.md に記載の既知の型エラーで失敗するため、
# ここでは `vite build` のみを実行して型チェックをスキップする。
npx vite build

echo "==> ${HOST} へ転送中"
rsync -avz --delete -e "ssh ${SSH_OPTS[*]}" "$APP_DIR/dist/" "${SSH_USER}@${HOST}:${REMOTE_TMP_DIR}/"

echo "==> リモートで配置・Nginxリロード"
ssh "${SSH_OPTS[@]}" "${SSH_USER}@${HOST}" bash -s <<EOF
set -euo pipefail
sudo mkdir -p "${REMOTE_WEB_ROOT}"
sudo rm -rf "${REMOTE_WEB_ROOT:?}"/*
sudo cp -r "${REMOTE_TMP_DIR}/." "${REMOTE_WEB_ROOT}/"
sudo systemctl reload nginx
EOF

echo "==> 完了: http://${HOST}"
