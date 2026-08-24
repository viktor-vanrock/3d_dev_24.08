# `@portal/relay` — NestJS device data-plane

`apps/relay` is an independent compiled NestJS process. It owns long-lived raw WebSocket
gateway sessions and calls the Portal API only through the generated, authenticated
`/internal/relay/v1/*` client. It does not import a database or object-store credential.

The machine-readable protocol authority lives in
`packages/contracts/device-protocol/v1`; the internal HTTP authority and generated client
live in `packages/contracts/http/relay-internal.v1.openapi.json` and
`packages/contracts/http/generated/`.

## Local development and compiled artifact

Run commands from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm run dev:relay
pnpm --filter @portal/relay run typecheck
pnpm --filter @portal/relay run lint
pnpm --filter @portal/relay run test
pnpm run build:relay
pnpm run check:relay-deploy
pnpm run start:relay
```

The deployable entrypoint is `apps/relay/dist/main.js`. Root `pnpm build` also includes
`@portal/relay` through the workspace/Turbo graph. No compatibility runtime or unversioned
relay route participates in build, service or deployment paths.

## Required configuration

Use `.env.example` as the field inventory and keep real values in a mode-0600 environment
file or secret manager. Required identity/boundary values are:

- `RELAY_PROTOCOL_VERSION=v1`
- `RELAY_INSTANCE_ID`
- `RELAY_API_BASE_URL`
- `RELAY_SERVICE_TOKEN` (relay-specific, 32..512 characters)
- `RELAY_TLS_CERT_FILE`, `RELAY_TLS_KEY_FILE`, `RELAY_TLS_CA_FILE`

`RELAY_SERVICE_TOKEN` is not an agent JWT or gateway credential. Deprecated
`RELAY_INTERNAL_TOKEN`, `RELAY_API_TOKEN` and `API_INTERNAL_URL` fail configuration and must
not be restored.

## Listener boundaries

- `RELAY_GATEWAY_HOST` / `RELAY_GATEWAY_PORT`: raw WSS listener. Relay terminates mTLS and
  validates the individual gateway certificate before protocol hello/session mutation.
- `RELAY_OBSERVABILITY_HOST` / `RELAY_OBSERVABILITY_PORT`: plain HTTP loopback listener with
  `GET /health`, `GET /ready` and `GET /metrics`.

The listeners must not share the same address. The public relay frontend is an L4 TLS
passthrough to the gateway listener; health/readiness/metrics are never exposed on that
gateway boundary. See `deploy/nginx.relay.3mf.tech.conf`.

## Service and development deployment

Repository templates:

- `apps/relay/deploy/portal.relay.service` — production-shaped compiled service template;
- `apps/relay/deploy/portal.relay-dev.service` — dev checkout and listener ports;
- `apps/relay/deploy/relay-alerts.yml` and `relay-dashboard.json` — current Nest metric names;
- `deploy/portal.deploy-dev.sh` — builds `@portal/relay...`, restarts the dev unit and gates
  completion on loopback `/ready`.

Installing units, reloading nginx, restarting a service or moving production traffic is an
Ops action and is not performed by the repository switch.

## Safe smoke sequence

After an operator starts the compiled unit, verify locally on the host:

```bash
curl --fail --silent --show-error http://127.0.0.1:3012/health
curl --fail --silent --show-error http://127.0.0.1:3012/ready
curl --fail --silent --show-error http://127.0.0.1:3012/metrics | grep '^relay_'
```

A complete release gate additionally requires a real mTLS WSS v1 handshake, command
claim/result flow, graceful SIGTERM and the OpenSpec interop/load/security suites. A public
HTTP health response is not proof that the gateway WSS boundary is valid.
