#!/usr/bin/env bash
# Runs ON the VM (called by infra/deploy.sh). Unpacks the release and rebuilds the stack.
set -euo pipefail
cd /opt/earshot
[ -f .env ] || { echo "/opt/earshot/.env is missing"; exit 1; }
grep -q '^PUBLIC_HOST=' .env || echo "PUBLIC_HOST=$HOST" >> .env
rm -rf app
mkdir app
tar -xzf earshot.tgz -C app
cd app
docker build -q -f sandbox/Dockerfile -t earshot-sandbox:latest .
docker compose --env-file /opt/earshot/.env -f infra/docker-compose.yml up -d --build --remove-orphans
docker image prune -f >/dev/null
docker compose --env-file /opt/earshot/.env -f infra/docker-compose.yml ps
