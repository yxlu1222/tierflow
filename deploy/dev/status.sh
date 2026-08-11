#!/usr/bin/env bash
set -Eeuo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd "${script_dir}"

docker compose --env-file .env -f compose.yml ps
curl --fail --silent --show-error http://127.0.0.1:3000/api/status

