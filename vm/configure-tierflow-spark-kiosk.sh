#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

activate=configure-only
appliance_url=${TIERFLOW_APPLIANCE_URL:-http://127.0.0.1:3000/sign-in}
requires_local_stack=${TIERFLOW_SHELL_REQUIRES_LOCAL_STACK:-auto}

while (( $# > 0 )); do
  case "$1" in
    --activate)
      activate=--activate
      ;;
    --url)
      shift
      if (( $# == 0 )); then
        echo "--url requires a value." >&2
        exit 2
      fi
      appliance_url=$1
      ;;
    --remote-controller)
      requires_local_stack=false
      ;;
    configure-only)
      ;;
    *)
      echo "Usage: $0 [--activate] [--url URL] [--remote-controller]" >&2
      exit 2
      ;;
  esac
  shift
done

case "${appliance_url}" in
  http://*|https://*) ;;
  *)
    echo "TierFlow URL must use http:// or https://." >&2
    exit 2
    ;;
esac

appliance_origin=${appliance_url%/}
appliance_origin=${appliance_origin%/sign-in}
appliance_status_url=${TIERFLOW_APPLIANCE_STATUS_URL:-${appliance_origin}/api/status}

if [[ ${requires_local_stack} == auto ]]; then
  case "${appliance_origin}" in
    http://127.0.0.1:*|http://localhost:*|https://127.0.0.1:*|https://localhost:*)
      requires_local_stack=true
      ;;
    *)
      requires_local_stack=false
      ;;
  esac
fi

if [[ ${requires_local_stack} != true && ${requires_local_stack} != false ]]; then
  echo "TIERFLOW_SHELL_REQUIRES_LOCAL_STACK must be true, false, or auto." >&2
  exit 2
fi

maintenance_user=${TIERFLOW_MAINTENANCE_USER:-${SUDO_USER:-admin}}
if ! id "${maintenance_user}" >/dev/null 2>&1; then
  echo "Maintenance user does not exist: ${maintenance_user}" >&2
  exit 2
fi
maintenance_home=$(getent passwd "${maintenance_user}" | cut -d: -f6)
if [[ -z ${maintenance_home} || ! -d ${maintenance_home} ]]; then
  echo "Maintenance user home is unavailable: ${maintenance_user}" >&2
  exit 2
fi

shell_user=tierflow-shell
shell_home=/var/lib/tierflow-shell
runtime_dir=/run/tierflow-shell
epiphany_profile=${shell_home}/browser-profile
firefox_profile=${shell_home}/firefox-profile
firefox_bin=/snap/firefox/current/usr/lib/firefox/firefox
browser_zoom_config=/etc/tierflow-browser-zoom
default_browser_zoom=2.00

export DEBIAN_FRONTEND=noninteractive
missing_packages=()
for package_name in cage epiphany-browser grim seatd sqlite3; do
  if ! dpkg-query -W -f='${Status}' "${package_name}" 2>/dev/null | grep -q 'install ok installed'; then
    missing_packages+=("${package_name}")
  fi
