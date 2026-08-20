#!/usr/bin/env bash
set -euo pipefail

legacy_lfm_service=tierflow-model-lfm25.service
cohost_lfm_service=tierflow-model-lfm25-cohost.service
ling_service=tierflow-model-ling30-tiny.service
cohost_unit=/etc/systemd/system/${cohost_lfm_service}
ling_drop_in_dir=/etc/systemd/system/${ling_service}.d
ling_drop_in=${ling_drop_in_dir}/cohost-readiness.conf
ling_warmup=/usr/local/sbin/tierflow-warmup-ling30
node_agent_config=/etc/tierflow/node-agent.json
minimum_available_kib=$((40 * 1024 * 1024))

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

if [[ -r /etc/tierflow/model-bind.env ]]; then
  # shellcheck disable=SC1091
  source /etc/tierflow/model-bind.env
fi
bind_ip=${TIERFLOW_MODEL_BIND_IP:-127.0.0.1}

available_kib() {
  awk '/^MemAvailable:/ {print $2}' /proc/meminfo
}

wait_for_model() {
  local service=$1
  local url=$2
  local attempts=$3
  local interval=$4

  for _ in $(seq 1 "${attempts}"); do
    if curl -fsS --max-time 5 "${url}" >/dev/null 2>&1; then
      return 0
    fi
    if ! systemctl is-active --quiet "${service}"; then
      return 1
    fi
    sleep "${interval}"
  done
  return 1
}

if [[ $(available_kib) -lt ${minimum_available_kib} ]]; then
  echo "Refusing to configure co-hosting: less than 40 GiB host memory is available." >&2
  exit 1
fi

# systemd cannot reliably subtract Conflicts= relationships inherited from the
# original units. Use a distinct LFM service name that Ling does not conflict with.
rm -f \
  /etc/systemd/system/tierflow-model-lfm25.service.d/cohost-ling30.conf \
  /etc/systemd/system/tierflow-model-ling30-tiny.service.d/cohost-lfm25.conf

systemctl disable --now "${legacy_lfm_service}" || true
systemctl stop "${cohost_lfm_service}" || true

install -d -m 0755 "${ling_drop_in_dir}"
cat >"${ling_warmup}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ -r /etc/tierflow/model-bind.env ]]; then
  # shellcheck disable=SC1091
  source /etc/tierflow/model-bind.env
fi
bind_ip=${TIERFLOW_MODEL_BIND_IP:-127.0.0.1}

for _ in $(seq 1 300); do
  if curl -fsS --max-time 5 "http://${bind_ip}:8106/v1/models" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

python3 - "${bind_ip}" <<'PY'
import json
import sys
import urllib.request

