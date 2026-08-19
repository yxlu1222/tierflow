#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: sudo ./install.sh --mode controller|worker --binary PATH --config PATH --token-file PATH [--install-model-units]

controller: installs the local Node Agent next to the TierFlow API/controller.
worker:     installs only the Node Agent and, optionally, the whitelisted model units.
EOF
}

MODE=""
BINARY=""
CONFIG=""
TOKEN_FILE=""
INSTALL_MODEL_UNITS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="${2:-}"; shift 2 ;;
    --binary) BINARY="${2:-}"; shift 2 ;;
    --config) CONFIG="${2:-}"; shift 2 ;;
    --token-file) TOKEN_FILE="${2:-}"; shift 2 ;;
    --install-model-units) INSTALL_MODEL_UNITS=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer as root." >&2
  exit 1
fi
if [[ "$MODE" != "controller" && "$MODE" != "worker" ]]; then
  echo "--mode must be controller or worker" >&2
  exit 2
fi
for required in "$BINARY" "$CONFIG" "$TOKEN_FILE"; do
  if [[ ! -f "$required" ]]; then
    echo "Required file not found: $required" >&2
    exit 1
  fi
done

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_ROLE="$(sed -n 's/.*"role"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$CONFIG" | head -n1)"
if [[ "$CONFIG_ROLE" != "$MODE" ]]; then
  echo "Config role '$CONFIG_ROLE' does not match --mode '$MODE'." >&2
  exit 1
fi

install -d -m 0755 /opt/tierflow/node-agent
install -d -m 0750 /etc/tierflow /var/lib/tierflow
install -m 0755 "$BINARY" /opt/tierflow/node-agent/tierflow-node-agent
install -m 0640 "$CONFIG" /etc/tierflow/node-agent.json
if [[ "$MODE" == "controller" ]]; then
  install -o root -g tierflow -m 0640 "$TOKEN_FILE" /etc/tierflow/cluster-agent.token
else
  install -o root -g root -m 0600 "$TOKEN_FILE" /etc/tierflow/cluster-agent.token
fi
install -m 0644 "$SCRIPT_DIR/tierflow-node-agent.service" /etc/systemd/system/tierflow-node-agent.service

if [[ "$MODE" == "worker" && "$INSTALL_MODEL_UNITS" -eq 1 ]]; then
  install -m 0644 "$SCRIPT_DIR"/worker-units/*.service /etc/systemd/system/
  install -m 0644 "$SCRIPT_DIR/worker-units/tierflow-model-bind.env.example" /etc/tierflow/model-bind.env
fi

systemctl daemon-reload
systemctl enable --now tierflow-node-agent.service
echo "Installed TierFlow Node Agent in $MODE mode."
