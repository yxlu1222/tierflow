#!/usr/bin/env bash
set -euo pipefail

SERVICE="tierflow-model-qwen38.service"
HEALTH_URL="http://127.0.0.1:8102/health"
METRICS_URL="http://127.0.0.1:8102/metrics"

echo "PRECHECK"
curl -fsS "${METRICS_URL}" \
  | grep -E '^sglang:(num_running_reqs|num_queue_reqs)' \
  | sed 's/{.*} / /'

started_epoch="$(date +%s)"
echo "RESTART_BEGIN epoch=${started_epoch} time=$(date '+%F_%T')"
systemctl restart "${SERVICE}"
systemd_returned_epoch="$(date +%s)"
echo "SYSTEMD_RESTART_RETURNED epoch=${systemd_returned_epoch} time=$(date '+%F_%T')"

health_code="000"
for poll in $(seq 1 90); do
  health_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "${HEALTH_URL}" || true)"
  now_epoch="$(date +%s)"
  echo "poll=${poll} epoch=${now_epoch} elapsed=$((now_epoch - started_epoch)) health=${health_code}"
  if [[ "${health_code}" == "200" ]]; then
    break
  fi
  sleep 10
done

ended_epoch="$(date +%s)"
echo "RESTART_END epoch=${ended_epoch} elapsed=$((ended_epoch - started_epoch)) health=${health_code}"
systemctl is-active "${SERVICE}"

if [[ "${health_code}" != "200" ]]; then
  exit 1
fi
