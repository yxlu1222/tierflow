#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

install -d -m 0755 /etc/docker

config_file=/etc/docker/daemon.json
temp_file=$(mktemp)
trap 'rm -f "$temp_file"' EXIT

if [[ -s ${config_file} ]]; then
  jq '. + {"registry-mirrors":["https://docker.m.daocloud.io","https://dockerproxy.net"]}' \
    "${config_file}" > "${temp_file}"
else
  printf '%s\n' \
    '{' \
    '  "registry-mirrors": [' \
    '    "https://docker.m.daocloud.io",' \
    '    "https://dockerproxy.net"' \
    '  ]' \
    '}' \
    > "${temp_file}"
fi

install -m 0644 "${temp_file}" "${config_file}"
systemctl restart docker
docker info --format '{{json .RegistryConfig.Mirrors}}'

