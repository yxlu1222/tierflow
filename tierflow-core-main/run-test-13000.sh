#!/usr/bin/env bash
# 启动/重启 13000 端口的 new-api 测试样例（裸二进制 tmp_newapi_server）。
# 用法: ./run-test-13000.sh   先停掉旧进程，再以相同环境后台拉起。
# 敏感值(INFERENCE_SERVICE_SECRET)从本目录 .env 读取，不写进脚本（.env 已 gitignore）。
set -euo pipefail
cd "$(dirname "$0")"

BIN=./tmp_newapi_server
LOG=/tmp/newapi-test/server.log
mkdir -p /tmp/newapi-test

# 仅从 .env 取推理服务密钥（不污染其它运行环境）
if [ -f .env ]; then
  INFERENCE_SERVICE_SECRET=$(grep -E '^INFERENCE_SERVICE_SECRET=' .env | head -1 | cut -d= -f2- || true)
fi

# 停掉已在跑的旧实例
OLD=$(pgrep -f 'tmp_newapi_server$' || true)
if [ -n "$OLD" ]; then
  echo "stopping old server: $OLD"
  kill $OLD 2>/dev/null || true
  for _ in $(seq 1 20); do pgrep -f 'tmp_newapi_server$' >/dev/null || break; sleep 0.3; done
fi

# 测试样例专用配置（端口/库/推理服务指向本机）
export PORT=13000
export SQLITE_PATH=/tmp/newapi-test/fullstack.db
export INFERENCE_SERVICE_URL="${INFERENCE_SERVICE_URL:-http://127.0.0.1:8001}"
export INFERENCE_SERVICE_TIMEOUT_MS="${INFERENCE_SERVICE_TIMEOUT_MS:-20000}"
export INFERENCE_SERVICE_SECRET="${INFERENCE_SERVICE_SECRET:-}"
export TZ="${TZ:-Asia/Shanghai}"
# 磁盘静态资源目录(与生产容器的 /app/public 等价,这里指向宿主机目录)
export STATIC_ROOT="${STATIC_ROOT:-$(pwd)/data/public}"

echo "starting $BIN on :$PORT (log: $LOG)"
setsid nohup "$BIN" >"$LOG" 2>&1 < /dev/null &
echo "started pid $!  ->  http://127.0.0.1:$PORT/"
