#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y \
  ubuntu-desktop-minimal \
  gdm3 \
  virtualbox-guest-utils \
  virtualbox-guest-x11 \
  docker.io \
  docker-compose-v2 \
  ca-certificates \
  curl \
  git \
  jq \
  openssh-server \
  rsync \
  unzip \
  x11-xserver-utils

usermod --append --groups docker,video,render tierflow

install -d -o tierflow -g tierflow -m 0755 \
  /home/tierflow/appliance \
  /opt/tierflow \
  /var/lib/tierflow

systemctl enable docker.service
systemctl enable ssh.service
systemctl enable gdm3.service
systemctl set-default graphical.target

touch /var/lib/tierflow/appliance-bootstrap-complete

echo "TierFlow appliance VM desktop bootstrap completed."
