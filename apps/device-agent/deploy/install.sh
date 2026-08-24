#!/usr/bin/env sh
set -eu

artifact=${1:?usage: install.sh ARTIFACT MANIFEST PUBLIC_KEY}
manifest=${2:?usage: install.sh ARTIFACT MANIFEST PUBLIC_KEY}
public_key=${3:?usage: install.sh ARTIFACT MANIFEST PUBLIC_KEY}
root=${DEVICE_AGENT_ROOT:-/opt/3mf-device-agent}
state=${DEVICE_AGENT_STATE:-/var/lib/3mf-device-agent}
service=portal.device-agent
service_user=${DEVICE_AGENT_USER:-3mf-agent}
unit_path=${DEVICE_AGENT_SYSTEMD_UNIT:-/etc/systemd/system/portal.device-agent.service}
health_url=${DEVICE_AGENT_HEALTH_URL:-http://127.0.0.1:9797/health}
health_deadline_seconds=${DEVICE_AGENT_HEALTH_DEADLINE_SECONDS:-30}
test "$(id -u)" -eq 0 || { echo 'install must run as root' >&2; exit 1; }
command -v minisign >/dev/null 2>&1 || { echo 'minisign is required' >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo 'Node.js 22 is required' >&2; exit 1; }
test "$(node -p 'process.versions.node.split(`.`)[0]')" = 22 || { echo 'Node.js 22 is required' >&2; exit 1; }
minisign -Vm "$artifact" -P "$public_key" >/dev/null
minisign -Vm "$manifest" -P "$public_key" >/dev/null
expected_checksum=$(sed -n '1s/[[:space:]].*$//p' "$artifact.sha256")
actual_checksum=$(sha256sum "$artifact" | sed -n '1s/[[:space:]].*$//p')
test -n "$expected_checksum" && test "$expected_checksum" = "$actual_checksum" || { echo 'artifact checksum verification failed' >&2; exit 1; }
manifest_fields=$(node "$(dirname "$0")/verify-manifest.mjs" "$manifest" "$artifact" "$state")
version=$(printf '%s\n' "$manifest_fields" | sed -n '1p')
release="$root/releases/$version"
if ! id "$service_user" >/dev/null 2>&1; then
  if command -v useradd >/dev/null 2>&1; then
    useradd --system --home-dir "$state" --shell /usr/sbin/nologin "$service_user"
  else
    addgroup -S "$service_user" >/dev/null 2>&1 || true
    adduser -S -D -H -h "$state" -s /sbin/nologin -G "$service_user" "$service_user" >/dev/null
  fi
fi
mkdir -p "$root/releases" "$state" "$(dirname "$unit_path")"
chown "$service_user:$service_user" "$state"
chmod 700 "$state"
install -m 0644 "$(dirname "$0")/portal.device-agent.service" "$unit_path"
systemctl daemon-reload 2>/dev/null || true
test ! -e "$release" || { echo 'release already installed' >&2; exit 1; }
tmp="$root/releases/.${version}.tmp.$$"
mkdir "$tmp"
trap 'rm -rf "$tmp"' EXIT
tar -xzf "$artifact" -C "$tmp"
test -f "$tmp/.release-dist/main.js" || { echo 'invalid artifact' >&2; exit 1; }
node "$tmp/.release-dist/main.js" --preflight >/dev/null
mv "$tmp" "$release"
old=$(readlink "$root/current" 2>/dev/null || true)
ln -sfn "$release" "$root/next"
systemctl stop "$service" 2>/dev/null || true
if [ -n "$old" ]; then ln -sfn "$old" "$root/previous"; fi
mv -Tf "$root/next" "$root/current"
if ! systemctl start "$service" || ! "$(dirname "$0")/wait-for-health.sh" "$health_url" "$health_deadline_seconds"; then
  [ -n "$old" ] && ln -sfn "$old" "$root/current"
  systemctl start "$service" 2>/dev/null || true
  exit 1
fi
echo "installed $version"
