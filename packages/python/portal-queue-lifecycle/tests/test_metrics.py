from __future__ import annotations

from pathlib import Path
from typing import final

import pytest

from portal_queue_lifecycle import (
    Acquisition,
    InMemoryMetricsSink,
    MetricSample,
    MetricsSink,
    Outcome,
    PrometheusTextfileMetricsSink,
    QueueLifecycle,
    QueueSnapshot,
    metrics_sink_from_env,
)

from .conftest import FakeQueueRepository, FakeTransaction, FakeTransactionManager


@final
class RaisingMetricsSink:
    def increment(
        self, name: str, *, labels: dict[str, str], value: float = 1.0
    ) -> None:
        del name, labels, value
        raise RuntimeError("metrics unavailable")

    def gauge(self, name: str, value: float, *, labels: dict[str, str]) -> None:
        del name, value, labels
        raise RuntimeError("metrics unavailable")


def _lifecycle(
    transactions: FakeTransactionManager,
    repository: FakeQueueRepository,
    metrics: MetricsSink,
) -> QueueLifecycle[FakeTransaction, dict[str, str], str, str]:
    return QueueLifecycle(
        queue="mesh-conversion",
        transactions=transactions,
        repository=repository,
        metrics=metrics,
    )

def _sample_values(
    samples: tuple[MetricSample, ...],
) -> dict[tuple[str, tuple[tuple[str, str], ...]], float]:
    return {(sample.name, sample.labels): sample.value for sample in samples}


def test_in_memory_counter_accumulates_matching_label_set() -> None:
    metrics = InMemoryMetricsSink()

    metrics.increment("counter", labels={"queue": "mesh"})
    metrics.increment("counter", labels={"queue": "mesh"}, value=2)

    assert metrics.counters()[0].value == 3


def test_in_memory_gauge_replaces_previous_value() -> None:
    metrics = InMemoryMetricsSink()

    metrics.gauge("depth", 2, labels={"queue": "mesh"})
    metrics.gauge("depth", 5, labels={"queue": "mesh"})

    assert metrics.gauges()[0].value == 5


def test_metric_sink_rejects_high_cardinality_labels() -> None:
    metrics = InMemoryMetricsSink()

    with pytest.raises(ValueError, match="high-cardinality"):
        metrics.increment("counter", labels={"queue": "mesh", "job_id": "secret"})


def test_prometheus_textfile_sink_exports_counters_and_gauges_atomically(
    tmp_path: Path,
) -> None:
    path = tmp_path / "metrics" / "mesh.prom"
    metrics = PrometheusTextfileMetricsSink(path)

    metrics.increment(
        "portal_queue_operation_total",
        labels={"queue": "mesh-conversion", "operation": "claim", "outcome": "applied"},
    )
    metrics.gauge("portal_queue_depth", 7, labels={"queue": "mesh-conversion"})

    assert path.read_text(encoding="utf-8").splitlines() == [
        'portal_queue_depth{queue="mesh-conversion"} 7',
        "portal_queue_operation_total"
        '{operation="claim",outcome="applied",queue="mesh-conversion"} 1',
    ]
    assert not tuple(path.parent.glob("*.tmp"))


def test_metrics_sink_from_env_uses_one_file_per_queue(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("PORTAL_QUEUE_METRICS_DIR", str(tmp_path))

    sink = metrics_sink_from_env("giga/assistant")

    assert isinstance(sink, PrometheusTextfileMetricsSink)
    assert sink.path == tmp_path / "giga-assistant.prom"


def test_collect_metrics_emits_queue_snapshot_gauges() -> None:
    transactions = FakeTransactionManager()
    repository = FakeQueueRepository()
    repository.snapshot_result = QueueSnapshot(7, 42.5, 2)
    metrics = InMemoryMetricsSink()
    lifecycle = _lifecycle(transactions, repository, metrics)

    lifecycle.collect_metrics()

    values = _sample_values(metrics.gauges())
    queue_labels = (("queue", "mesh-conversion"),)
    assert values[("portal_queue_depth", queue_labels)] == 7
    assert values[("portal_queue_oldest_age_seconds", queue_labels)] == 42.5
    assert values[("portal_queue_expired_leases", queue_labels)] == 2


def test_reclaim_applied_emits_reclaim_counter() -> None:
    transactions = FakeTransactionManager()
    repository = FakeQueueRepository()
    repository.reclaim_result = Acquisition(Outcome.APPLIED, repository.job)
    metrics = InMemoryMetricsSink()
    lifecycle = _lifecycle(transactions, repository, metrics)

    lifecycle.reclaim_expired("worker-1", 90)

    values = _sample_values(metrics.counters())
    labels = (("outcome", "applied"), ("queue", "mesh-conversion"))
    assert values[("portal_queue_reclaim_total", labels)] == 1


def test_metric_labels_exclude_job_owner_user_and_payload() -> None:
    transactions = FakeTransactionManager()
    repository = FakeQueueRepository()
    metrics = InMemoryMetricsSink()
    lifecycle = _lifecycle(transactions, repository, metrics)

    lifecycle.claim("worker-secret", 90)
    lifecycle.collect_metrics()

    forbidden = {"job", "job_id", "owner", "owner_id", "user", "user_id", "payload"}
    all_samples = (*metrics.counters(), *metrics.gauges())
    assert all(forbidden.isdisjoint(dict(sample.labels)) for sample in all_samples)


def test_metrics_error_does_not_mask_committed_claim_result() -> None:
    transactions = FakeTransactionManager()
    repository = FakeQueueRepository()
    lifecycle = _lifecycle(transactions, repository, RaisingMetricsSink())

    acquisition = lifecycle.claim("worker-1", 90)

    assert acquisition == Acquisition(Outcome.APPLIED, repository.job)
    assert transactions.transactions[0].committed is True


def test_metrics_error_is_reported_through_independent_logger(
    caplog: pytest.LogCaptureFixture,
) -> None:
    transactions = FakeTransactionManager()
    repository = FakeQueueRepository()
    lifecycle = _lifecycle(transactions, repository, RaisingMetricsSink())

    with caplog.at_level("ERROR", logger="portal_queue_lifecycle.lifecycle"):
        acquisition = lifecycle.claim("worker-1", 90)

    assert acquisition.outcome is Outcome.APPLIED
    assert "queue metrics sink failed" in caplog.text
    assert "metrics unavailable" in caplog.text


def test_metrics_error_does_not_mask_repository_error() -> None:
    transactions = FakeTransactionManager()
    repository = FakeQueueRepository()
    repository.raise_on = "succeed"
    lifecycle = _lifecycle(transactions, repository, RaisingMetricsSink())

    with pytest.raises(RuntimeError, match="succeed failed"):
        _ = lifecycle.succeed(repository.token, "result")


def test_metrics_error_does_not_mask_collected_snapshot() -> None:
    transactions = FakeTransactionManager()
    repository = FakeQueueRepository()
    lifecycle = _lifecycle(transactions, repository, RaisingMetricsSink())

    snapshot = lifecycle.collect_metrics()

    assert snapshot == repository.snapshot_result
