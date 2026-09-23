#!/usr/bin/env bash
# Put webuddy-server behind nginx + Let's Encrypt on this host.
#
#   DOMAIN=logs.example.com PORT=8790 ./enable-https.sh
#
# Requires root (writes /etc/nginx/conf.d, runs certbot). Idempotent: safe to
# re-run after a domain change. Does not touch any other vhost.
set -euo pipefail

DOMAIN="${DOMAIN:?set DOMAIN=<the hostname you pointed at this server>}"
PORT="${PORT:-8790}"
HERE="$(cd "$(dirname "$0")" && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "must run as root (nginx + certbot). try: sudo DOMAIN=$DOMAIN $0" >&2
  exit 1
fi

echo "== upstream check =="
curl -fsS "http://127.0.0.1:$PORT/api/health"
echo

echo "== writing vhost for $DOMAIN =="
sed "s/logs\.cloudwaveai\.cn/$DOMAIN/" "$HERE/nginx.conf.example" \
  | sed "s/127\.0\.0\.1:8790/127.0.0.1:$PORT/" \
  > /etc/nginx/conf.d/webuddylog.conf

nginx -t
systemctl reload nginx

echo "== issuing certificate =="
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect --keep-until-expiring

echo "== verifying TLS =="
curl -fsS "https://$DOMAIN/api/health"
echo
echo "done. dashboard: https://$DOMAIN/"
