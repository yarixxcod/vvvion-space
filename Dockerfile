FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NITRO_PRESET=node-server
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV NITRO_HOST=0.0.0.0
ENV NITRO_PORT=8080
COPY --from=build /app/.output ./.output
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=build /app/scripts/migration-plan.mjs ./scripts/migration-plan.mjs
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/.bin/yt-dlp /usr/local/bin/yt-dlp
RUN chmod 755 /usr/local/bin/yt-dlp \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
EXPOSE 8080
CMD ["sh", "-c", "i=0; until node scripts/migrate.mjs; do i=$((i+1)); if [ \"$i\" -ge 15 ]; then exit 1; fi; sleep 2; done; exec node .output/server/index.mjs"]
