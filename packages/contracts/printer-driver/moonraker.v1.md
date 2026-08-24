# Moonraker PrinterDriver v1

This is the normative allow-list for the Relay ↔ Moonraker adapter. The
adapter MUST fail closed: methods not listed here, G-code, macros, and raw JSON
RPC are rejected and never sent to the printer.

| Internal operation | Moonraker method | Preconditions | ACK / timeout | Idempotency |
| --- | --- | --- | --- | --- |
| `getState` | `printer.objects.query` (`print_stats`, `heater_bed`, `extruder`, `virtual_sdcard`, optional `chamber`) | connected; read-only | JSON-RPC result; 15s | read-only, key may be retried |
| `uploadFile` | `POST /server/files/upload`, `root=gcodes` | filename is a basename, non-empty payload, authenticated HTTP | HTTP 2xx + `item.path`; request timeout 60s | Relay command key; retry only with same key and same content hash |
| `start` | `printer.print.start {filename}` | uploaded file exists; state `idle` or `ready` | JSON-RPC result; 15s | exactly-once by Relay key; duplicate ACK must not issue a second start |
| `resume` | `printer.print.resume` | state `paused` | JSON-RPC result; 15s | exactly-once by Relay key |
| `pause` | `printer.print.pause` | state `printing` | JSON-RPC result; 15s | exactly-once by Relay key |
| `cancel` | `printer.print.cancel` | state `printing` or `paused` | JSON-RPC result; 15s | exactly-once by Relay key |

The Relay envelope carries `command_id` (UUID), `operation`, and an optional
`content_sha256`. The adapter does not invent keys and does not execute a
second request for a previously acknowledged `command_id`; the Relay owns the
durable deduplication record. A Moonraker JSON-RPC response is the ACK. Timeout
is an unknown outcome: the caller must query state before retrying.

Dangerous or unspecified methods (`printer.gcode.script`, `printer.gcode.help`,
`printer.emergency_stop`, arbitrary `printer.*`, macros, and all unknown
methods) are `reject`, with no network call. `emergency_stop` is intentionally
not exposed in v1; stop means the allow-listed cancel operation.

Contract fixtures live beside the adapter tests and cover happy path, timeout,
duplicate command, and rejection. Relay must preserve `command_id` end to end;
QA acceptance requires these fixtures to pass against the adapter and Relay.
