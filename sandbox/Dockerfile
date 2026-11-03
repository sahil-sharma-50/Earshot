# Keyless browser runner. Build from the repo root:
#   docker build -f sandbox/Dockerfile -t earshot-sandbox:latest .
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter runner... \
 && pnpm --filter runner... build \
 && pnpm --filter runner deploy --prod --legacy /out

FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /app
COPY --from=build --chown=root:root /out /app
USER pwuser
ENTRYPOINT ["node", "/app/dist/main.js"]
