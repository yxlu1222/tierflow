#!/usr/bin/env bash
# 一键重建并重启 13000 端口的 new-api 测试样例。
# 适用场景：改完 web/default/ 前端后，跑这一条命令即可看到更新。
#   1) Docker(oven/bun) 重新构建 web/default/dist
#   2) Docker(golang)   重新编译内嵌前端的 Go 二进制（输出到 tmp_newapi_server.build）
#   3) 替换二进制 + 调用 run-test-13000.sh 重启
# 依赖：本机 docker（免 sudo），镜像 oven/bun:1 与 golang:1.26.1-alpine。
# 可选环境变量：GO_CACHE(默认 ~/go-cache) / GOPROXY(默认 goproxy.cn)。
set -euo pipefail
cd "$(dirname "$0")"
ROOT=$(pwd)

BUN_IMG=oven/bun:1
GO_IMG=golang:1.26.1-alpine
GO_CACHE="${GO_CACHE:-$HOME/go-cache}"
VERSION=$(cat VERSION 2>/dev/null || echo "")

echo "==> [1/3] 构建前端 web/default/dist ..."
# main.go 只 go:embed web/default/dist(classic 前端已删除)。
docker run --rm \
  -v "$ROOT/web:/build/web" \
  -w /build/web \
  -e DISABLE_ESLINT_PLUGIN=true \
  -e VITE_REACT_APP_VERSION="$VERSION" \
  "$BUN_IMG" \
  sh -c "bun install --frozen-lockfile && (cd default && bun run build)"

echo "==> [2/3] 编译 Go 二进制（内嵌新 dist）..."
mkdir -p "$GO_CACHE/mod" "$GO_CACHE/build"
rm -f tmp_newapi_server.build
docker run --rm \
  -v "$ROOT:/build" \
  -v "$GO_CACHE/mod:/go/pkg/mod" \
  -v "$GO_CACHE/build:/root/.cache/go-build" \
  -w /build \
  -e GO111MODULE=on -e CGO_ENABLED=0 -e GOOS=linux -e GOARCH=amd64 \
  -e GOEXPERIMENT=greenteagc \
  -e GOPROXY="${GOPROXY:-https://goproxy.cn,direct}" \
  -e GOFLAGS=-buildvcs=false \
  "$GO_IMG" \
  go build -ldflags "-s -w -X 'github.com/Zer0Echo/tierflow-core/common.Version=$VERSION'" -o tmp_newapi_server.build

echo "==> 替换二进制（rename 不受运行中旧进程影响）..."
mv -f tmp_newapi_server.build tmp_newapi_server

echo "==> [3/3] 重启 13000 ..."
./run-test-13000.sh

echo "完成。浏览器访问 http://<本机IP>:13000/ 并强刷(Ctrl+Shift+R)查看更新。"