done
if (( ${#missing_packages[@]} > 0 )); then
  apt-get update
  apt-get install -y --no-install-recommends "${missing_packages[@]}"
fi

# Firefox is the preferred appliance browser because its kiosk mode removes
# all browser chrome and its device-pixel scaling matches the Controller UI.
# Keep Epiphany installed as a fallback for hosts that cannot reach Snap.
if [[ ! -x ${firefox_bin} ]] && command -v snap >/dev/null 2>&1; then
  if ! snap install firefox; then
    echo "Firefox Snap installation failed; Epiphany will be used as fallback." >&2
  fi
fi

nvidia_drm_config=/etc/modprobe.d/zzzz-tierflow-nvidia-drm.conf
nvidia_drm_options='options nvidia-drm modeset=1 fbdev=1'
if [[ ! -f ${nvidia_drm_config} ]] || ! grep -qxF "${nvidia_drm_options}" "${nvidia_drm_config}"; then
  printf '%s\n' "${nvidia_drm_options}" > "${nvidia_drm_config}"
  chmod 0644 "${nvidia_drm_config}"
  update-initramfs -u
fi

if ! id "${shell_user}" >/dev/null 2>&1; then
  useradd \
    --system \
    --user-group \
    --home-dir "${shell_home}" \
    --create-home \
    --shell /usr/sbin/nologin \
    "${shell_user}"
fi

supplementary_groups=()
for group_name in video render input audio; do
  if getent group "${group_name}" >/dev/null; then
    supplementary_groups+=("${group_name}")
  fi
done
if (( ${#supplementary_groups[@]} > 0 )); then
  group_csv=$(IFS=,; echo "${supplementary_groups[*]}")
  usermod -aG "${group_csv}" "${shell_user}"
fi

install -d -o "${shell_user}" -g "${shell_user}" -m 0700 \
  "${shell_home}" \
  "${epiphany_profile}" \
  "${firefox_profile}" \
  "${shell_home}/cache" \
  "${shell_home}/config" \
  "${shell_home}/config/gtk-4.0"

cat > "${shell_home}/config/gtk-4.0/gtk.css" <<'EOF'
headerbar,
tabbar,
.tab-bar,
.titlebar {
  min-height: 0;
  padding: 0;
  margin: 0;
  border: 0;
  opacity: 0;
  font-size: 0;
}

headerbar > *,
tabbar > *,
.tab-bar > *,
.titlebar > * {
  min-width: 0;
  min-height: 0;
  padding: 0;
  margin: 0;
  opacity: 0;
}
EOF
chown -R "${shell_user}:${shell_user}" "${shell_home}/config"
chmod 0644 "${shell_home}/config/gtk-4.0/gtk.css"

cat > "${shell_home}/config/gtk-4.0/settings.ini" <<'EOF'
[Settings]
gtk-enable-animations=false
EOF
chown "${shell_user}:${shell_user}" "${shell_home}/config/gtk-4.0/settings.ini"
chmod 0644 "${shell_home}/config/gtk-4.0/settings.ini"

cat > "${firefox_profile}/user.js" <<'EOF'
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("signon.rememberSignons", false);
user_pref("signon.autofillForms", false);
user_pref("signon.generation.enabled", false);
user_pref("browser.formfill.enable", false);
user_pref("layout.css.devPixelsPerPx", "2.0");
user_pref("browser.tabs.warnOnClose", false);
user_pref("browser.tabs.warnOnQuit", false);
user_pref("browser.warnOnQuit", false);
user_pref("browser.quitShortcut.disabled", false);
user_pref("browser.fullscreen.autohide", true);
user_pref("browser.startup.page", 0);
user_pref("browser.sessionstore.resume_from_crash", false);
user_pref("browser.startup.couldRestoreSession.count", 0);
user_pref("toolkit.cosmeticAnimations.enabled", false);
user_pref("ui.prefersReducedMotion", 1);
user_pref("zoom.minPercent", 100);
user_pref("zoom.maxPercent", 100);
EOF
chown "${shell_user}:${shell_user}" "${firefox_profile}/user.js"
chmod 0600 "${firefox_profile}/user.js"

if [[ ! -f ${browser_zoom_config} ]]; then
  printf '%s\n' "${default_browser_zoom}" > "${browser_zoom_config}"
fi
chmod 0644 "${browser_zoom_config}"

cat > /usr/local/sbin/tierflow-browser-zoom <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this command as root." >&2
  exit 1
fi

requested_percent=${1:-}
case "${requested_percent}" in
  100) zoom_level=1.00 ;;
  125) zoom_level=1.25 ;;
  150) zoom_level=1.50 ;;
  175) zoom_level=1.75 ;;
  200) zoom_level=2.00 ;;
  225) zoom_level=2.25 ;;
  250) zoom_level=2.50 ;;
  300) zoom_level=3.00 ;;
  *)
    echo "Usage: tierflow-browser-zoom {100|125|150|175|200|225|250|300}" >&2
    exit 2
    ;;
esac

zoom_config=/etc/tierflow-browser-zoom
history_db=/var/lib/tierflow-shell/browser-profile/ephy-history.db
service_was_active=false

if systemctl is-active --quiet tierflow-shell.service; then
  service_was_active=true
  systemctl stop tierflow-shell.service
fi

printf '%s\n' "${zoom_level}" > "${zoom_config}"
chmod 0644 "${zoom_config}"

