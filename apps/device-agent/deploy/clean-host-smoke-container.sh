#!/usr/bin/env bash
set -euo pipefail

mkdir -p /work
tar -C /workspace --exclude=node_modules --exclude='*/node_modules' --exclude='.git' --exclude='.release-dist' -cf - . | tar -C /work -xf -
cd /work
corepack enable
corepack pnpm install --frozen-lockfile >/dev/null
minisign -G -W -p /tmp/release.pub -s /tmp/release.key >/dev/null
export MINISIGN_SECRET_KEY=/tmp/release.key MINISIGN_PUBLIC_KEY_FILE=/tmp/release.pub
commit=1524467
mkdir -p /tmp/releases
for version in 1.2.3 1.2.4 1.2.5; do
  apps/device-agent/deploy/release.sh "$version" "$commit" /tmp/releases >/dev/null
done

mkdir -p /tmp/fake-bin /tmp/agent-state/transfers
printf preserved >/tmp/agent-state/operator-marker
cat >/tmp/health.mjs <<'EOF'
import { createServer } from "node:http";
createServer((_request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ version: "health.v1", status: "degraded", reason_code: "relay_not_configured" }));
}).listen(9797, "127.0.0.1");
EOF
cat >/tmp/fake-bin/systemctl <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  stop)
    if [[ -f /tmp/device-agent-health.pid ]]; then kill "$(cat /tmp/device-agent-health.pid)" 2>/dev/null || true; rm -f /tmp/device-agent-health.pid; fi
    ;;
  start)
    version=$(node -p 'require("/tmp/agent-root/current/.release-dist/build-info.json").version')
    if [[ "${SMOKE_FAIL_VERSION:-}" == "$version" ]]; then exit 1; fi
    node /tmp/health.mjs >/tmp/device-agent-health.log 2>&1 & echo $! >/tmp/device-agent-health.pid
    ;;
esac
EOF
chmod +x /tmp/fake-bin/systemctl
export PATH=/tmp/fake-bin:$PATH DEVICE_AGENT_ROOT=/tmp/agent-root DEVICE_AGENT_STATE=/tmp/agent-state DEVICE_AGENT_HEALTH_DEADLINE_SECONDS=5
public_key=$(sed -n '2p' /tmp/release.pub)
install_release() {
  local version=$1
  local tools="/tmp/installer-$version"
  rm -rf "$tools"
  mkdir -p "$tools"
  tar -xzf "/tmp/releases/3mf-device-agent-$version.tar.gz" -C "$tools"
  "$tools/deploy/install.sh" "/tmp/releases/3mf-device-agent-$version.tar.gz" "/tmp/releases/3mf-device-agent-$version.manifest.json" "$public_key"
}

install_release 1.2.3 >/dev/null
test "$(node -p 'require("/tmp/agent-root/current/.release-dist/build-info.json").version')" = 1.2.3
install_release 1.2.4 >/dev/null
test "$(node -p 'require("/tmp/agent-root/current/.release-dist/build-info.json").version')" = 1.2.4

export SMOKE_FAIL_VERSION=1.2.5
if install_release 1.2.5 >/dev/null 2>&1; then echo "failed upgrade was accepted" >&2; exit 1; fi
test "$(node -p 'require("/tmp/agent-root/current/.release-dist/build-info.json").version')" = 1.2.4
unset SMOKE_FAIL_VERSION

cp /tmp/releases/3mf-device-agent-1.2.4.tar.gz /tmp/tampered.tar.gz
printf tamper >>/tmp/tampered.tar.gz
cp /tmp/releases/3mf-device-agent-1.2.4.tar.gz.sha256 /tmp/tampered.tar.gz.sha256
if /tmp/installer-1.2.4/deploy/install.sh /tmp/tampered.tar.gz /tmp/releases/3mf-device-agent-1.2.4.manifest.json "$public_key" >/dev/null 2>&1; then
  echo "tampered artifact was accepted" >&2; exit 1
fi

printf '{"schemaVersion":2}' >/tmp/agent-state/transfers/future.json
if install_release 1.2.3 >/dev/null 2>&1; then echo "incompatible downgrade was accepted" >&2; exit 1; fi
test "$(cat /tmp/agent-state/operator-marker)" = preserved
test "$(node -p 'require("/tmp/agent-root/current/.release-dist/build-info.json").version')" = 1.2.4
artifact_sha256=$(sha256sum /tmp/releases/3mf-device-agent-1.2.4.tar.gz | sed -n '1s/[[:space:]].*$//p')
echo "device-agent clean-host evidence: version=1.2.4 commit=$commit artifact_sha256=$artifact_sha256 artifact_signature=verified manifest_signature=verified state=preserved"
echo "device-agent clean-host smoke: PASS"
