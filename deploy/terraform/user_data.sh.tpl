#!/bin/bash
set -euxo pipefail

dnf install -y nginx

mkdir -p /var/www/inventory-app
chown -R ec2-user:ec2-user /var/www/inventory-app

cat > /etc/nginx/conf.d/inventory-app.conf <<'NGINX_CONF'
${nginx_conf}
NGINX_CONF

rm -f /etc/nginx/conf.d/default.conf

cat > /var/www/inventory-app/index.html <<'HTML'
<!doctype html><html><body><h1>inventory-app: waiting for first deploy</h1><p>deploy/deploy.sh を実行してください。</p></body></html>
HTML

systemctl enable nginx
systemctl restart nginx
