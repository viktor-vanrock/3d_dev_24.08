from __future__ import annotations

import json
from pathlib import Path

_METRICS = {
    "portal_queue_depth",
    "portal_queue_oldest_age_seconds",
    "portal_queue_expired_leases",
    "portal_queue_reclaim_total",
    "portal_queue_operation_total",
}
_QUEUES = {
    "mesh-conversion",
    "mesh-slicing",
    "giga-generation",
    "giga-assistant",
    "search-index",
}


def _observability_root() -> Path:
    repository = Path(__file__).resolve().parents[4]
    return repository / "deploy" / "observability"


def test_dashboard_exposes_every_lifecycle_signal() -> None:
    dashboard = json.loads(
        (_observability_root() / "portal-queue-lifecycle.dashboard.json").read_text(
            encoding="utf-8"
        )
    )
    expressions = "\n".join(
        target["expr"]
        for panel in dashboard["panels"]
        for target in panel["targets"]
    )

    assert _METRICS.issubset({name for name in _METRICS if name in expressions})
    assert dashboard["templating"]["list"][0]["name"] == "queue"


def test_alerts_cover_backlog_expiry_reclaim_stale_and_errors() -> None:
    rules = (_observability_root() / "portal-queue-lifecycle.rules.yml").read_text(
        encoding="utf-8"
    )

    assert _METRICS.issubset({name for name in _METRICS if name in rules})
    assert "outcome=\"stale\"" in rules
    assert "outcome=\"error\"" in rules
    assert "outcome=\"exhausted\"" in rules


def test_runbook_names_every_queue_file_and_forbids_high_cardinality_labels() -> None:
    runbook = (_observability_root() / "portal-queue-lifecycle.md").read_text(
        encoding="utf-8"
    )

    assert all(f"`{queue}.prom`" in runbook for queue in _QUEUES)
    metrics_source = (
        Path(__file__).resolve().parents[1]
        / "src"
        / "portal_queue_lifecycle"
        / "metrics.py"
    ).read_text(encoding="utf-8")
    assert '_ALLOWED_LABELS = frozenset({"queue", "operation", "outcome"})' in metrics_source
