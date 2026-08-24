#!/usr/bin/env sh
set -eu

service=portal.device-agent
current=${DEVICE_AGENT_CURRENT:-/opt/3mf-device-agent/current}
previous=${DEVICE_AGENT_PREVIOUS:-/opt/3mf-device-agent/previous}

test "$(id -u)" -eq 0 || { echo 'rollback must run as root' >&2; exit 1; }
test -L "$previous" || { echo 'no previous release is available' >&2; exit 1; }

systemctl stop "$service"
ln -sfn "$(readlink "$previous")" "$current"
systemctl start "$service"
echo "rolled back to $(readlink "$current")"
