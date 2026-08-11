#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

appliance_user=tierflow
appliance_home=/home/${appliance_user}
appliance_url=http://127.0.0.1:3000/sign-in
# Ubuntu 24.04 ships Firefox as a confined Snap.  A profile directly under
# ~/.mozilla is readable but not writable by the Snap, which leaves Firefox
# running without a usable window.  Keep the appliance profile in the Snap's
# per-user common data directory so it survives Firefox refreshes and remains
# writable under AppArmor confinement.
firefox_profile=${appliance_home}/snap/firefox/common/tierflow-kiosk-profile
gdm_config=/etc/gdm3/custom.conf

if ! command -v xdotool >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y --no-install-recommends xdotool
fi

# VirtualBox's VMSVGA/Wayland combination is unreliable on the validation
# host.  The production DGX appliance will use a dedicated Wayland
# compositor, but this development VM deliberately uses GNOME on Xorg.
if grep -qE '^[#[:space:]]*WaylandEnable[[:space:]]*=' "${gdm_config}"; then
  sed -i -E 's/^[#[:space:]]*WaylandEnable[[:space:]]*=.*/WaylandEnable=false/' "${gdm_config}"
else
  sed -i '/^\[daemon\]/a WaylandEnable=false' "${gdm_config}"
fi

if grep -qE '^[#[:space:]]*AutomaticLoginEnable[[:space:]]*=' "${gdm_config}"; then
  sed -i -E 's/^[#[:space:]]*AutomaticLoginEnable[[:space:]]*=.*/AutomaticLoginEnable = true/' "${gdm_config}"
else
  sed -i '/^\[daemon\]/a AutomaticLoginEnable = true' "${gdm_config}"
fi

if grep -qE '^[#[:space:]]*AutomaticLogin[[:space:]]*=' "${gdm_config}"; then
  sed -i -E "s/^[#[:space:]]*AutomaticLogin[[:space:]]*=.*/AutomaticLogin = ${appliance_user}/" "${gdm_config}"
else
  sed -i "/^\[daemon\]/a AutomaticLogin = ${appliance_user}" "${gdm_config}"
fi

install -d -o "${appliance_user}" -g "${appliance_user}" -m 0755 \
  "${appliance_home}/.config" \
  "${appliance_home}/.config/autostart" \
  "${firefox_profile}"

cat > "${firefox_profile}/user.js" <<EOF
user_pref("browser.sessionstore.max_resumed_crashes", 0);
user_pref("browser.sessionstore.resume_from_crash", false);
user_pref("browser.sessionstore.resume_session_once", false);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.startup.homepage", "${appliance_url}");
user_pref("browser.startup.page", 1);
user_pref("datareporting.healthreport.uploadEnabled", false);
user_pref("gfx.webrender.force-disabled", true);
user_pref("gfx.x11-egl.force-disabled", true);
user_pref("layers.acceleration.disabled", true);
user_pref("media.hardware-video-decoding.enabled", false);
user_pref("ui.prefersReducedMotion", 1);
user_pref("signon.rememberSignons", false);
EOF
chown -R "${appliance_user}:${appliance_user}" "${appliance_home}/snap/firefox/common"

cat > /usr/local/bin/tierflow-kiosk <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail

runtime_dir=\${XDG_RUNTIME_DIR:-/run/user/\$(id -u)}
install -d -m 0700 "\${runtime_dir}"
exec 9>"\${runtime_dir}/tierflow-kiosk.lock"

# A restarted GDM session must never create a second browser supervisor.
# Keep the lock file descriptor open across exec so Firefox owns the lock for
# the full lifetime of the appliance window.
if ! /usr/bin/flock --nonblock 9; then
  exit 0
fi

for attempt in \$(seq 1 120); do
  if /usr/bin/curl --fail --silent --show-error http://127.0.0.1:3000/api/status >/dev/null 2>&1; then
    break
  fi
  /usr/bin/sleep 1
done

rm -f \
  "${firefox_profile}/.parentlock" \
  "${firefox_profile}/sessionstore.jsonlz4" \
  "${firefox_profile}/sessionstore-backups/recovery.jsonlz4" \
  "${firefox_profile}/sessionstore-backups/recovery.baklz4"

# GNOME opens its Activities overview while the launcher waits for TierFlow.
# Once Firefox has mapped a real window, dismiss that overview so kiosk mode
# becomes the only visible UI. Close fd 9 in the helper so it cannot keep the
# singleton lock alive after Firefox exits.
(
  exec 9>&-
  for _ in \$(seq 1 60); do
    if /usr/bin/xdotool search --onlyvisible --class firefox >/dev/null 2>&1; then
      # Let the first software-rendered frame complete before leaving the
      # overview. Exiting too early can leave VMSVGA displaying an undamaged
      # white buffer even though Firefox has loaded the page.
      /usr/bin/sleep 8
      /usr/bin/xdotool key Escape
      exit 0
    fi
    /usr/bin/sleep 0.5
  done
) &

