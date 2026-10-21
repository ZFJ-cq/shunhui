FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip build-essential pkg-config cmake ninja-build ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --registry=https://registry.npmjs.org
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=33101
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY server ./server
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 33101/tcp 3002/tcp 40000-40100/udp 40000-40100/tcp
VOLUME ["/app/data"]
CMD ["node", "server/index.mjs"]
