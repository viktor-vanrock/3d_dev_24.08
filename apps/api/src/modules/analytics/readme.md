# Analytics module

Nest migration of `POST /consent` and `GET /analytics/health`. The module owns all writes to
`consent_records` and `events`; other domains emit events through `ANALYTICS_PORT`. Analytics failures remain
non-blocking for product operations, while consent checks remain fail-closed.
