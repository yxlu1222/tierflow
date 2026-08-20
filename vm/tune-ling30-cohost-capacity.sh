#!/usr/bin/env bash
set -euo pipefail

ling_service=tierflow-model-ling30-tiny.service
lfm_service=tierflow-model-lfm25-cohost.service
unit=/etc/systemd/system/${ling_service}
minimum_available_kib=$((28 * 1024 * 1024))

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <mem-fraction-static> <max-running-requests>" >&2
  exit 1
fi

mem_fraction=$1
max_requests=$2
python3 - "${mem_fraction}" "${max_requests}" <<'PY'
import sys

fraction = float(sys.argv[1])
requests = int(sys.argv[2])
if not 0.40 <= fraction <= 0.65:
    raise SystemExit("mem-fraction-static must be between 0.40 and 0.65")
if not 8 <= requests <= 32:
    raise SystemExit("max-running-requests must be between 8 and 32")
PY

if [[ -r /etc/tierflow/model-bind.env ]]; then
  # shellcheck disable=SC1091
  source /etc/tierflow/model-bind.env
fi
bind_ip=${TIERFLOW_MODEL_BIND_IP:-127.0.0.1}
backup=$(mktemp /etc/systemd/system/ling30-capacity.XXXXXX.service)
cp --preserve=mode,ownership,timestamps "${unit}" "${backup}"

wait_for_model() {
  local service=$1
  local url=$2
  local attempts=$3
  for _ in $(seq 1 "${attempts}"); do
    if curl -fsS --max-time 5 "${url}" >/dev/null 2>&1; then
      return 0
    fi
    if ! systemctl is-active --quiet "${service}"; then
      return 1
    fi
    sleep 2
  done
  return 1
}

restore_previous() {
  echo "Rolling back Ling capacity profile." >&2
  systemctl stop "${lfm_service}" "${ling_service}" || true
  cp --preserve=mode,ownership,timestamps "${backup}" "${unit}"
  systemctl daemon-reload
  systemctl start "${ling_service}" || true
  wait_for_model "${ling_service}" "http://${bind_ip}:8106/v1/models" 300 || true
  systemctl start "${lfm_service}" || true
  wait_for_model "${lfm_service}" "http://${bind_ip}:8105/v1/models" 180 || true
  rm -f "${backup}"
}
trap restore_previous ERR

systemctl stop "${lfm_service}" || true
python3 - "${unit}" "${mem_fraction}" "${max_requests}" <<'PY'
import os
import re
import sys
import tempfile

path, fraction, max_requests = sys.argv[1:]
with open(path, encoding="utf-8") as handle:
    text = handle.read()

replacements = (
    (r"--mem-fraction-static\s+[0-9.]+", f"--mem-fraction-static {fraction}"),
    (r"--max-running-requests\s+\d+", f"--max-running-requests {max_requests}"),
)
for pattern, replacement in replacements:
    text, count = re.subn(pattern, replacement, text)
    if count != 1:
        raise SystemExit(f"Expected one match for {pattern!r}, found {count}")

fd, temporary = tempfile.mkstemp(prefix="ling30.", suffix=".service", dir=os.path.dirname(path))
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
systemctl restart "${ling_service}"
wait_for_model "${ling_service}" "http://${bind_ip}:8106/v1/models" 300

# Prime the largest batch before llama.cpp opens a second CUDA context.
python3 /home/admin2/benchmark-model-capacity.py \
  --base-url "http://${bind_ip}:8106" \
  --model Ling-3.0-tiny \
  --levels "${max_requests}" \
  --repeats 1 \
  --max-tokens 64 \
  --cooldown 0.1 >/tmp/ling30-capacity-warmup.jsonl

systemctl start "${lfm_service}"
wait_for_model "${lfm_service}" "http://${bind_ip}:8105/v1/models" 180

available_kib=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
if [[ ${available_kib} -lt ${minimum_available_kib} ]]; then
  echo "Less than 28 GiB remains after both models start." >&2
  false
fi

trap - ERR
rm -f "${backup}"
echo "Applied Ling profile: mem-fraction-static=${mem_fraction}, max-running-requests=${max_requests}"
free -h
