# 在上游源码上注入「服务器存储」面板后构建前端。
# 构建上下文是 /srv/apps/excalidraw(需包含 build/src 上游源码与本目录 web/ 下的补丁文件)。
FROM node:24-bookworm-slim AS build

WORKDIR /opt/node_app

COPY build/src/ ./
COPY web/ServerStorage.tsx ./excalidraw-app/components/ServerStorage.tsx
COPY web/serverStorageApi.ts ./excalidraw-app/components/serverStorageApi.ts
COPY web/patch.mjs ./patch.mjs

# 自建实例没有 Excalidraw+ 账号,关掉该入口(否则点「导出到 Excalidraw+」必然报错)
RUN sed -i "s|^VITE_APP_PLUS_APP=.*|VITE_APP_PLUS_APP=|" .env.production

# 锚点不在就失败:宁可构建不通过,也不要产出没有存储面板的镜像
RUN node patch.mjs

RUN yarn config set registry https://registry.npmmirror.com \
 && yarn --frozen-lockfile --network-timeout 900000

ARG NODE_ENV=production
RUN yarn build:app:docker

FROM nginx:stable-alpine-slim

COPY --from=build /opt/node_app/excalidraw-app/build /usr/share/nginx/html
COPY web/nginx.conf /etc/nginx/conf.d/default.conf

HEALTHCHECK CMD wget -q -O /dev/null http://localhost/ || exit 1
