# 文件用途：CloudBase 云托管 / 容器部署镜像，只承载小程序所需的 /api/* 服务。
FROM node:20-bookworm-slim

WORKDIR /app

# FFmpeg 用于视频号音频提取（语音转文案）。
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY backend/package.json backend/package-lock.json ./backend/
RUN npm --prefix backend ci --omit=dev

COPY backend ./backend

# 密钥不进镜像：OCR / TikHub / 腾讯云 ASR 均通过运行环境变量注入。
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=80
EXPOSE 80

CMD ["node", "backend/server.js"]