if [[ -f ${history_db} ]]; then
  sqlite3 "${history_db}" "UPDATE hosts SET zoom_level=${zoom_level};"
  chown tierflow-shell:tierflow-shell "${history_db}" "${history_db}-shm" "${history_db}-wal" 2>/dev/null || true
fi

if [[ ${service_was_active} == true ]]; then
  systemctl start tierflow-shell.service
fi

echo "TierFlow browser zoom set to ${requested_percent}%."
EOF
chmod 0755 /usr/local/sbin/tierflow-browser-zoom

install -d -m 0755 /etc/systemd/system/seatd.service.d
cat > /etc/systemd/system/seatd.service.d/10-tierflow-appliance.conf <<'EOF'
[Service]
Environment=SEATD_VTBOUND=0
EOF

cat > /usr/local/bin/tierflow-system-shell <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail

for attempt in \$(seq 1 120); do
  if /usr/bin/curl --fail --silent ${appliance_status_url} >/dev/null; then
    break
  fi
  /usr/bin/sleep 1
done

if command -v /usr/bin/gsettings >/dev/null 2>&1; then
  /usr/bin/gsettings set org.gnome.Epiphany ask-for-default false || true
fi

rm -f \
  ${epiphany_profile}/session_state.xml \
  ${epiphany_profile}/session_state.xml~

browser_zoom=2.00
if [[ -r ${browser_zoom_config} ]]; then
  browser_zoom=\$(tr -d '[:space:]' < ${browser_zoom_config})
fi
if command -v /usr/bin/gsettings >/dev/null 2>&1; then
  /usr/bin/gsettings set \
    org.gnome.Epiphany.web:/org/gnome/epiphany/web/ default-zoom-level \
    "\${browser_zoom}" || true
fi
if [[ -f ${epiphany_profile}/ephy-history.db ]]; then
  /usr/bin/sqlite3 ${epiphany_profile}/ephy-history.db \
    "UPDATE hosts SET zoom_level=\${browser_zoom};" || true
fi

browser_exit=1
set +e
if [[ -x ${firefox_bin} ]]; then
  /usr/bin/rm -f \
    ${firefox_profile}/sessionCheckpoints.json \
    ${firefox_profile}/sessionstore.jsonlz4
  if [[ -d ${firefox_profile}/sessionstore-backups ]]; then
    /usr/bin/find ${firefox_profile}/sessionstore-backups \
      -maxdepth 1 -type f -delete
  fi

  export MOZ_ENABLE_WAYLAND=1
  export MOZ_WEBRENDER=1

  ${firefox_bin} \
    --kiosk \
    --no-remote \
    --new-instance \
    --profile ${firefox_profile} \
    ${appliance_url}
  browser_exit=\$?
else
  /usr/bin/epiphany \
    --private-instance \
    --profile=${epiphany_profile} \
    ${appliance_url}
  browser_exit=\$?
fi
set -e

if [[ \${browser_exit} -eq 0 ]]; then
  /usr/bin/logger -t tierflow-maintenance \
    'Ctrl+Q requested local maintenance mode.'
  /usr/bin/sudo -n /usr/local/sbin/tierflow-enter-maintenance
fi

exit \${browser_exit}
EOF
chmod 0755 /usr/local/bin/tierflow-system-shell

cat > /usr/local/bin/tierflow-cage-session <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

drm_device=
for card_link in /dev/dri/by-path/pci-*-card; do
  if [[ -e ${card_link} ]]; then
    drm_device=$(readlink -f "${card_link}")
    break
  fi
done
if [[ -z ${drm_device} ]]; then
  for card in /dev/dri/card*; do
    if [[ -c ${card} ]]; then
      drm_device=${card}
      break
    fi
  done
fi
if [[ -z ${drm_device} ]]; then
  echo "No DRM card is available for the TierFlow shell." >&2
  exit 1
fi

export WLR_DRM_DEVICES=${drm_device}
exec /usr/bin/dbus-run-session -- \
  /usr/bin/cage -d -- /usr/local/bin/tierflow-system-shell \
  >> /var/lib/tierflow-shell/cage.log 2>&1
