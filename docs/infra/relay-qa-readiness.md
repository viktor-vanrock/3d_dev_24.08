# Nest relay: QA readiness and live acceptance

Runbook for the compiled `@portal/relay` artifact and the first physical
Klipper/Moonraker agent on dev. Never copy service tokens, enroll codes, JWTs,
private keys or certificates into this document, logs or issues.

## Repository gate

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm run check:relay-deploy
pnpm --filter @portal/contracts relay-internal:check
pnpm --filter @portal/relay run typecheck
pnpm --filter @portal/relay run lint
pnpm --filter @portal/relay run test
pnpm run build:relay
test -f apps/relay/dist/main.js
```

These checks validate the target artifact and active templates. Legacy Go sources are not
part of acceptance and remain only until the separate removal gate.

## Host-local health/readiness

The observability listener is separate from gateway WSS and loopback-only. On dev it is
configured as `127.0.0.1:3012`:

```bash
curl -fsS http://127.0.0.1:3012/health   # {"status":"up"}
curl -fsS http://127.0.0.1:3012/ready    # {"status":"ready"}
curl -fsS http://127.0.0.1:3012/metrics | grep '^relay_'
```

Do not use a public `/health` route on `relay.dev.3mf.tech`: the public frontend carries
opaque TLS only to the mTLS gateway listener. `health` proves process liveness; `ready` is
the deployment gate.

## Restart and drain observation

On the dev host, by an operator with the already-approved sudo boundary:

```bash
sudo systemctl is-enabled portal.relay-dev.service
sudo systemctl is-active portal.relay-dev.service
sudo systemctl restart portal.relay-dev.service
curl -fsS http://127.0.0.1:3012/ready
journalctl -u portal.relay-dev -n 100 --no-pager
```

Expected: `ExecStart` runs `node .../apps/relay/dist/main.js`; readiness returns after restart;
the agent reconnects with a fresh v1 session; SIGTERM stops new accepts/claims and finishes
within the configured drain budget. Logs must contain only allowlisted identifiers/outcomes.

## Physical gateway checklist

1. The printer is reachable from the agent at `MOONRAKER_URL=http://<printer-ip>:7125`.
2. Moonraker credentials stay only in the agent's local secret configuration.
3. The operator issues and transmits a one-use enroll code through a protected channel.
4. `RELAY_URL=wss://relay.dev.3mf.tech/relay/ws` and the gateway presents its individual
   client certificate signed by the configured relay client CA.
5. A real TLS handshake reaches the compiled relay, v1 hello is accepted and metrics show
   `relay_active_sessions >= 1`.
6. Heartbeat updates authorized device state; an unauthorized device frame is rejected.
7. Network interruption causes reconnect without a second enroll and without duplicate
   terminal command execution.
8. Command claim/delivery/ACK/result and file resume are checked against API-owned durable state.
9. Revocation closes the active cloud session within the specified bound and blocks reconnect.
10. Stopping the agent removes the session and leaves local printer operation unaffected.

## Evidence

Record the source SHA, compiled artifact check, unit state, loopback health/readiness, real
mTLS/v1 handshake, command/result correlation and graceful shutdown. Redact tokens, certificate
material, command payloads and file content. If the physical printer or dev-host access is
missing, record that external blocker; local tests are necessary but do not replace live proof.
