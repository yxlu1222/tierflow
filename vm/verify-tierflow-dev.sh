#!/usr/bin/env bash
set -Eeuo pipefail

failed=0

check() {
  local label=$1
  shift
  if "$@" >/dev/null 2>&1; then
    printf '[OK] %s\n' "$label"
  else
    printf '[FAIL] %s\n' "$label"
    failed=1
  fi
}

check 'systemd is active' systemctl is-system-running
check 'Docker daemon is active' systemctl is-active docker
check 'Docker CLI works' docker info
check 'Docker Compose v2 works' docker compose version
check 'Git is installed' git --version
check 'curl is installed' curl --version

printf '\nArchitecture: %s\n' "$(uname -m)"
printf 'Ubuntu: %s\n' "$(. /etc/os-release && printf '%s' "$PRETTY_NAME")"
printf 'User: %s\n' "$(id -un)"

exit "$failed"

