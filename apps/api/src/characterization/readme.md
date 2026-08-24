# Characterization suite (M0 safety net — backend-nest-migration task 1.4)

This directory freezes the **observable contract of the live Fastify API** before the NestJS rewrite.
It is the safety net that proves the migration is behavior-identical (spec `api-runtime` →
«Идентичность поведения при переносе транспорта»).

## Files

- `routes.manifest.json` — machine-readable inventory of all **308** routes: `method`, `path`
  (Fastify template with `:params`), `domain`, `authMode`, `closedDevAuthed`, `ownGate`, `source`,
  `sampleParams`. Generated from `openspec/changes/backend-nest-migration/inventory/endpoint-inventory.md`
  (the authoritative human inventory). **Regenerate/patch this when routes change** — the suite's
  count guard (`expect(routes.length).toBe(308)`) fails loudly if it drifts.
- `authContract.test.ts` — manifest-driven auth-gate characterization. No DB required.

## What it asserts (DB-independent)

The global `preHandler` in `src/server.ts` decides block-vs-pass **before** any handler runs, so the
auth contract is verifiable without Postgres:

| Group | Count | Invariant |
|---|---|---|
| `authed` | 238 | unauthenticated request → `401 {error:"unauthorized"}` (exact envelope) |
| `open` + `public-GET` + `public-GET-always` | 46 | global gate does **not** block (handler reached; may 2xx/404/422/500-no-DB) |
| `open-own-gate` + `open-exact-POST` | 24 | bypass session gate but **no unauthenticated 2xx** (own credential enforced) |
| CLOSED_DEV: `closedDevAuthed` | 32 | public read surface collapses to `401 {error:"unauthorized"}` |
| CLOSED_DEV: `public-GET-always` | 4 | stay reachable (machine/discovery contours) |

This is exactly the decision matrix the NestJS `AuthGuard` (task 2.7) must reproduce 1:1. Run this
suite against the Nest target during differential regression (task 5.1) — divergence = migration bug.

Note: some own-gates legitimately reuse the `{error:"unauthorized"}` envelope, so this suite asserts
"no unauthenticated success" for them; routing-to-own-gate WITH a real credential is proven by the
dedicated tests in `server.test.ts` and each `<domain>/*.test.ts`.

## Positive-path characterization (requires DB)

Status/body/header snapshots for authenticated happy paths need a **seeded ephemeral DB**. They are
gated behind `DATABASE_URL` (`describe.skip` when absent) and authored **per domain as it migrates**
(phase 3), so the Fastify baseline and the Nest target are asserted against the same expectation set.

⚠️ NEVER point `DATABASE_URL` at the shared dev/prod DB — `src/test/dbSafetyGuard.ts` denylists
`portal`/`portal_dev`. Use an ephemeral DB (CI: `portal_test`; local: `sandbox-db create sbx_<name>
--from portal_dev`, see `docs/process/testing.md`).

## Run

```bash
# no DB needed — the auth-contract baseline (345 assertions):
pnpm --filter @portal/api exec vitest run src/characterization/authContract.test.ts

# full matrix incl. positive paths (CI / ephemeral DB):
DATABASE_URL=postgres://…/portal_test pnpm --filter @portal/api exec vitest run src/characterization
```

## Findings surfaced while building the baseline

- `GET /avatars/:userId/snapshots/:side` and `.../:revision/:side/:sha256.png` are **public-GET**
  (matched by the `/avatars/.../snapshots/...` regexes in `server.ts` for UUID userId + left|right|front),
  not `authed` as first inventoried — corrected in the manifest. The inventory `## Notes` had already
  flagged the `/avatars/*` family as ambiguous; the suite confirmed the real gate behavior.
