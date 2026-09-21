#!/usr/bin/env bash
# Deploy webuddy-server to the log host as a Docker container.
#
#   TOKEN=xxx ./deploy.sh
#   HOST=zct-server PORT=8790 TOKEN=xxx ./deploy.sh
#
# Matches the host's existing convention: container publishes to 127.0.0.1 only,
# nginx terminates TLS in front of it. Data lives in ./data (bind mount).
set -euo pipefail

HOST="${HOST:-zct-server}"
REMOTE_DIR="${REMOTE_DIR:-/home/Liyibin/services/webuddy-server}"
PORT="${PORT:-8790}"
NAME="${NAME:-webuddy-log}"
ADMIN_USER="${ADMIN_USER:-admin}"
# Why required: the first boot needs an account, and creating users requires one.
ADMIN_PASSWORD="${ADMIN_PASSWORD:?set ADMIN_PASSWORD=<admin password>}"

HERE="$(cd "$(dirname "$0")/.." && pwd)"

echo "== shipping code to $HOST:$REMOTE_DIR =="
tar -C "$HERE" -czf - server.mjs lib public deploy package.json README.md Dockerfile docker-compose.yml \
  | ssh "$HOST" "mkdir -p '$REMOTE_DIR' && tar -xzf - -C '$REMOTE_DIR' && chmod +x '$REMOTE_DIR/deploy/'*.sh"

echo "== updating server-side env (mode 600, merge — never clobber secrets) =="
# Why merge instead of overwrite: this file also holds the model credentials.
# Rewriting it wholesale silently disabled analysis on every deploy.
ADMIN_USER="$ADMIN_USER" ADMIN_PASSWORD="$ADMIN_PASSWORD" REMOTE_DIR="$REMOTE_DIR" \
  ssh "$HOST" 'umask 077; ENVF="'"$REMOTE_DIR"'/.env"
    touch "$ENVF"
    grep -v "^WEBUDDY_ADMIN_USER=\|^WEBUDDY_ADMIN_PASSWORD=" "$ENVF" > "$ENVF.tmp" 2>/dev/null || true
    printf "WEBUDDY_ADMIN_USER=%s\n" "$ADMIN_USER" >> "$ENVF.tmp"
    printf "WEBUDDY_ADMIN_PASSWORD=%s\n" "$ADMIN_PASSWORD" >> "$ENVF.tmp"
    chmod 600 "$ENVF.tmp"; mv "$ENVF.tmp" "$ENVF"
    echo "  env keys kept: $(grep -c . "$ENVF") lines"'

echo "== retiring the earlier PM2 process (if it is still around) =="
ssh "$HOST" "pm2 delete '$NAME' >/dev/null 2>&1 && pm2 save >/dev/null && echo '  pm2 process removed' || echo '  no pm2 process'"

echo "== building + starting container =="
ssh "$HOST" "cd '$REMOTE_DIR' && mkdir -p data && docker compose up -d --build --remove-orphans 2>&1 | tail -5"

echo "== health =="
ssh "$HOST" "sleep 2; curl -fsS 'http://127.0.0.1:$PORT/api/health'"
echo
ssh "$HOST" "docker ps --filter name='$NAME' --format '  {{.Names}}  {{.Status}}  {{.Ports}}'"
echo "done."
