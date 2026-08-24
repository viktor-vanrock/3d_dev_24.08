# `src/modules/` — migrated-domain zone (NestJS, boundary-enforced)

This is the **strict zone** for the Fastify→NestJS migration (design.md §7, spec `domain-boundaries`).
A domain lives under `src/<domain>/` (legacy Fastify) until it is migrated, at which point its code
moves to `src/modules/<domain>/` and immediately falls under the 5 boundary layers at **error** level.

Legacy `src/<domain>/**` outside this zone is not held to these rules yet (ESLint `overrides` keep the
two zones apart — 2b.2). Moving a domain into `modules/` is what turns the invariants on for it.

## Layout of a migrated domain

```
src/modules/<domain>/
  api/              # thin controllers (HTTP mapping only) + DTOs + <domain>/openapi.ts
  application/      # use-cases / application services: orchestration + transaction boundaries
  domain/           # entities, value objects, domain types, invariants (no framework, no SQL)
  infrastructure/   # repositories = the ONLY writer of this domain's tables (private providers)
  public/           # the domain's ONLY outward barrel: public ports + read-view contracts + branded ids re-exports
  <domain>.module.ts  # Nest module: repository is a PRIVATE provider; exports ONLY the public port(s)
```

## The one rule that generates all five layers

> **A domain may import another domain only from `<other>/public`. It may write only its own tables.
> Everything else (repositories, application services, domain internals) is private.**

Concretely:
- **Cross-domain import** → only `src/modules/<other>/public` (barrel). Never `.../infrastructure`,
  `.../application`, `.../domain`. (Enforced: layer 1 ESLint, layer 5 dependency-cruiser.)
- **Cross-domain write** → call the owner's public use-case; never `INSERT/UPDATE/DELETE` a table you
  don't own. Ownership is fixed in `table-ownership` (see infrastructure/`<domain>.tables.ts`).
  (Enforced: layer 2 SQL manifest test.)
- **Cross-domain read of a god-table** (`models` R:13, `users` R:16) → only via the owner's published
  versioned read-view (`project_read_v1` / `identity_read_v1`), never the physical table.
  (Enforced: layer 2 SQL manifest test — read-views are the allowlist.)
- **Domain ids** are branded (`ProjectId`/`UserId`/`ModelId`) so one id can't be passed where another
  is expected. (Enforced: layer 3 branded types + strict tsc.)
- **DI encapsulation**: the Nest module exports only the public port; the repository is unreachable by
  other modules through injection. (Enforced: layer 4 arch-test.)

## The five layers (each catches what the previous can miss)

| Layer | Mechanism | Catches | Where |
|---|---|---|---|
| 1 Structure | ESLint `boundaries` / `no-restricted-imports` (error in `modules/**`) | direct import of another domain's repo/service | `apps/api/eslint.config.mjs` (2b.2) |
| 2 SQL tables | custom CI test scanning each domain's SQL | `JOIN`/write of a foreign physical table outside the manifest & allowed read-views | `src/modules/_boundaries/sqlOwnership.test.ts` (2b.4) |
| 3 Types | branded ids, repositories return domain types | semantic mix-ups invisible to imports (userId where projectId expected) | `src/modules/_kernel/brandedIds.ts` (2b.3) |
| 4 DI | Nest module exports only the public port | injecting another domain's repository | `src/modules/_boundaries/moduleEncapsulation.test.ts` (2b.5) |
| 5 Graph | dependency-cruiser rules (no cycles, domain→domain only via public) | slow erosion; the rule guards itself in CI | `.dependency-cruiser.cjs` (2b.6) |

### Strict type-aware lint zone (based on review-engine)

The migrated zone (`src/modules/**` + `src/nest/**`) additionally runs **maximum-strict type-aware
ESLint** (basis: the sibling NestJS project `device-review/review-engine`). Legacy `src/**` is exempt —
turning these on globally would redden CI on 3432 inline SQL / 175 Fastify files written without them.

Zone rules (all `error`): `recommendedTypeChecked` + `no-floating-promises`, `no-misused-promises`,
`no-explicit-any`, `ban-ts-comment`, `no-unused-vars`, `consistent-type-imports`,
`no-unnecessary-type-assertion`, `only-throw-error`. Test files relax `no-explicit-any`/`only-throw-error`/
`unbound-method`/`no-unsafe-argument` for spies/fakes. tsconfig adds `noFallthroughCasesInSwitch`
(we keep our own `noUncheckedIndexedAccess`, which is stricter than review-engine).

**⚠️ At cutover (task 7.6):** after legacy Fastify is deleted, drop the `files: STRICT_ZONE` narrowing
in `eslint.config.mjs` and apply these rules to the WHOLE `apps/api`.

### No-Fastify-residue gate (cleanup guarantee, operator req 2026-08-05)

A separate mechanical guard ensures **no leftover Fastify junk survives the migration** (spec
`api-runtime` «после cutover Fastify отсутствует», exit-gate 8.5). Two modes in
`src/modules/_boundaries/noFastifyResidue.test.ts`:

- **ARMED** (default, runs in the `boundaries` CI gate): the migrated zone `src/modules/**` and the
  Nest layer `src/nest/**` MUST contain zero Fastify imports/types. A domain that moves into `modules/`
  but drags a Fastify tail (`import ... "fastify"`, `FastifyInstance/Request/Reply/...`) fails
  immediately — junk can't accumulate.
- **STRICT** (`NO_FASTIFY_STRICT=1`, at cutover — task 7.4): the WHOLE package must be Fastify-free —
  0 Fastify imports/types anywhere in `src/**`, 0 Fastify packages in `package.json`, legacy
  entrypoints (`main.ts`/`server.ts`/`routeLoader.ts`/`cors.ts`) deleted, no legacy domain `routes.ts`
  outside `modules/`. Red gate blocks cutover. Run: `pnpm --filter @portal/api run no-fastify-residue:strict`.

When migrating a domain: its old Fastify unit tests (`src/<domain>/*.test.ts`) are **ported to Nest**
(or dropped if characterization already covers them) — no tests exercising dead Fastify code remain.

## Migrating a domain (the mechanical pattern, design.md §2)

1. characterization green on the live Fastify domain (M0 baseline — already frozen);
2. Nest controller + DTO, behavior 1:1;
3. move SQL into `infrastructure/<domain>.repository.ts` (private provider);
4. declare owned tables in `infrastructure/<domain>.tables.ts` (seed from `table-ownership.json`);
5. the domain now sits in `modules/` → error-level boundary zone turns on automatically
   (incl. no-fastify-residue ARMED: the migrated code must carry zero Fastify import/type);
6. add equivalent positive/negative Nest tests while keeping the frozen Fastify suite for differential
   regression; legacy code is removed only after traffic cutover (7.4), not during dual-runtime work;
7. characterization + strict boundary gates green again → domain implementation is migration-ready.

See `push/` for the verified reference implementation, `_template/` for the empty shape, and `_kernel`
/ `_boundaries` for the shared machinery.
