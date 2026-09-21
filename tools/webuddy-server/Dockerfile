# webuddy-server — 零依赖 Node 服务，容器内只跑一个进程。
# node:24 起 node:sqlite 无需 flag（22.5~23.3 需要 --experimental-sqlite）。
FROM node:24-alpine

WORKDIR /app

# 无第三方依赖，只拷源码
COPY server.mjs package.json ./
COPY lib ./lib
COPY public ./public

ENV WEBUDDY_HOST=0.0.0.0 \
    WEBUDDY_PORT=8790 \
    WEBUDDY_DATA=/data

RUN mkdir -p /data

EXPOSE 8790

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:8790/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
