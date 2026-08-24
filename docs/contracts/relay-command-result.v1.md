# Нормализованный результат relay-команды v1

Owner-scoped `GET /me/printers/:id/commands/:commandId`, device-scoped
`GET /me/devices/:deviceId/commands/:commandId` и Public API command read используют один
canonical lifecycle:

`queued | leased | delivered | acknowledged | executed | failed | expired`

Только `executed`, `failed` и `expired` терминальны. Transport frame `command_ack`
подтверждает приём агентом и переводит lease в `acknowledged`, но не доказывает исполнение.
Терминальный результат приходит отдельным canonical `command_result`.

## Ответ

```json
{
  "command_id": "…",
  "correlation_id": "…",
  "device_id": "…",
  "command": "pause",
  "status": "acknowledged",
  "raw_status": "acknowledged",
  "code": null,
  "message": null,
  "timestamp": "2026-08-11T12:00:01.000Z",
  "created_at": "2026-08-11T12:00:00.000Z",
  "acked_at": "2026-08-11T12:00:01.000Z"
}
```

`code` и `message` заполнены только безопасным allowlisted outcome для terminal failure.
`correlation_id` — opaque UUID. Token, command payload, agent credential, certificate,
device secret и raw diagnostics наружу не возвращаются.

## Claim, fencing и replay

Portal PostgreSQL `device_commands` — единственный durable source. API выдаёт bounded claim
только live authorized relay session, максимум один active command на устройство, с owner,
opaque claim token, monotonic generation, lease expiry и attempt count. Lease heartbeat и
terminal write принимаются только с current fence; поздний результат старого relay process
отклоняется.

Повтор одного operation identity возвращает ранее принятый результат, а contradictory terminal
payload получает conflict. Device-agent хранит bounded terminal-result ledger по command
id/sequence, поэтому duplicate frame после reconnect/restart не исполняет команду повторно.

Contract authority: `packages/contracts/http/relay-internal.v1.openapi.json` и
`packages/contracts/device-protocol/v1`. Реализация: `apps/relay/src/commands`,
`apps/api/src/modules/{devices,relayInternal}` и `apps/device-agent/src/relay/commandTerminalLedger.ts`.
