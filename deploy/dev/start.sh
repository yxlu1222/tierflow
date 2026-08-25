#!/usr/bin/env bash
set -Eeuo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd "${script_dir}"

if [[ ! -f .env ]]; then
  umask 077
  postgres_password=$(openssl rand -hex 24)
  redis_password=$(openssl rand -hex 24)
  session_secret=$(openssl rand -hex 48)

  printf '%s\n' \
    'POSTGRES_USER=tierflow' \
    "POSTGRES_PASSWORD=${postgres_password}" \
    'POSTGRES_DB=new_api' \
    "REDIS_PASSWORD=${redis_password}" \
    "SESSION_SECRET=${session_secret}" \
    > .env
fi

docker compose --env-file .env -f compose.yml up -d --build
docker compose --env-file .env -f compose.yml ps