EOF
chmod 0755 /usr/local/bin/tierflow-cage-session

cat > /usr/local/sbin/tierflow-enter-maintenance <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this command as root." >&2
  exit 1
fi

install -m 0600 /dev/null /run/tierflow-maintenance-mode
logger -t tierflow-maintenance \
  "Entering local maintenance mode; GNOME authentication is required."
systemctl --no-block start tierflow-maintenance-mode.service
EOF
chmod 0755 /usr/local/sbin/tierflow-enter-maintenance

cat > /usr/local/sbin/tierflow-return-appliance <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this command as root." >&2
  exit 1
fi

logger -t tierflow-maintenance "Returning to the TierFlow appliance shell."
systemctl --no-block start tierflow-return-appliance.service
EOF
chmod 0755 /usr/local/sbin/tierflow-return-appliance

cat > /etc/sudoers.d/tierflow-maintenance <<'EOF'
tierflow-shell ALL=(root) NOPASSWD: /usr/local/sbin/tierflow-enter-maintenance
EOF
chmod 0440 /etc/sudoers.d/tierflow-maintenance
visudo -cf /etc/sudoers.d/tierflow-maintenance >/dev/null

cat > /etc/systemd/system/tierflow-maintenance-mode.service <<'EOF'
[Unit]
Description=TierFlow authenticated local maintenance mode
Conflicts=tierflow-shell.service
After=tierflow-shell.service

[Service]
Type=oneshot
ExecStart=/usr/bin/sync
ExecStart=/usr/bin/sh -c 'echo 3 > /proc/sys/vm/drop_caches'
ExecStart=/usr/bin/sleep 2
ExecStart=/usr/bin/systemctl start gdm.service
EOF

cat > /etc/systemd/system/tierflow-return-appliance.service <<'EOF'
[Unit]
Description=Return from GNOME maintenance mode to the TierFlow appliance shell

