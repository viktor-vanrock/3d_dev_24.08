# Nest relay local cutover handoff

## Scope completed locally

The repository runtime has been switched from the former Go relay to the standalone
compiled `@portal/relay` NestJS process. The active implementation now uses:

- exact `device-protocol/v1` schemas and generated runtime validators;
- direct TLS 1.3 WSS with per-gateway mTLS identity binding;
- generated authenticated `/internal/relay/v1/*` API calls;
- PostgreSQL-owned fenced command and transfer lifecycle state;
- resumable bounded file ranges instead of whole-file base64 ingress;
- separate loopback health, readiness and metrics;
- bounded drain and clean SIGTERM shutdown.

The former Go sources, module metadata, disk command queue, Go-only tests/tools/spikes and
obsolete reverse-proxy route are deleted. Active source, build, deploy and documentation
paths are protected by `pnpm check:no-go-relay-residue`.

## Verification evidence

The final local gate is reproducible from the repository root:

```bash
pnpm install --frozen-lockfile --offline
pnpm check:no-go-relay-residue
pnpm check:relay-deploy
pnpm --filter @portal/contracts test
pnpm --filter @portal/contracts device-protocol:check
pnpm --filter @portal/contracts relay-internal:check
pnpm --filter @portal/device-agent test
pnpm --filter @portal/device-agent typecheck
pnpm --filter @portal/device-agent lint
pnpm --filter @portal/device-agent build
pnpm --filter @portal/relay test
pnpm --filter @portal/relay typecheck
pnpm --filter @portal/relay lint
pnpm --filter @portal/relay build
pnpm --filter @portal/relay smoke:compiled
```

`smoke:compiled` starts the built Nest artifact and built device-agent client against a
test CA. It must prove ready health, a real mTLS v1 handshake and heartbeat, synchronous
reauthorization after reconnect, unsupported-version rejection, command execution,
range-streamed transfer completion and exit code zero after SIGTERM.

Database migrations and fencing behavior were also exercised against a disposable
PostgreSQL database, including concurrent claims, expired reclaim, stale heartbeat/result
rejection and a real SIGKILL/restart claimant scenario. The disposable database was
removed after the gate.

## Explicit stop boundary

This handoff is repository-local only. It does **not** install systemd units, reload nginx,
restart a service, change secrets, deploy an artifact or move development/production
traffic. Those are separate operator-controlled actions. No production or live relay was
contacted during this cutover work.

No commit is created by this handoff. Unrelated pre-existing worktree changes remain
untouched and must not be included accidentally in a future relay commit.
