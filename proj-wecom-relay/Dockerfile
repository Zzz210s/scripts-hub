FROM node:24-alpine

WORKDIR /app

# 只装生产依赖;SDK 版本由 package-lock 锁住(生产镜像里不装 devDependencies)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

ENV NODE_ENV=production
EXPOSE 9099

# 只监听 127.0.0.1(compose 里用 host 网络时也如此),不对外开端口
CMD ["node", "src/relay.mjs"]
