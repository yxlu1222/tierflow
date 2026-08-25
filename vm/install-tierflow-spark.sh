#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

binary_path=${1:-/home/admin/tierflow-deploy/tierflow-api-20260814-ui10-arm64}
release_name=${2:-20260814-ui10}
cuda_memory_helper_path=${3:-/home/admin/tierflow-deploy/tierflow-cuda-memory}
release_dir=/opt/tierflow/releases/${release_name}
current_link=/opt/tierflow/current
data_dir=/var/lib/tierflow
log_dir=/var/log/tierflow
config_dir=/etc/tierflow
secret_file=${config_dir}/session-secret
environment_file=${config_dir}/tierflow.env
service_name=tierflow-stack.service

if [[ ! -x ${binary_path} ]]; then
  echo "TierFlow ARM64 binary not found or not executable: ${binary_path}" >&2
  exit 1
fi

if ! id tierflow >/dev/null 2>&1; then
  useradd \
    --system \
    --user-group \
    --home-dir "${data_dir}" \
    --create-home \
    --shell /usr/sbin/nologin \
    tierflow
fi

for group_name in video render; do
  if getent group "${group_name}" >/dev/null; then
    usermod -aG "${group_name}" tierflow
  fi
done

install -d -o root -g root -m 0755 /opt/tierflow /opt/tierflow/releases
install -d -o root -g root -m 0755 "${release_dir}"
install -d -o tierflow -g tierflow -m 0750 "${data_dir}" "${log_dir}"
install -d -o root -g tierflow -m 0750 "${config_dir}"
install -o root -g root -m 0755 "${binary_path}" "${release_dir}/tierflow-api"
if [[ -x ${cuda_memory_helper_path} ]]; then
  install -o root -g root -m 0755 "${cuda_memory_helper_path}" /usr/local/bin/tierflow-cuda-memory
fi

ln -sfn "${release_dir}" "${current_link}.next"
mv -Tf "${current_link}.next" "${current_link}"

if [[ ! -s ${secret_file} ]]; then
  umask 077
  openssl rand -hex 32 > "${secret_file}"
fi
chown root:tierflow "${secret_file}"
chmod 0640 "${secret_file}"

host_name=$(hostname)
host_os=$(sed -n 's/^PRETTY_NAME=//p' /etc/os-release | tr -d '"' | head -n 1)
session_secret=$(cat "${secret_file}")

cat > "${environment_file}" <<EOF
TZ=Asia/Shanghai
GIN_MODE=release
PORT=3000
NODE_NAME=tierflow-spark
APPLIANCE_MODE=true
APPLIANCE_HOSTNAME=${host_name}
APPLIANCE_HOST_OS="NVIDIA DGX Spark · ${host_os}"
APPLIANCE_DATA_PATH=${data_dir}
SQLITE_PATH=${data_dir}/tierflow.db?_busy_timeout=30000
ERROR_LOG_ENABLED=true
SESSION_COOKIE_SECURE=false
SESSION_SECRET=${session_secret}
EOF
chown root:tierflow "${environment_file}"
chmod 0640 "${environment_file}"

cat > "/etc/systemd/system/${service_name}" <<'EOF'
[Unit]
Description=TierFlow DGX Spark appliance application
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=tierflow
Group=tierflow
SupplementaryGroups=video render
WorkingDirectory=/var/lib/tierflow
EnvironmentFile=/etc/tierflow/tierflow.env
ExecStart=/opt/tierflow/current/tierflow-api --port 3000 --log-dir /var/log/tierflow
Restart=always
RestartSec=3
TimeoutStartSec=90
TimeoutStopSec=30
KillSignal=SIGTERM
UMask=0027

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
ReadWritePaths=/var/lib/tierflow /var/log/tierflow

[Install]
WantedBy=multi-user.target
EOF
chmod 0644 "/etc/systemd/system/${service_name}"

systemctl daemon-reload
systemctl enable "${service_name}"
systemctl restart "${service_name}"

for attempt in $(seq 1 120); do
  if curl --fail --silent http://127.0.0.1:3000/api/status >/dev/null; then
    echo "TierFlow Spark application deployment completed: ${release_name}"
    exit 0
  fi
  sleep 1
done

systemctl status "${service_name}" --no-pager -l >&2 || true
journalctl -u "${service_name}" --no-pager -n 200 >&2 || true
echo "TierFlow Spark application failed its health check." >&2
exit 1
