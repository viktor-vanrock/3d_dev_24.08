#!/usr/bin/env bash
set -euo pipefail

repo=$(cd "$(dirname "$0")/../../.." && pwd)
image=${DEVICE_AGENT_SMOKE_IMAGE:-node:22-alpine}
command -v docker >/dev/null 2>&1 || { echo "docker is required for the clean-host smoke" >&2; exit 1; }

docker run --rm -v "$repo:/workspace:ro" "$image" sh -lc \
  'apk add --no-cache bash minisign curl >/dev/null && exec bash /workspace/apps/device-agent/deploy/clean-host-smoke-container.sh'

