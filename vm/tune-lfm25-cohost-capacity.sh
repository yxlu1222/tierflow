#!/usr/bin/env bash
set -euo pipefail

service=tierflow-model-lfm25-cohost.service
ling_service=tierflow-model-ling30-tiny.service
unit=/etc/systemd/system/${service}
minimum_available_kib=$((40 * 1024 * 1024))

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <context-per-slot> <parallel-slots>" >&2
  exit 1
fi

context_per_slot=$1
parallel_slots=$2
if ! [[ ${context_per_slot} =~ ^[0-9]+$ && ${parallel_slots} =~ ^[0-9]+$ ]]; then
  echo "Context and parallel values must be positive integers." >&2
  exit 1
fi
if [[ ${context_per_slot} -lt 32768 || ${context_per_slot} -gt 131072 ]]; then
  echo "Context per slot must be between 32768 and the native 131072 limit." >&2
  exit 1
fi
if [[ ${parallel_slots} -lt 1 || ${parallel_slots} -gt 8 ]]; then
  echo "Parallel slots must be between 1 and 8." >&2
  exit 1
fi

ctx_size=$((context_per_slot * parallel_slots))
backup=$(mktemp /etc/systemd/system/lfm25-cohost.XXXXXX.service)
cp --preserve=mode,ownership,timestamps "${unit}" "${backup}"

rollback() {
  echo "Rolling back LFM co-host unit." >&2
  systemctl stop "${service}" || true
  cp --preserve=mode,ownership,timestamps "${backup}" "${unit}"
  systemctl daemon-reload
  systemctl start "${service}" || true
  rm -f "${backup}"
}
trap rollback ERR

if ! systemctl is-active --quiet "${ling_service}"; then
  echo "Ling must be active before tuning LFM." >&2
  exit 1
fi

python3 - "${unit}" "${ctx_size}" "${parallel_slots}" "${context_per_slot}" <<'PY'
import os
import re
import sys
import tempfile

path, ctx_size, parallel, per_slot = sys.argv[1:]
with open(path, encoding="utf-8") as handle:
    text = handle.read()

replacements = (
    (r"--ctx-size\s+\d+", f"--ctx-size {ctx_size}"),
    (r"--parallel\s+\d+", f"--parallel {parallel}"),
    (
        r"--override-kv\s+lfm2\.context_length=int:\d+",
        f"--override-kv lfm2.context_length=int:{per_slot}",
    ),
    (r"MemoryHigh=\d+G", "MemoryHigh=24G"),
    (r"MemoryMax=\d+G", "MemoryMax=32G"),
)
for pattern, replacement in replacements:
    text, count = re.subn(pattern, replacement, text)
    if count != 1:
        raise SystemExit(f"Expected one match for {pattern!r}, found {count}")

fd, temporary = tempfile.mkstemp(prefix="lfm25-cohost.", suffix=".service", dir=os.path.dirname(path))
try:
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(text)
    os.chmod(temporary, 0o644)
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
PY

systemctl daemon-reload
systemctl restart "${service}"

if [[ -r /etc/tierflow/model-bind.env ]]; then
  # shellcheck disable=SC1091
  source /etc/tierflow/model-bind.env
fi
bind_ip=${TIERFLOW_MODEL_BIND_IP:-127.0.0.1}

for _ in $(seq 1 180); do
  if curl -fsS --max-time 5 "http://${bind_ip}:8105/v1/models" >/dev/null 2>&1; then
    break
  fi
  if ! systemctl is-active --quiet "${service}"; then
    echo "LFM failed while applying ${context_per_slot} x ${parallel_slots}." >&2
    false
  fi
  sleep 2
done

if ! curl -fsS --max-time 5 "http://${bind_ip}:8105/v1/models" >/dev/null; then
  echo "LFM readiness timed out." >&2
  false
fi

available_kib=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
if [[ ${available_kib} -lt ${minimum_available_kib} ]]; then
  echo "Less than 40 GiB remains after startup." >&2
  false
fi

trap - ERR
rm -f "${backup}"
echo "Applied LFM profile: context-per-slot=${context_per_slot}, parallel=${parallel_slots}, total-context=${ctx_size}"
free -h
