#!/usr/bin/env bash
# Runs ON the VM as root:  ssh root@<ip> 'bash -s' < infra/bootstrap.sh
# Installs Docker Engine + compose plugin and gVisor (runsc) registered as a Docker runtime.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get install -y ca-certificates curl gnupg

# Docker Engine (official repo)
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
CODENAME=$(. /etc/os-release && echo "$VERSION_CODENAME")
ARCH=$(dpkg --print-architecture)
echo "deb [arch=$ARCH signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $CODENAME stable" > /etc/apt/sources.list.d/docker.list

# gVisor (official repo)
curl -fsSL https://gvisor.dev/archive.key | gpg --dearmor --yes -o /usr/share/keyrings/gvisor-archive-keyring.gpg
echo "deb [arch=$ARCH signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" > /etc/apt/sources.list.d/gvisor.list

apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin runsc

# Register runsc with Docker (same content as infra/docker-daemon.json)
mkdir -p /etc/docker
printf '%s\n' \
  '{' \
  '  "runtimes": { "runsc": { "path": "/usr/bin/runsc", "runtimeArgs": ["--network=sandbox"] } },' \
  '  "log-driver": "json-file",' \
  '  "log-opts": { "max-size": "10m", "max-file": "3" }' \
  '}' > /etc/docker/daemon.json
systemctl restart docker

# 2 GB swap: image builds and two Chromiums on 4 GB need headroom
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

mkdir -p /opt/earshot/app
chmod 700 /opt/earshot
docker run --rm --runtime=runsc hello-world | grep -q "Hello from Docker" && echo "gVisor runtime OK"
