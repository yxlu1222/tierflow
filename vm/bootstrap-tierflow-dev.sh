#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  docker.io \
  docker-compose-v2 \
  git \
  jq \
  openssl \
  unzip

if ! id tierflow >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash tierflow
fi

usermod --append --groups docker,sudo tierflow
install -d -m 0755 /etc/sudoers.d
printf '%s\n' 'tierflow ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-tierflow-dev
chmod 0440 /etc/sudoers.d/90-tierflow-dev

install -d -o tierflow -g tierflow -m 0755 \
  /home/tierflow/workspace \
  /opt/tierflow \
  /var/lib/tierflow

printf '%s\n' \
  '[boot]' \
  'systemd=true' \
  '' \
  '[user]' \
  'default=tierflow' \
  '' \
  '[network]' \
  'generateHosts=true' \
  'generateResolvConf=true' \
  > /etc/wsl.conf

systemctl enable --now docker

docker version
docker compose version

echo "TierFlow development VM bootstrap completed."

