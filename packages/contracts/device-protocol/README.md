# `device-protocol/v1` — relay ↔ device-agent

Единственный активный wire-contract находится в [`v1/`](./v1/README.md):

- `schema.json` — closed directional frame unions;
- `generated.ts` — детерминированно сгенерированные TypeScript types;
- `runtime.ts` — общие runtime validators relay и device-agent;
- `limits.json` и `error-codes.json` — transport/field limits и стабильные коды;
- `fixtures/valid.json` и `fixtures/invalid.json` — golden interop cases.

Gateway проходит TLS 1.3 mutual authentication до protocol hello. После
`hello_challenge` он обязан отправить `hello` с тем же nonce и точным
`protocol_version: "v1"`; gateway identity берётся только из проверенного
индивидуального certificate SAN, а не из frame или bearer token. Versionless и
не-v1 hello не имеют compatibility fallback и отклоняются до создания session.

Relay и device-agent импортируют `@portal/contracts/device-protocol/v1`. Изменение
wire-shape требует обновить schema, generated artifact и обе fixture collections;
`pnpm --filter @portal/contracts device-protocol:check` проверяет drift и validators.

Командный transport ACK (`command_ack`) не означает исполнение: authoritative terminal
outcome приходит только в `command_result`. File transfer подтверждает next sequence и
byte offset, поэтому Nest relay может продолжить range-stream после reconnect без
whole-file buffering.
