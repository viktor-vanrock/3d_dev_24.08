#!/usr/bin/env sh
set -eu

url=${1:?usage: wait-for-health.sh URL DEADLINE_SECONDS}
deadline=${2:?usage: wait-for-health.sh URL DEADLINE_SECONDS}
started=$(date +%s)
while [ "$(($(date +%s) - started))" -lt "$deadline" ]; do
  response=$(curl -sS --max-time 2 -w '\n%{http_code}' "$url" 2>/dev/null || true)
  status=$(printf '%s\n' "$response" | tail -n 1)
  body=$(printf '%s\n' "$response" | sed '$d')
  if [ "$status" = 200 ] && printf '%s' "$body" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);if(v.version!=="health.v1"||!["healthy","degraded"].includes(v.status))process.exit(1)})'; then
    exit 0
  fi
  sleep 1
done
echo "device-agent health deadline exceeded" >&2
exit 1
