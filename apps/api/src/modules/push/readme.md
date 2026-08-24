# Push — reference migrated domain

This domain is the task 3.1 reference for the mechanical Fastify-to-Nest migration pattern.

- Frozen baseline: 5 authenticated routes in `routes.manifest.json`; the existing Fastify tests remain
  the differential source until cutover.
- API: a thin Nest controller, class-validator DTOs and descriptions in `api/openapi.ts`.
- Application: `PushService` owns orchestration and implements the exported `PUSH_PORT`.
- Domain: versioned push preference types with no framework or SQL dependency.
- Infrastructure: private `PushRepository`; its table manifest owns only `push_subscriptions` and
  `push_preferences`.
- Verification: the legacy 6-test suite and Nest 4-test positive/negative suite run against
  `portal_test`; strict tsc/lint, SQL ownership, module encapsulation, dependency graph and
  no-Fastify-residue gates are green. A compiled-runtime smoke verifies malformed input returns the
  versioned 422 envelope.

The legacy `src/push/` implementation is intentionally retained while both runtimes are needed for
differential regression (task 5.1). It becomes removable only after the route is marked migrated and
Fastify traffic is cut over; final mechanical removal is enforced by tasks 7.4/8.5.