bind_ip = sys.argv[1]
body = {
    "model": "Ling-3.0-tiny",
    "messages": [
        {
            "role": "user",
            "content": "List concise facts about reliable local AI inference.",
        }
    ],
    "temperature": 0.0,
    "max_tokens": 64,
    "ignore_eos": True,
    "stream": True,
    "stream_options": {"include_usage": True},
}
request = urllib.request.Request(
    f"http://{bind_ip}:8106/v1/chat/completions",
    json.dumps(body).encode("utf-8"),
    {"Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(request, timeout=180) as response:
    for _ in response:
        pass
PY
EOF
chmod 0755 "${ling_warmup}"

cat >"${ling_drop_in}" <<EOF
[Service]
ExecStartPost=${ling_warmup}
Restart=always
EOF

cat >"${cohost_unit}" <<'EOF'
[Unit]
Description=TierFlow LFM2.5-2.6B co-host service for Ling-3.0-tiny
Wants=network-online.target
Requires=tierflow-model-ling30-tiny.service
After=network-online.target tierflow-model-ling30-tiny.service
Conflicts=tierflow-model-qwen38.service tierflow-model-nemotron35-lightning.service

[Service]
Type=simple
User=tierflow-inference
Group=tierflow-inference
SupplementaryGroups=tierflow video render
WorkingDirectory=/var/lib/tierflow/models/lfm2.5-2.6b-gguf
EnvironmentFile=/etc/tierflow/model-bind.env
Environment=CUDA_VISIBLE_DEVICES=0
Environment=GGML_CUDA_ENABLE_UNIFIED_MEMORY=1
ExecStart=/opt/tierflow/inference/bin/llama-server-nanbeige42 \
  --model /var/lib/tierflow/models/lfm2.5-2.6b-gguf/LFM2.5-2.6B-Q4_K_M.gguf \
  --alias LFM2.5-2.6B \
  --host ${TIERFLOW_MODEL_BIND_IP} \
  --port 8105 \
  --ctx-size 65536 \
  --parallel 2 \
  --override-kv lfm2.context_length=int:32768 \
  --gpu-layers 99 \
  --flash-attn on \
  --cache-type-k q8_0 \
  --cache-type-v q8_0 \
  --temp 0.1 \
  --top-k 50 \
  --repeat-penalty 1.1 \
  --cont-batching \
  --metrics \
  --no-webui
Restart=on-failure
RestartSec=5
TimeoutStartSec=900
TimeoutStopSec=90
KillSignal=SIGTERM
LimitNOFILE=1048576
UMask=0027
MemoryHigh=14G
MemoryMax=18G
MemorySwapMax=0
OOMPolicy=stop

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectControlGroups=true
ProtectKernelLogs=true
ProtectKernelModules=true
ProtectKernelTunables=true
RestrictRealtime=true
RestrictSUIDSGID=true
LockPersonality=true
ReadOnlyPaths=/var/lib/tierflow/models/lfm2.5-2.6b-gguf
ReadWritePaths=/var/log/tierflow-models /var/lib/tierflow-inference

[Install]
WantedBy=multi-user.target
EOF

python3 - "${node_agent_config}" "${cohost_lfm_service}" <<'PY'
import json
import os
import sys
import tempfile

path, service = sys.argv[1:]
with open(path, encoding="utf-8") as handle:
    config = json.load(handle)

found = False
for model in config.get("models", []):
    if model.get("id") == "lfm2.5-2.6b":
        model["service"] = service
        found = True
        break
if not found:
    raise SystemExit("LFM2.5 model entry is missing from node-agent.json")

directory = os.path.dirname(path)
fd, temporary = tempfile.mkstemp(prefix="node-agent.", suffix=".json", dir=directory)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(config, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    os.chmod(temporary, 0o640)
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
PY

systemctl daemon-reload
systemctl reset-failed "${ling_service}" "${cohost_lfm_service}" || true
systemctl restart tierflow-node-agent.service

systemctl restart "${ling_service}"
if ! wait_for_model "${ling_service}" "http://${bind_ip}:8106/v1/models" 240 2; then
  systemctl stop "${cohost_lfm_service}" || true
  echo "Ling-3.0-tiny failed its readiness check." >&2
  exit 1
fi

if [[ $(available_kib) -lt ${minimum_available_kib} ]]; then
  echo "Ling is ready, but less than 40 GiB remains; LFM will not be started." >&2
  exit 1
fi

systemctl start "${cohost_lfm_service}"
if ! wait_for_model "${cohost_lfm_service}" "http://${bind_ip}:8105/v1/models" 120 2; then
  systemctl stop "${cohost_lfm_service}" || true
  echo "LFM2.5 co-host service failed its readiness check and was stopped." >&2
  exit 1
fi

systemctl enable "${ling_service}" "${cohost_lfm_service}"

if ! curl -fsS --max-time 5 "http://${bind_ip}:8106/v1/models" >/dev/null; then
  systemctl stop "${cohost_lfm_service}" || true
  echo "Ling stopped responding after LFM started; LFM was stopped." >&2
  exit 1
fi

echo "Ling-3.0-tiny and LFM2.5 co-host services are ready."
free -h