exec /usr/bin/firefox --no-remote --profile "${firefox_profile}" --kiosk --new-window ${appliance_url}
EOF
chmod 0755 /usr/local/bin/tierflow-kiosk

install -d -o "${appliance_user}" -g "${appliance_user}" -m 0755 \
  "${appliance_home}/.config/systemd/user"

cat > "${appliance_home}/.config/systemd/user/tierflow-kiosk.service" <<'EOF'
[Unit]
Description=TierFlow appliance kiosk
After=graphical-session.target
PartOf=graphical-session.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
Environment=LIBGL_ALWAYS_SOFTWARE=1
Environment=MOZ_X11_EGL=0
ExecStart=/usr/local/bin/tierflow-kiosk
Restart=always
RestartSec=3
KillMode=control-group
TimeoutStopSec=10

[Install]
WantedBy=graphical-session.target
EOF

cat > "${appliance_home}/.config/autostart/tierflow-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=TierFlow System
Comment=TierFlow appliance validation shell
Exec=/usr/bin/systemctl --user restart tierflow-kiosk.service
Terminal=false
X-GNOME-Autostart-enabled=true
X-GNOME-Autostart-Delay=3
OnlyShowIn=GNOME;Ubuntu;
EOF

touch "${appliance_home}/.config/gnome-initial-setup-done"

for autostart_name in \
  ubuntu-advantage-notification.desktop \
  ubuntu-report-on-upgrade.desktop \
  update-notifier.desktop; do
  cat > "${appliance_home}/.config/autostart/${autostart_name}" <<'EOF'
[Desktop Entry]
Type=Application
Hidden=true
EOF
done

chown -R "${appliance_user}:${appliance_user}" "${appliance_home}/.config"

install -d -m 0755 /etc/dconf/profile /etc/dconf/db/local.d
cat > /etc/dconf/profile/user <<'EOF'
user-db:user
system-db:local
EOF

cat > /etc/dconf/db/local.d/00-tierflow-appliance <<'EOF'
[org/gnome/desktop/session]
idle-delay=uint32 0

[org/gnome/desktop/screensaver]
lock-enabled=false
ubuntu-lock-on-suspend=false

[org/gnome/settings-daemon/plugins/power]
sleep-inactive-ac-type='nothing'
sleep-inactive-battery-type='nothing'

[org/gnome/desktop/notifications]
show-banners=false

[org/gnome/desktop/interface]
enable-animations=false

[org/gnome/shell]
disable-user-extensions=true
enabled-extensions=@as []
EOF

install -d -m 0755 /etc/firefox/policies
cat > /etc/firefox/policies/policies.json <<EOF
{
  "policies": {
    "DisableFirefoxStudies": true,
    "DisableProfileImport": true,
    "DisableTelemetry": true,
    "DisplayBookmarksToolbar": "never",
    "DontCheckDefaultBrowser": true,
    "HardwareAcceleration": false,
    "Homepage": {
      "StartPage": "homepage",
      "URL": "${appliance_url}"
    },
    "OfferToSaveLogins": false,
    "OverrideFirstRunPage": "",
    "OverridePostUpdatePage": "",
    "PasswordManagerEnabled": false,
    "RequestedLocales": ["zh-CN", "en-US"]
  }
}
EOF

dconf update
systemctl mask systemd-networkd-wait-online.service
systemctl set-default graphical.target

# VirtualBox running through the Windows Hyper-V/NEM compatibility backend can
# pause all guest vCPUs long enough for systemd's three-minute service
# watchdogs to expire. Restarting logind after such a host pause destroys the
# graphical seat and is what turns a temporary stall into a persistent black
# or white screen. Disable only these service-level watchdogs in the validation
# VM; normal Restart= policies still handle real process failures.
for watched_unit in \
  systemd-logind.service \
  systemd-journald.service \
  systemd-udevd.service \
  systemd-oomd.service; do
  dropin_dir="/etc/systemd/system/${watched_unit}.d"
  install -d -m 0755 "${dropin_dir}"
  cat > "${dropin_dir}/10-tierflow-nem.conf" <<'EOF'
[Service]
WatchdogSec=0
EOF
done
systemctl daemon-reload

echo "TierFlow kiosk configuration completed."
