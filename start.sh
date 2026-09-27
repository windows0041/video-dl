#!/usr/bin/env bash
# 视频下载器启动脚本(Linux 本地使用,非 Docker)
# 依赖: node (>=18)、yt-dlp、ffmpeg(系统安装,或放入本目录 tools/ 下)
set -e
cd "$(dirname "$0")"
PORT="${PORT:-8734}"

# 后台延迟 1 秒打开浏览器(部分环境没有 xdg-open 就跳过)
if command -v xdg-open >/dev/null 2>&1; then
  ( sleep 1 && xdg-open "http://127.0.0.1:${PORT}" ) >/dev/null 2>&1 &
fi

exec node server.mjs
