#!/usr/bin/env bash
set -euo pipefail

MODEL_ROOT="${1:-/var/lib/tierflow/models}"
cd "$MODEL_ROOT"

for manifest in \
  .manifests/lfm2.5-2.6b.sha256 \
  .manifests/ling-3.0-tiny.sha256 \
  .manifests/qwen3.8-27b.sha256 \
  .manifests/nemotron-3.5-lightning.sha256; do
  if [[ ! -f "$manifest" ]]; then
    echo "Missing manifest: $MODEL_ROOT/$manifest" >&2
    exit 1
  fi
  sha256sum --quiet -c "$manifest"
done

echo "All migrated model files match their source SHA256 manifests."
