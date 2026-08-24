# `_template/` — copy this shape when migrating a domain

Empty, type-checking reference for a migrated domain (2b.1). Copy to `src/modules/<domain>/`, rename
`Example`/`example` to the real aggregate, and fill each layer. Nest-specific wiring (`@Injectable`,
`@Controller`, `<domain>.module.ts`, class-validator/swagger decorators) is added in **phase 2** once
`@nestjs/*` is installed — the current files are framework-agnostic so they compile today.

## Files by layer

| Layer | File | Role |
|---|---|---|
| domain | `domain/types.ts` | entities/value-objects/branded ids; no framework, no SQL |
| infrastructure | `infrastructure/example.repository.ts` | **sole writer** of owned tables; returns domain types; private provider |
| infrastructure | `infrastructure/example.tables.ts` | ownership manifest (`owns` + `readsForeignViews`) — seed from `table-ownership.json` |
| application | `application/getExampleName.usecase.ts` | orchestration + tx boundaries; implements the public port |
| public | `public/index.ts` | the ONLY outward barrel: ports, read-view contracts, branded ids. Never the repo. |
| api | `api/example.dto.ts` | strict typed request/response DTOs |
| api | `api/openapi.ts` (phase 2) | long swagger descriptions/examples, referenced by decorators |
| module | `<domain>.module.ts` (phase 2) | Nest module: repo = private provider; `exports` only the public port |

## Import rules (what makes this a boundary, not just folders)

- `domain/` imports only `_kernel`. Never infrastructure/application/api or other modules.
- `application/` imports its own `domain` + `infrastructure` + own `public`. Foreign domains only via `<other>/public`.
- `infrastructure/` imports its own `domain` + `_kernel` + `pg`. Never another module's internals.
- `api/` imports its own `application`/`domain`/`public`. Never another module's internals.
- Any file may import another domain ONLY from `src/modules/<other>/public`.

These are enforced at error level by layers 1 (ESLint), 4 (DI arch-test), 5 (dependency-cruiser) once
the domain sits in `modules/`. Layer 2 (SQL manifest) enforces `example.tables.ts`. Layer 3 (branded
ids) is enforced by strict tsc everywhere.
