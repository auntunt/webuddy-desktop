#!/usr/bin/env bash
# 在每台开发机（macOS）上配置采集端：指向 HTTPS 入口 + 定时上报。
#
#   DOMAIN=logs.example.com TOKEN=xxx ./install-macos.sh
#   DOMAIN=logs.example.com TOKEN=xxx USER_ID=lina ./install-macos.sh
#
# 幂等：重复运行只会覆盖配置和 LaunchAgent。
set -euo pipefail

DOMAIN="${DOMAIN:?set DOMAIN=<接入域名>}"
TOKEN="${TOKEN:?set TOKEN=<ingest token>}"
USER_ID="${USER_ID:-$(id -un)}"
INTERVAL="${INTERVAL:-1800}"          # 秒，默认 30 分钟
HERE="$(cd "$(dirname "$0")" && pwd)"
LABEL="cn.cloudwave.webuddy-agent"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE_BIN="$(command -v node)"

echo "== 配置采集端 =="
node "$HERE/index.mjs" config set "userId=$USER_ID" >/dev/null
node "$HERE/index.mjs" config set "endpoint=https://$DOMAIN/api/ingest" >/dev/null
node "$HERE/index.mjs" config set "token=$TOKEN" >/dev/null

echo "== 校验连通性（https + 鉴权） =="
curl -fsS "https://$DOMAIN/api/health" >/dev/null && echo "  TLS + 服务可达 OK"

echo "== 首次采集 =="
node "$HERE/index.mjs" scan >/dev/null
node "$HERE/index.mjs" push

echo "== 安装定时任务（每 $((INTERVAL / 60)) 分钟） =="
mkdir -p "$(dirname "$PLIST")"
cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-lc</string>
    <string>cd '$HERE' && '$NODE_BIN' index.mjs scan && '$NODE_BIN' index.mjs push</string>
  </array>
  <key>StartInterval</key><integer>$INTERVAL</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$HOME/.webuddy-agent.log</string>
  <key>StandardErrorPath</key><string>$HOME/.webuddy-agent.log</string>
</dict>
</plist>
PLIST_EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "  已加载 $LABEL"
echo
echo "完成。查看日志：tail -f ~/.webuddy-agent.log"
