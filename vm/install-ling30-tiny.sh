#!/usr/bin/env bash
set -Eeuo pipefail

activate=false
if [[ ${1:-} == --activate ]]; then
  activate=true
fi

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer as root." >&2
  exit 1
fi

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
model_dir=/var/lib/tierflow/models/ling-3.0-tiny-fp8

install -d -m 0755 \
  "$model_dir" \
  /var/cache/tierflow-sglang \
  /var/log/tierflow-models \
  /usr/local/lib/tierflow \
  /usr/local/sbin
install -m 0644 "$script_dir/tierflow-model-ling30-tiny.service" /etc/systemd/system/tierflow-model-ling30-tiny.service
install -m 0755 "$script_dir/configure-ling30-tierflow.py" /usr/local/lib/tierflow/configure-ling30-tierflow.py
install -m 0755 "$script_dir/test-ling30-tierflow.sh" /usr/local/lib/tierflow/test-ling30-tierflow.sh
install -m 0755 "$script_dir/hf_snapshot_download_stdlib.py" /usr/local/lib/tierflow/hf_snapshot_download_stdlib.py
install -m 0755 "$script_dir/tierflow-model-switch" /usr/local/sbin/tierflow-model-switch

for unit in \
  tierflow-model-qwen38.service \
  tierflow-model-nanbeige42.service \
  tierflow-model-deepseek-v4-flash.service \
  tierflow-model-nemotron35-lightning.service \
  tierflow-model-lfm25.service; do
  install -d -m 0755 "/etc/systemd/system/${unit}.d"
  install -m 0644 "$script_dir/tierflow-model-ling30-conflict.conf" \
    "/etc/systemd/system/${unit}.d/ling30-conflict.conf"
done

if curl -4 --connect-timeout 10 --max-time 15 --fail --silent \
  https://huggingface.co/api/models/inclusionAI/Ling-3.0-tiny-fp8 \
  >/dev/null; then
  python3 /usr/local/lib/tierflow/hf_snapshot_download_stdlib.py \
    --repo inclusionAI/Ling-3.0-tiny-fp8 \
    --target "$model_dir" \
    --workers 6 \
    --timeout 300 \
    --retries 20
else
  python3 -m venv /opt/tierflow/modelscope-downloader
  /opt/tierflow/modelscope-downloader/bin/pip install -U \
    -i https://pypi.tuna.tsinghua.edu.cn/simple modelscope
  /opt/tierflow/modelscope-downloader/bin/modelscope download \
    inclusionAI/Ling-3.0-tiny-fp8 \
    --local-dir "$model_dir" \
    --max-workers 8
fi

docker pull lmsysorg/sglang:dev-Ling-3.0-tiny
docker build \
  --file "$script_dir/Dockerfile.ling30-spark" \
  --tag tierflow/sglang-ling30:spark-fix1 \
  "$script_dir"
systemctl daemon-reload
python3 /usr/local/lib/tierflow/configure-ling30-tierflow.py

if $activate; then
  /usr/local/sbin/tierflow-model-switch ling30
else
  systemctl disable tierflow-model-ling30-tiny.service >/dev/null 2>&1 || true
  echo "Ling-3.0-tiny is installed but inactive. Activate it with: sudo tierflow-model-switch ling30"
fi
