# webuddy-server — 零依赖 Node 服务，容器内只跑一个进程。
# node:24 起 node:sqlite 无需 flag（22.5~23.3 需要 --experimental-sqlite）。

# 阶段一：构建 React 看板（依赖只存在于这一阶段）
FROM node:24-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build   # 产物写入 /src/public

# 阶段二：运行时仍然零第三方依赖，只拷源码和构建产物
FROM node:24-alpine

WORKDIR /app

COPY server.mjs package.json ./
COPY lib ./lib
COPY --from=web /src/public ./public

ENV WEBUDDY_HOST=0.0.0.0 \
    WEBUDDY_PORT=8790 \
    WEBUDDY_DATA=/data

RUN mkdir -p /data

EXPOSE 8790

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:8790/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
