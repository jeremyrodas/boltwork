# Strongroom sync server. Build: docker build -t strongroom-server .  (run from this folder)
FROM node:24-alpine AS build
WORKDIR /src
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY src ./src
RUN npm run build

FROM node:24-alpine
WORKDIR /app
COPY --from=build /src/dist/server.js ./server.js
RUN mkdir /data && chown node:node /data
ENV NODE_ENV=production DATA_DIR=/data PORT=8787 SIGNUPS=first
VOLUME /data
EXPOSE 8787
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/health >/dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
