# 自建薄壳:官方 @excalidraw/excalidraw 组件 + 我们的存储面板。
# 不修改上游源码:升级只改 package.json 里的版本号,然后重建本镜像(约 1-2 分钟)。
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm config set registry https://registry.npmmirror.com && npm install --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npx tsc --noEmit && npm run build

FROM nginx:stable-alpine-slim
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
HEALTHCHECK CMD wget -q -O /dev/null http://localhost/ || exit 1
