# Boltwork sync server, with the web vault (off unless WEB_VAULT=on).
# Build from the repository root: docker build -f server/Dockerfile -t boltwork-server .
FROM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
# No install scripts: nothing here needs the desktop app's Electron download.
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
COPY server/src ./server/src
RUN node scripts/build.mjs --server

FROM node:24-alpine
WORKDIR /app
COPY --from=build /src/server/dist/server.js ./server.js
COPY --from=build /src/dist-web ./web
RUN mkdir /data && chown node:node /data
ENV NODE_ENV=production DATA_DIR=/data PORT=8787 SIGNUPS=first WEB_VAULT=off
VOLUME /data
EXPOSE 8787
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/health >/dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