[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl stop gdm.service
ExecStart=/usr/bin/sleep 2
ExecStart=/usr/bin/sync
ExecStart=/usr/bin/sh -c 'echo 3 > /proc/sys/vm/drop_caches'
ExecStart=/usr/bin/sleep 1
ExecStart=/usr/bin/rm -f /run/tierflow-maintenance-mode
ExecStart=-/usr/bin/systemctl reset-failed tierflow-shell.service
ExecStart=/usr/bin/systemctl start tierflow-shell.service
EOF

cat > /usr/share/applications/tierflow-return-appliance.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=返回 TierFlow 一体机
Comment=退出维护模式并恢复全屏 TierFlow 系统
Exec=pkexec /usr/local/sbin/tierflow-return-appliance
Icon=system-reboot
Terminal=false
StartupNotify=false
Categories=System;
EOF
chmod 0644 /usr/share/applications/tierflow-return-appliance.desktop

install -d -o "${maintenance_user}" -g "${maintenance_user}" -m 0755 \
  "${maintenance_home}/Desktop"
ln -sfn \
  /usr/share/applications/tierflow-return-appliance.desktop \
  "${maintenance_home}/Desktop/返回 TierFlow 一体机.desktop"
chown -h "${maintenance_user}:${maintenance_user}" \
  "${maintenance_home}/Desktop/返回 TierFlow 一体机.desktop"

cat > /etc/systemd/system/tierflow-shell.service <<'EOF'
[Unit]
Description=TierFlow DGX Spark single-application system shell
Requires=tierflow-stack.service seatd.service
After=systemd-user-sessions.service tierflow-stack.service seatd.service
Conflicts=getty@tty1.service display-manager.service tierflow-maintenance-mode.service
ConditionPathExists=!/run/tierflow-maintenance-mode
OnFailure=tierflow-shell-fallback.service
StartLimitIntervalSec=60
StartLimitBurst=4

[Service]
Type=simple
User=tierflow-shell
Group=tierflow-shell
SupplementaryGroups=video render input audio
WorkingDirectory=/var/lib/tierflow-shell
RuntimeDirectory=tierflow-shell
RuntimeDirectoryMode=0700
Environment=HOME=/var/lib/tierflow-shell
Environment=XDG_RUNTIME_DIR=/run/tierflow-shell
Environment=XDG_CONFIG_HOME=/var/lib/tierflow-shell/config
Environment=XDG_CACHE_HOME=/var/lib/tierflow-shell/cache
Environment=XDG_DATA_HOME=/var/lib/tierflow-shell/.local/share
Environment=XDG_SESSION_TYPE=wayland
Environment=XDG_CURRENT_DESKTOP=TierFlow
Environment=LIBSEAT_BACKEND=seatd
Environment=GBM_BACKEND=nvidia-drm
Environment=__GLX_VENDOR_LIBRARY_NAME=nvidia
Environment=GDK_SCALE=2
Environment=GDK_DPI_SCALE=1
Environment=WLR_NO_HARDWARE_CURSORS=1
Environment=XCURSOR_SIZE=48
Environment=XCURSOR_THEME=Adwaita
Environment=WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1
ExecStartPre=/usr/bin/sh -c 'for attempt in $(seq 1 60); do for card in /dev/dri/by-path/pci-*-card /dev/dri/card*; do test -c "$card" && exit 0; done; sleep 1; done; exit 1'
ExecStartPre=/usr/bin/sh -c '/usr/bin/setterm --blank 0 --powersave off --powerdown 0 < /dev/tty1 || true'
ExecStart=/usr/local/bin/tierflow-cage-session
Restart=always
RestartSec=3
TimeoutStartSec=120
TimeoutStopSec=15
KillMode=control-group
TTYPath=/dev/tty1
StandardInput=tty-force
StandardOutput=journal
StandardError=journal
TTYReset=yes
TTYVHangup=yes
TTYVTDisallocate=yes
NoNewPrivileges=false
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectControlGroups=true
ProtectKernelLogs=true
ProtectKernelModules=true
ProtectKernelTunables=true
ReadWritePaths=/var/lib/tierflow-shell /run/tierflow-shell

[Install]
WantedBy=multi-user.target
EOF

if [[ ${requires_local_stack} == true ]]; then
  shell_requires='Requires=tierflow-stack.service seatd.service'
  shell_after='After=systemd-user-sessions.service tierflow-stack.service seatd.service'
else
  shell_requires='Requires=seatd.service'
  shell_after='After=systemd-user-sessions.service network-online.target seatd.service'
fi
sed -i \
  -e "s|^Requires=tierflow-stack.service seatd.service$|${shell_requires}|" \
  -e "s|^After=systemd-user-sessions.service tierflow-stack.service seatd.service$|${shell_after}|" \
  /etc/systemd/system/tierflow-shell.service

cat > /etc/systemd/system/tierflow-shell-fallback.service <<'EOF'
[Unit]
Description=Restore GNOME if the TierFlow system shell cannot start
After=tierflow-shell.service

[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl start gdm.service
EOF

systemctl daemon-reload
shell_was_active=false
if systemctl is-active --quiet tierflow-shell.service; then
  shell_was_active=true
  systemctl stop tierflow-shell.service
fi
systemctl stop tierflow-shell-fallback.service 2>/dev/null || true
systemctl enable --now seatd.service
systemctl restart seatd.service
systemctl enable tierflow-shell.service

if [[ -f ${epiphany_profile}/ephy-history.db ]]; then
  browser_zoom=$(tr -d '[:space:]' < "${browser_zoom_config}")
  sqlite3 "${epiphany_profile}/ephy-history.db" \
    "UPDATE hosts SET zoom_level=${browser_zoom};"
  chown "${shell_user}:${shell_user}" \
    "${epiphany_profile}/ephy-history.db" \
    "${epiphany_profile}/ephy-history.db-shm" \
    "${epiphany_profile}/ephy-history.db-wal" 2>/dev/null || true
fi

if [[ ${activate} == "--activate" ]]; then
  rm -f /run/tierflow-maintenance-mode
  systemctl set-default multi-user.target
  systemctl stop tierflow-shell-fallback.service 2>/dev/null || true
  systemctl stop gdm.service
  systemctl reset-failed tierflow-shell.service
  systemctl restart tierflow-shell.service
elif [[ ${shell_was_active} == true ]]; then
  systemctl restart tierflow-shell.service
fi

echo "TierFlow Spark kiosk configuration completed (${activate}, ${appliance_url})."
