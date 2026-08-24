#!/usr/bin/env bash
set -euo pipefail

version="${1:?usage: release.sh VERSION COMMIT_SHA [OUT_DIR]}"
commit="${2:?usage: release.sh VERSION COMMIT_SHA [OUT_DIR]}"
out="${3:-dist/releases}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$ ]] || { echo "invalid version" >&2; exit 2; }
(( ${#version} <= 40 )) || { echo "version is too long for Relay agent identity" >&2; exit 2; }
command -v minisign >/dev/null 2>&1 || { echo 'minisign is required for production release' >&2; exit 1; }
: "${MINISIGN_SECRET_KEY:?MINISIGN_SECRET_KEY is required}"
[[ "$commit" =~ ^[a-fA-F0-9]{7,64}$ ]] || { echo "invalid commit SHA" >&2; exit 2; }
mkdir -p "$out"
rm -rf "apps/device-agent/.release-dist"
pnpm --filter @portal/device-agent exec esbuild src/main.ts --bundle --format=esm --platform=node --target=node22 --sourcemap=external --outfile=.release-dist/main.js \
  --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
  --define:__AGENT_VERSION__=\"$version\" --define:__AGENT_COMMIT_SHA__=\"$commit\"
printf '{"version":"%s","commitSha":"%s"}\n' "$version" "$(printf '%s' "$commit" | tr '[:upper:]' '[:lower:]')" > apps/device-agent/.release-dist/build-info.json
archive="$out/3mf-device-agent-$version.tar.gz"
manifest="$out/3mf-device-agent-$version.manifest.json"
licenses="apps/device-agent/.release-dist/THIRD_PARTY_LICENSES.txt"
node apps/device-agent/deploy/write-licenses.mjs "$licenses"
tar -czf "$archive" -C apps/device-agent .release-dist deploy/portal.device-agent.service deploy/install.sh deploy/rollback.sh deploy/verify-manifest.mjs deploy/wait-for-health.sh
contents=$(tar -tzf "$archive")
if printf '%s\n' "$contents" | grep -E '(^|/)(src|test|tests|fixtures|node_modules|package\.json|pnpm-lock\.yaml|\.env|\.git)(/|$)|\.test\.[cm]?[jt]s$' >/dev/null; then
  echo "artifact contains forbidden development or secret-bearing paths" >&2
  exit 1
fi
test "$(printf '%s\n' "$contents" | sort)" = "$(printf '%s\n' '.release-dist/' '.release-dist/THIRD_PARTY_LICENSES.txt' '.release-dist/build-info.json' '.release-dist/main.js' '.release-dist/main.js.map' 'deploy/install.sh' 'deploy/portal.device-agent.service' 'deploy/rollback.sh' 'deploy/verify-manifest.mjs' 'deploy/wait-for-health.sh' | sort)" || {
  echo "artifact content is outside the release allowlist" >&2
  exit 1
}
sha256sum "$archive" > "$archive.sha256"
sha256=$(cut -d' ' -f1 "$archive.sha256")
RELEASE_VERSION="$version" RELEASE_COMMIT_SHA="$commit" RELEASE_ARTIFACT="$(basename "$archive")" RELEASE_SHA256="$sha256" \
  node apps/device-agent/deploy/write-manifest.mjs "$manifest"
minisign -Sm "$archive" -s "$MINISIGN_SECRET_KEY"
minisign -Sm "$manifest" -s "$MINISIGN_SECRET_KEY"
minisign -Vm "$archive" -p "${MINISIGN_PUBLIC_KEY_FILE:?MINISIGN_PUBLIC_KEY_FILE is required to verify the release}" >/dev/null
minisign -Vm "$manifest" -p "$MINISIGN_PUBLIC_KEY_FILE" >/dev/null
node apps/device-agent/.release-dist/main.js --preflight >/dev/null
printf 'artifact=%s\nmanifest=%s\nchecksum=%s\n' "$archive" "$manifest" "$archive.sha256"
