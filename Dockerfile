# 视频下载器 Docker 镜像
# 基础: node:20-slim (Debian bookworm) + ffmpeg + python3 + yt-dlp(pip)
FROM node:20-slim

ENV NODE_ENV=production

# ffmpeg: 音视频合并; python3+pip: 运行 yt-dlp; ca-certificates: HTTPS
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg python3 python3-pip ca-certificates xdg-utils \
 && rm -rf /var/lib/apt/lists/*

# yt-dlp 官方推荐 pip 安装,可随时升级
RUN pip3 install --no-cache-dir --break-system-packages yt-dlp \
 && yt-dlp --version \
 && ffmpeg -version | head -n1

WORKDIR /app
# 只拷贝代码,不拷贝 Windows 的 tools/(镜像里用系统安装的 yt-dlp/ffmpeg)
COPY server.mjs ./
COPY public ./public
RUN mkdir -p downloads tmp

# downloads 挂卷持久化,重建镜像不丢文件
VOLUME ["/app/downloads"]
EXPOSE 8734

# 用 Node 自带的 fetch 做健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8734/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
