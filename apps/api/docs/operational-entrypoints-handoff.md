# API operational entrypoints handoff

## Repository outcome

The checked lifecycle inventory is `scripts/operational-entrypoints.inventory.json`; `pnpm run test:operational-entrypoints` verifies the scripts tree, package commands, deployment services, and root/API CI validation wiring. The API `typecheck` task includes the no-emit scripts project, and the unchanged `eslint .` command applies the existing type-aware rules plus a scripts-only private-module import restriction.

The scripts TypeScript project includes `**/*.ts` with no source/test exclusions. Binary GLB/WebP fixtures are inventoried generated assets, not TypeScript source, so they require no compiler exclusion.

The starting `typecheck:scripts` baseline was already zero after the earlier Nest boundary repair. Enabling the existing type-aware ESLint policy for scripts exposed 34 diagnostics: unsafe JSON parsing, promise callbacks, redundant types, and unnecessary assertions. Those diagnostics are repaired without exclusions or weaker rules.

Repository-supported lifecycle decisions:

- Catalog ingest and resolution remain active recurring jobs with repository systemd templates.
- Import processing and feed score recomputation remain active recurring jobs; their installed supervisor state is not represented in this repository.
- Repository backfill remains a supported one-shot command because environment-wide completion cannot be proven. Project-owned `repo_path`/description and current revision/blob storage are now used.
- Catalog bootstraps, researcher provisioning, legacy project import, and dev seed/touch commands remain supported one-shot/dev commands with fail-closed target handling.
- `rehearse-split.sh` is repository-retired: its standalone split migration was squashed into the current baseline, and no launch surface referenced the harness. Current migration replay and Project API reconciliation gates replace it.

Current live state: **live-unverified: no deployed environment**. Local compilation, unit/process tests, and isolated `portal_test` smoke are not evidence that a service is installed, enabled, restarted, or healthy in DEV/TEST/PROD.

## Future deployed-environment procedure

Before changing any live unit or retiring a command:

1. Record the target environment and commit SHA. Inventory installed units with `systemctl list-unit-files 'portal.*'` and `systemctl list-timers --all 'portal.*'`; inspect unit definitions with `systemctl cat`.
2. Compare `WorkingDirectory`, `EnvironmentFile`, `ExecStart`, lifecycle type, and timer schedule with `apps/api/deploy`. Do not infer installed state from repository templates.
3. Run the command's read-only/check mode where available. For repository backfill, run `pnpm run backfill:repos -- --completion-check` and retain the pending/hash/description report.
4. For a supported recurring service, install/update the unit, run `systemctl daemon-reload`, restart the service/timer, and record `systemctl status`, recent `journalctl`, timer next-run state, and the command's smallest meaningful result.
5. For retirement, first prove the replacement/completion condition in every supported environment. Then remove package/source/docs/templates together; separately disable and remove installed units with `systemctl disable --now`, delete the installed unit files, run `daemon-reload`, and verify no timer/process/reference remains.
6. Keep rollback explicit: restore the previous repository commit/unit file, reload systemd, restart the previous supported command, and confirm its health/result before declaring recovery.

Secrets and raw connection strings must stay in environment files or the secret manager and must not be copied into the handoff evidence.

## Local and isolated evidence

- Inventory/reference consistency, scripts typecheck, API lint, boundary checks, and focused operational tests are repository evidence.
- Catalog ingest was exercised against an isolated migrated `portal_test` database for idempotent candidate upsert and audit records.
- Ingest/resolve/import/feed/backfill/provisioning commands were bounded on isolated local resources. Global/RU/material/machine bootstraps were also run in their guarded mutating modes against `portal_test`; deterministic fixture regeneration produced identical hashes.
- Legacy project import completed both dry-run and `--apply` reconciliation against an empty accepted historical source schema and an isolated exact Project API v1 baseline target; all reported invariants were zero. This proves the entrypoint contract, not a real data migration.
- API typecheck, lint, format check, dependency boundaries, build, all 1,180 API tests (1,150 passed and 30 explicitly skipped), and all affected operational tests pass. The clean-database drift in current Project ownership/access contracts, bootstrap reference data, and removed model-upload compatibility storage was repaired before this handoff.
- Root `pnpm lint` intentionally excludes `@portal/web` through the Turbo package filter; Web lint remains separately runnable and is outside this repair scope.
- The repository-wide `pnpm test` reaches an unrelated Web structural limit (`home.concepts.css` is 440 lines with a 400-line gate). Web was explicitly excluded from this repair, so this handoff does not claim that the cross-workspace root test is green.
- No installed service, deployed environment, production data, or external scheduler was available. That state remains `live-unverified: no deployed environment`, not deployment proof.
