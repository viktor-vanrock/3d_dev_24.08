#!/usr/bin/env sh
set -eu

test "$(id -u)" -eq 0 || { echo 'uninstall must run as root' >&2; exit 1; }

systemctl disable --now portal.device-agent 2>/dev/null || true
rm -f /etc/systemd/system/portal.device-agent.service
systemctl daemon-reload
rm -rf /opt/3mf-device-agent /etc/3mf-device-agent /var/lib/3mf-device-agent
if id 3mf-agent >/dev/null 2>&1; then
  userdel 3mf-agent
fi
echo 'device-agent removed; revoke the device in the portal before running this script.'
