#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

kernel_release=$(uname -r)
iso_mount=/mnt/vbox-guest-additions
install_log=/var/log/tierflow-vbox-guest-additions.log

exec > >(tee -a "${install_log}") 2>&1

echo "Installing build dependencies for ${kernel_release}..."
apt-get update
apt-get install -y --no-install-recommends \
  build-essential \
  dkms \
  "linux-headers-${kernel_release}"

if mounted_path=$(findmnt -rn -S /dev/sr0 -o TARGET | head -n 1); then
  iso_mount=${mounted_path}
else
  install -d -m 0755 "${iso_mount}"
  mount -o ro /dev/sr0 "${iso_mount}"
fi

installer=${iso_mount}/VBoxLinuxAdditions.run
if [[ ! -f ${installer} ]]; then
  echo "VBoxLinuxAdditions.run was not found on /dev/sr0." >&2
  exit 1
fi

# Ubuntu's 7.0.x user-space packages conflict with the 7.2.x files shipped
# by the matching host ISO. Removing these two packages does not remove GNOME
# or Xorg; the Oracle installer immediately replaces their guest services.
apt-get remove -y virtualbox-guest-x11 virtualbox-guest-utils || true

echo "Running ${installer}..."
# A distro-provided vboxguest module remains loaded until reboot even after
# its packages are removed. The Oracle installer asks once whether this
# expected residue should be replaced, so answer that prompt explicitly.
printf 'yes\n' | /bin/sh "${installer}" --nox11

systemctl daemon-reload
systemctl enable vboxadd-service.service 2>/dev/null || true
systemctl restart vboxadd-service.service 2>/dev/null || true

echo "Installed Guest Additions files:"
/usr/sbin/VBoxService --version 2>/dev/null || /usr/bin/VBoxService --version 2>/dev/null || true
dkms status || true
echo "Guest Additions installation completed. Reboot is required."
