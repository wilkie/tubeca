# syntax=docker/dockerfile:1

# ---- build: compile the SPA, the backend bundle and the Prisma client ----
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
# Prisma's config needs a DATABASE_URL at build time; it is not used at runtime.
RUN echo 'DATABASE_URL="file:./prisma/build.db"' > backend/.env \
 && pnpm install --frozen-lockfile \
 && pnpm build \
 && rm backend/.env

# ---- runtime: node + ffmpeg, everything under /app, state under /data ----
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app

ENV NODE_ENV=production \
    TUBECA_ROLE=all \
    PORT=3000 \
    UV_THREADPOOL_SIZE=24 \
    DATABASE_URL=file:/data/tubeca.db \
    TUBECA_CONFIG_PATH=/data/tubeca.config.json \
    FRONTEND_DIST=/app/frontend/ui/dist \
    REDIS_HOST=redis

# /data holds the SQLite database, tubeca.config.json (optional) and, if the
# config points there, images and the HLS cache. Mount media read-only under /media.
VOLUME ["/data"]
EXPOSE 3000

COPY docker/entrypoint.sh /usr/local/bin/tubeca-entrypoint
RUN chmod +x /usr/local/bin/tubeca-entrypoint
ENTRYPOINT ["tubeca-entrypoint"]
