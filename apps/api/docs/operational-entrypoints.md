# API operational entrypoints

The checked source of truth is [`scripts/operational-entrypoints.inventory.json`](../scripts/operational-entrypoints.inventory.json). It inventories every file in `apps/api/scripts`, including command entrypoints, helper modules, tests, database guards, configuration, and generated fixtures. The consistency gate rejects an unlisted file, a missing package entrypoint, a deployment service whose package command is absent, or drift in the root/API validation path.

## Lifecycle summary

- Active recurring work: catalog ingest and resolution, import processing, and feed score recomputation. Only catalog ingest/resolve have repository-owned systemd templates; live installed-unit state is unknown.
- Active one-shot maintenance: catalog bootstrap imports, guarded legacy project import, researcher provisioning, and repository backfill/verification/reconciliation.
- CI guards: OpenAPI drift, migration checks, operational inventory/reference consistency, and script/application validation.
- Dev-only tooling: guarded seed/touch commands and deterministic fixture generation.
- Repository-retired entrypoints: `rehearse-split.sh`. Its standalone split migration was squashed into the current baseline, and it had no package, CI, deployment, documentation, or installed-unit surface. The checked inventory records the replacement and cleanup rationale.

Current environment state: **live-unverified: no deployed environment**. Repository checks and isolated test evidence do not prove installed service/timer state or production data completion. Until an environment exists and is inventoried, catalog/feed units and the repository backfill remain supported.

## Supported command syntax

Run package commands from `apps/api`, or from the repository root with `pnpm --filter @portal/api run <command>`.

- `ingest:run -- [--adapter cura-definitions|sovol3d-store] [--limit N]`
- `resolve:run -- [--limit N]`
- `import:run`
- `feed:score-worker`
- `sanctions:relay-outbox`
- `backfill:repos -- --completion-check`, or `--migrate`, `--verify-only`, or `--reconcile-descriptions` with optional `--limit N`
- `provision:researcher`
- `import:machines-bootstrap -- [--source-dir PATH] [--dry-run] [--limit N]`
- `import:materials-bootstrap -- [--source-url URL_OR_PATH] [--dry-run] [--limit N]`
- `import:ru-vendors-bootstrap -- [--dry-run]`
- `pnpm exec tsx scripts/import-global-printer-vendors-bootstrap.ts [--dry-run]`
- `import:legacy-project-data -- --source-url URL --target-url URL --dump FILE --object-source none|fs:DIR --object-target none|fs:DIR --owner-map FILE --report FILE [--apply]`
- `seed:dev [--no-migrate] [--skip-assets]`
- `seed:dev:live-printers`
- `fixtures:gen`
- `openapi:check` or `openapi:generate`
- `db:check-migrations-dup`, `db:check-schema-sync`, and `db:check-migrate-replay-gate`

## Target safety and validation

- Dev seed/touch commands reject `NODE_ENV=production` and require the connected database to equal `SEED_DB_NAME` (default `portal_dev`); the database named `portal` is always rejected.
- Catalog bootstrap writes reject production/protected databases and require the connected database to equal `BOOTSTRAP_DB_NAME` (default `portal_dev`). `--dry-run` does not connect for mutation.
- Researcher provisioning requires `PROVISION_RESEARCHER_DB_NAME` to exactly name the connected database. Repository backfill mutating modes require the same exact match through `BACKFILL_REPOS_DB_NAME`; verification/completion modes remain read-only.
- Legacy import defaults to dry-run, accepts only checked source schema fingerprints, requires a distinct empty Project API v1 baseline target, verifies owner/file/relation accounting, and writes an `0600` reconciliation report. `--apply` is the only mutating mode.
- Recurring commands use `DATABASE_URL`; catalog adapters have bounded retry/timeout behavior, feed score work exits non-zero on its database connection failure, and all CLIs close their database pool on completion/failure.
- `sanctions:relay-outbox` runs each minute from `portal.sanctions-relay-outbox.timer`, claims only `sanction.relay_close.v1` events, batches Relay close requests in groups of 100, and retries failed deliveries with capped exponential backoff.

Run `pnpm typecheck`, `pnpm lint`, `pnpm boundaries`, `pnpm --filter @portal/api run test:operational-scripts`, and `pnpm build` before rollout. The full environment, data target, side-effect, safety, and per-entry verification contract is kept in the checked inventory.

Deployment/retirement must follow the future-environment procedure in `operational-entrypoints-handoff.md`: capture installed-unit and data evidence first, change the repository and installed runtime together, then verify process/timer/result state. Roll back by restoring the prior commit/unit definitions and re-running the smallest meaningful health/result check.
