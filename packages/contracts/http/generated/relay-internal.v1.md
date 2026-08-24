# Portal Relay Internal API v1

Generated from `relay-internal.v1.openapi.json`. Do not edit directly.

All operations require the relay-only `x-relay-service-token` api-key credential and `x-correlation-id`. Mutations marked “operation identity” also require `x-operation-id`; the same identity and request fingerprint replay the accepted result, while a contradictory payload is a conflict. Gateway credentials are not valid service credentials.

| Operation | Method | Path | Retry |
| --- | --- | --- | --- |
| `relaySessionAuthorize` | `POST` | `/internal/relay/v1/sessions/authorize` | operation identity |
| `relaySessionHeartbeat` | `POST` | `/internal/relay/v1/sessions/{sessionId}/heartbeat` | operation identity |
| `relaySessionClose` | `POST` | `/internal/relay/v1/sessions/{sessionId}/close` | operation identity |
| `relayGatewaysRevalidate` | `POST` | `/internal/relay/v1/gateways/revalidate` | idempotent |
| `relayCommandsClaim` | `POST` | `/internal/relay/v1/commands/claim` | operation identity |
| `relayCommandLeaseHeartbeat` | `POST` | `/internal/relay/v1/commands/{commandId}/lease-heartbeat` | operation identity |
| `relayCommandResult` | `PUT` | `/internal/relay/v1/commands/{commandId}/result` | operation identity |
| `relayTransferMetadata` | `GET` | `/internal/relay/v1/transfers/{transferId}/metadata` | read |
| `relayTransferSourceUrl` | `POST` | `/internal/relay/v1/transfers/{transferId}/source-url` | operation identity |
| `relayTransferProgress` | `PUT` | `/internal/relay/v1/transfers/{transferId}/progress` | operation identity |
| `relayTransferResult` | `PUT` | `/internal/relay/v1/transfers/{transferId}/result` | operation identity |

Every success response and every safe error response has a named closed schema. Transfer source URLs are HTTPS, range-capable, immutable-version scoped, no-store and expire within five minutes.
