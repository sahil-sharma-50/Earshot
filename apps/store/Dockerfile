# Build from the repo root: docker build -f apps/store/Dockerfile -t earshot-store .
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter store... \
 && pnpm --filter store... build \
 && pnpm --filter store deploy --prod --legacy /out

FROM node:24-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build /out .
USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]
