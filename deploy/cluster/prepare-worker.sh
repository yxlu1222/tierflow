#!/usr/bin/env bash
set -euo pipefail

STAGING=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --staging) STAGING="${2:-}"; shift 2 ;;
    -h|--help)
      echo "Usage: sudo ./prepare-worker.sh --staging /absolute/path/to/tierflow-migration"
      exit 0
      ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi
if [[ -z "$STAGING" || "$STAGING" != /* || ! -d "$STAGING/models" ]]; then
  echo "--staging must point to an absolute directory containing models/" >&2
  exit 1
fi

getent group tierflow >/dev/null || groupadd --system tierflow
id tierflow >/dev/null 2>&1 || useradd --system --gid tierflow --home-dir /var/lib/tierflow --shell /usr/sbin/nologin tierflow
getent group tierflow-inference >/dev/null || groupadd --system tierflow-inference
id tierflow-inference >/dev/null 2>&1 || useradd --system --gid tierflow-inference --home-dir /var/lib/tierflow-inference --shell /usr/sbin/nologin tierflow-inference
usermod -a -G tierflow,video,render tierflow-inference

install -d -o tierflow -g tierflow -m 0750 /var/lib/tierflow /var/lib/tierflow/models
install -d -o tierflow -g tierflow -m 0750 /var/cache/tierflow-sglang
install -d -o tierflow-inference -g tierflow-inference -m 0750 /var/lib/tierflow-inference /var/log/tierflow-models

shopt -s nullglob
for source_dir in "$STAGING"/models/*; do
  name="$(basename -- "$source_dir")"
  target="/var/lib/tierflow/models/$name"
  if [[ -e "$target" ]]; then
    echo "Refusing to overwrite existing model directory: $target" >&2
    exit 1
  fi
  mv -- "$source_dir" "$target"
done
chown -R tierflow:tierflow /var/lib/tierflow/models
find /var/lib/tierflow/models -type d -exec chmod 0750 {} +
find /var/lib/tierflow/models -type f -exec chmod 0640 {} +

echo "Worker users, directories and staged model data are ready."
