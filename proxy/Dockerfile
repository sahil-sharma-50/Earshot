# Build from the repo root: docker build -f proxy/Dockerfile -t earshot-proxy .
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter proxy... \
 && pnpm --filter proxy... build \
 && pnpm --filter proxy deploy --prod --legacy /out

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
USER node
EXPOSE 3128 3129
CMD ["node", "dist/main.js"]
