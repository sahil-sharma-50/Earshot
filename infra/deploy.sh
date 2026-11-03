#!/usr/bin/env bash
# Ships HEAD to the VM and (re)starts the stack.  Usage: infra/deploy.sh <vm-ip>
# Needs /opt/earshot/.env on the VM, written once by hand (see .env.example). Never in git.
set -euo pipefail
cd "$(dirname "$0")/.."
IP=${1:?usage: infra/deploy.sh <vm-ip>}
HOST="$(echo "$IP" | tr . -).sslip.io"
TARBALL="$(mktemp -d)/earshot.tgz"

git archive --format=tar.gz -o "$TARBALL" HEAD
scp -q "$TARBALL" "root@$IP:/opt/earshot/earshot.tgz"
ssh "root@$IP" "HOST=$HOST bash -s" < infra/remote-deploy.sh

echo "waiting for https://$HOST/api/health"
for _ in $(seq 1 40); do
  if curl -fsS "https://$HOST/api/health" >/dev/null 2>&1; then
    echo "OK: https://$HOST"
    exit 0
  fi
  sleep 6
done
echo "health check failed"
exit 1
