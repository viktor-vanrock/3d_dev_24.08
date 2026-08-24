#!/bin/sh
# Энтрипоинт изолированного OpenCode runtime (MF-2045). Строит рабочий
# opencode.jsonc из урезанного базового конфига (opencode.runtime.config.base.json —
# bash/write/edit/patch выключены, permission.* = deny) и добавляет
# HYPERPC-провайдеры, ЕСЛИ заданы соответствующие URL — без них раннтайм
# просто стартует без единого провайдера (тот же паттерн деградации без
# креда, что и весь остальной giga/assistant-код, см. hyperpc_client.py).
#
# Model id НЕ хардкодим: слоты 1/2 — сырой llama-server, отдают модель
# полным Windows-путём до .gguf в /v1/models, и путь уже менялся при свопе
# GPU/модели на HYPERPC (docs/process/hyperpc.local.llm.md). Дискаверим на
# каждый старт контейнера тем же способом, что giga.assistant.hyperpc_client
# .discover_model — если HYPERPC недоступен на старте, соответствующий
# провайдер просто не добавляется (не ошибка контейнера).
set -eu

CONFIG_DIR="${OPENCODE_CONFIG_DIR:-/home/opencode/.config/opencode}"
mkdir -p "$CONFIG_DIR"
CONFIG_FILE="$CONFIG_DIR/opencode.jsonc"
cp /home/opencode/opencode.config.base.json "$CONFIG_FILE"

discover_model() {
  curl -sf -m 5 "$1/v1/models" 2>/dev/null | jq -r '.data[0].id // empty' 2>/dev/null || true
}

add_provider() {
  name="$1"; base_url="$2"; tool_call="$3"; ctx="$4"; out="$5"
  [ -z "$base_url" ] && return 0
  model_id=$(discover_model "$base_url")
  if [ -z "$model_id" ]; then
    echo "opencode-runtime: ${name} — модель не обнаружена на ${base_url}/v1/models, провайдер пропущен" >&2
    return 0
  fi
  tmp="$(mktemp)"
  jq --arg name "$name" \
     --arg base "${base_url}/v1" \
     --arg model "$model_id" \
     --argjson toolcall "$tool_call" \
     --argjson ctx "$ctx" \
     --argjson out "$out" \
     '.provider[$name] = { npm: "@ai-sdk/openai-compatible", options: { baseURL: $base }, models: { ($model): { tool_call: $toolcall, limit: { context: $ctx, output: $out } } } }' \
     "$CONFIG_FILE" > "$tmp" && mv "$tmp" "$CONFIG_FILE"
  echo "opencode-runtime: ${name} -> ${model_id} (${base_url})"
}

add_provider hyperpc-slot1 "${HYPERPC_STRUCTURED_URL:-}" true 32768 8192
add_provider hyperpc-slot2 "${HYPERPC_FAST_URL:-}" false 65536 4096

exec opencode serve --hostname 0.0.0.0 --port "${OPENCODE_PORT:-4096}"
