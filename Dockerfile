# syntax=docker/dockerfile:1

# --- build ------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# better-sqlite3 compiles a native addon; alpine needs the toolchain for it.
RUN apk add --no-cache python3 make g++

# scripts/ comes first: package.json's "prepare" hook runs during `npm ci`,
# so the file it invokes has to exist before the install, not after.
COPY package.json package-lock.json* ./
COPY scripts ./scripts
RUN npm ci

COPY . .
RUN npm run build

# Reinstall production dependencies only, so the native addon is rebuilt
# against the same alpine/node the runtime image uses.
RUN npm ci --omit=dev

# --- runtime ----------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PANNBEN_DATA_DIR=/data \
    PANNBEN_PORT=8225 \
    PANNBEN_HOST=0.0.0.0

# Inside the container we bind all interfaces; the container's *published* port
# is pinned to loopback in compose, and Tailscale Serve fronts it.
# See docs/decisions/0002-transport-and-access.md.

RUN apk add --no-cache tini \
 && addgroup -g 10001 -S pannben \
 && adduser -u 10001 -S pannben -G pannben

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/package.json ./package.json

RUN mkdir -p /data && chown -R pannben:pannben /data /app
USER pannben
VOLUME ["/data"]
EXPOSE 8225

HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PANNBEN_PORT||8225)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server/index.js"]
