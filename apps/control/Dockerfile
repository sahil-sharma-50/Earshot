# Control plane + built web UI. Build from the repo root:
#   docker build -f apps/control/Dockerfile -t earshot-control .
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter control... --filter web... \
 && pnpm --filter control... build \
 && pnpm --filter web build \
 && pnpm --filter control deploy --prod --legacy /out \
 && cp -r apps/web/dist /out/web

FROM node:24-slim
ENV NODE_ENV=production PORT=3000 WEB_DIST=/app/web
WORKDIR /app
COPY --from=build /out .
# control talks to the Docker socket (mounted by compose) to create sandboxes; it is the trusted layer
EXPOSE 3000
CMD ["node", "dist/server.js"]
