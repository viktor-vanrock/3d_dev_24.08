# Nest relay diagnostics contract

`apps/relay` пишет structured Pino events только с allowlisted metadata и передаёт
opaque `x-correlation-id` через generated `/internal/relay/v1/*` client. Logs, metrics и
safe protocol errors не содержат service token, certificates/private keys, agent
credentials, presigned URLs, command payloads, file bytes или raw provider/DB errors.

## Активная наблюдаемость

Observability listener отделён от gateway WSS/mTLS listener и публикуется только на
loopback:

- `GET /health` — процесс жив;
- `GET /ready` — runtime готов принимать работу;
- `GET /metrics` — Prometheus families для sessions/auth/heartbeat/protocol/backpressure,
  command claim/result latency и inflight work.

Gateway boundary не отдаёт HTTP diagnostics. Поддержка не запрашивает in-memory bundle:
оператор использует redacted structured journal и метрики, сохраняя correlation ID без
секретов и payload.

## Локальная проверка compiled runtime

```sh
pnpm --filter @portal/relay run typecheck
pnpm --filter @portal/relay run lint
pnpm --filter @portal/relay run test
pnpm run build:relay
pnpm run check:relay-deploy
curl --fail --silent --show-error http://127.0.0.1:3012/health
curl --fail --silent --show-error http://127.0.0.1:3012/ready
curl --fail --silent --show-error http://127.0.0.1:3012/metrics | grep '^relay_'
```

Health/metrics сами по себе не доказывают gateway path. Release gate дополнительно
запускает real mTLS WSS v1 handshake, command/file interop, revoke/fail-closed tests и
bounded SIGTERM drain. Compatibility runtime не существует; до production deployment
обычный rollback — source-control revert целевого Nest artifact/config.
