# Portal queue lifecycle observability

The five migrated workers emit the same Prometheus metric family with only
`queue`, `operation`, and `outcome` labels. Set `PORTAL_QUEUE_METRICS_DIR` to the
directory configured for the node_exporter textfile collector. Each process
atomically owns one file:

- `mesh-conversion.prom`
- `mesh-slicing.prom`
- `giga-generation.prom`
- `giga-assistant.prom`
- `search-index.prom`

Import `portal-queue-lifecycle.dashboard.json` into Grafana and load
`portal-queue-lifecycle.rules.yml` into Prometheus. The dashboard covers depth,
oldest waiting age, expired leases, reclaim outcomes, stale writes, and lifecycle
errors. The alert rules deliberately group only by the bounded queue/operation/
outcome dimensions; job, owner, user, and payload labels are rejected by the
shared sink.

Before enabling a consumer, verify its `.prom` file is fresh, node_exporter
exposes all five metric names, and the Grafana `queue` variable includes the
consumer. A missing file is fail-visible and must block that consumer's soak.
