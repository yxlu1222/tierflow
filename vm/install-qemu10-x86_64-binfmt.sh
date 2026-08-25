#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "run this installer as root" >&2
  exit 1
fi

PACKAGE_PATH="${1:-/home/admin2/qemu-user_10.0.2+ds-2+deb13u1~bpo12+1_arm64.deb}"
CONFIG_PATH="${2:-/home/admin2/qemu-x86_64.conf}"
PACKAGE_URL="http://ftp.cn.debian.org/debian/pool/main/q/qemu/qemu-user_10.0.2+ds-2+deb13u1~bpo12+1_arm64.deb"
PACKAGE_SHA256="b98c7b86ae9c69d0a28e834f2d8e1d1edb57e9ed355cfb5eae4e72c7eef73b37"
INSTALL_ROOT="/opt/tierflow/runtime/qemu-10.0.2"
SYSTEM_CONFIG="/etc/binfmt.d/qemu-x86_64.conf"

if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "missing binfmt config: $CONFIG_PATH" >&2
  exit 1
fi

if [[ ! -f "$PACKAGE_PATH" ]]; then
  install -d -m 0755 "$(dirname "$PACKAGE_PATH")"
  curl -fL --retry 5 --retry-all-errors --connect-timeout 15 \
    -o "$PACKAGE_PATH" "$PACKAGE_URL"
fi

echo "$PACKAGE_SHA256  $PACKAGE_PATH" | sha256sum -c -

staging="$(mktemp -d /tmp/tierflow-qemu10.XXXXXX)"
trap 'rm -rf "$staging"' EXIT
dpkg-deb -x "$PACKAGE_PATH" "$staging"

install -d -m 0755 "$INSTALL_ROOT/bin" "$INSTALL_ROOT/libexec/qemu-binfmt"
install -m 0755 "$staging/usr/bin/qemu-x86_64" "$INSTALL_ROOT/bin/qemu-x86_64"
ln -sfn ../../bin/qemu-x86_64 "$INSTALL_ROOT/libexec/qemu-binfmt/x86_64-binfmt-P"

if [[ -f "$SYSTEM_CONFIG" ]] && ! cmp -s "$CONFIG_PATH" "$SYSTEM_CONFIG"; then
  backup="${SYSTEM_CONFIG}.bak-$(date +%Y%m%d-%H%M%S)"
  cp -a "$SYSTEM_CONFIG" "$backup"
  echo "backed up existing config to $backup"
fi
install -m 0644 "$CONFIG_PATH" "$SYSTEM_CONFIG"

systemctl restart systemd-binfmt.service

grep -F "interpreter $INSTALL_ROOT/libexec/qemu-binfmt/x86_64-binfmt-P" \
  /proc/sys/fs/binfmt_misc/qemu-x86_64 >/dev/null
"$INSTALL_ROOT/bin/qemu-x86_64" --version | head -1
cat /proc/sys/fs/binfmt_misc/qemu-x86_64
