#!/usr/bin/env bash
# 部署 relay（手机控制桌面）到日志服务器。
#
#   ADMIN_PASSWORD=xxx ./deploy-relay.sh
#
# Why 用 origin 根而不是 /relay 子路径：relay 校验 ORCA_RELAY_PUBLIC_URL
# 必须是「origin」（scheme+host+port，不接受路径），所以它挂在域名根上，
# 由 nginx 按路径分流 —— webuddy-server 用 /api/* 与静态文件，relay 用 /v1/*、
# /health、/ready，两者不重叠。
#
# 为什么不用独立端口（:8443）：能过校验，但要在阿里云安全组开端口；
# 走 443 路径分流则完全不用动网络配置。
set -euo pipefail

HOST="${HOST:-zct-server}"
REMOTE_DIR="${REMOTE_DIR:-/home/Liyibin/relay-build}"
DATA_DIR="${DATA_DIR:-/home/Liyibin/relay-data}"
PUBLIC_URL="${PUBLIC_URL:-https://webuddyserver.cloudwaveai.cn}"
PORT="${PORT:-8791}"
HERE="$(cd "$(dirname "$0")/../.." && pwd)"   # 仓库根

echo "== 1) 打包 relay 构建上下文（只传 monorepo 里必要的三个目录）=="
tar -C "$HERE/cloud" -czf /tmp/relay-build.tgz \
  package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json \
  apps/relay packages/relay-contract packages/postgres-schema

ssh "$HOST" "rm -rf '$REMOTE_DIR' && mkdir -p '$REMOTE_DIR'"
cat /tmp/relay-build.tgz | ssh "$HOST" "tar -xzf - -C '$REMOTE_DIR'"

echo "== 2) 构建镜像 =="
ssh "$HOST" "cd '$REMOTE_DIR' && docker build -f apps/relay/Dockerfile -t webuddy-relay:latest ."

echo "== 3) 启动容器（单 cell + SQLite）=="
# Why 权限 777：容器内是 node(uid 1000)，宿主机是 Liyibin(uid 1001)；
# 且若让 docker 自己建挂载目录，目录会属 root，容器写不进去（踩过一次）。
ssh "$HOST" "mkdir -p '$DATA_DIR' && chmod 777 '$DATA_DIR'"

SIGNING_KEY="$(head -c 48 /dev/urandom | base64 | tr -d '\n=+/' | cut -c1-40)"
ssh "$HOST" "docker rm -f webuddy-relay >/dev/null 2>&1 || true
docker run -d --name webuddy-relay --restart unless-stopped \
  -p 127.0.0.1:$PORT:8080 \
  -v '$DATA_DIR':/data/relay \
  -e ORCA_RELAY_PUBLIC_URL='$PUBLIC_URL' \
  -e ORCA_RELAY_CELL_URL='$PUBLIC_URL' \
  -e ORCA_RELAY_CELL_ID=combined \
  -e ORCA_RELAY_AUTH_ISSUER='$PUBLIC_URL' \
  -e ORCA_RELAY_AUTH_AUDIENCE=orca-relay \
  -e ORCA_RELAY_JWKS_URL='$PUBLIC_URL/api/relay/jwks' \
  -e ORCA_RELAY_ASSIGNMENT_SIGNING_KEY='$SIGNING_KEY' \
  -e ORCA_RELAY_DATA_DIR=/data/relay \
  -e ORCA_RELAY_ADMIN_AUDIENCE='$PUBLIC_URL' \
  -e ORCA_RELAY_DEPLOY_SERVICE_ACCOUNT=deploy@webuddy.internal \
  webuddy-relay:latest >/dev/null
sleep 8
docker logs webuddy-relay 2>&1 | tail -3"

echo "== 4) 健康检查 =="
ssh "$HOST" "curl -s -m 5 http://127.0.0.1:$PORT/health"
echo
echo "done. 经 nginx 的验收："
echo "  curl -s --http1.1 -o /dev/null -w '%{http_code}\n' \\"
echo "    -H 'Upgrade: websocket' -H 'Connection: Upgrade' \\"
echo "    -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \\"
echo "    -H \"authorization: Bearer <relay token>\" $PUBLIC_URL/v1/host/control"
echo "  期望 101（无 token 则 401）"
