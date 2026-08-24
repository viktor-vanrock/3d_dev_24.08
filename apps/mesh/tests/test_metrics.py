from mesh import metrics
from mesh.errors import RejectCode


def setup_function() -> None:
    metrics.reset()


def test_snapshot_empty() -> None:
    snapshot = metrics.snapshot()
    assert snapshot["processed"] == 0
    assert snapshot["repair_rate"] == 0.0
    assert snapshot["reject_rate"] == 0.0
    assert snapshot["duration_ms"]["avg"] == 0.0


def test_record_success_repaired_and_clean() -> None:
    metrics.record_success(duration_ms=10.0, repaired=True)
    metrics.record_success(duration_ms=30.0, repaired=False)

    snapshot = metrics.snapshot()
    assert snapshot["processed"] == 2
    assert snapshot["succeeded"] == 2
    assert snapshot["repaired"] == 1
    assert snapshot["rejected"] == 0
    assert snapshot["repair_rate"] == 0.5
    assert snapshot["reject_rate"] == 0.0
    assert snapshot["duration_ms"]["avg"] == 20.0


def test_record_rejection_counts_by_code() -> None:
    metrics.record_success(duration_ms=5.0, repaired=False)
    metrics.record_rejection(RejectCode.TOO_LARGE)
    metrics.record_rejection(RejectCode.TOO_LARGE)
    metrics.record_rejection(RejectCode.NOT_MESH)

    snapshot = metrics.snapshot()
    assert snapshot["processed"] == 4
    assert snapshot["succeeded"] == 1
    assert snapshot["rejected"] == 3
    assert snapshot["reject_rate"] == 0.75
    assert snapshot["reject_counts"] == {"too_large": 2, "not_mesh": 1}


def test_percentiles_reflect_all_samples() -> None:
    for value in range(1, 101):
        metrics.record_success(duration_ms=float(value), repaired=False)

    snapshot = metrics.snapshot()
    duration = snapshot["duration_ms"]
    assert duration["p50"] == 51.0
    assert duration["p95"] == 96.0
    assert duration["p99"] == 100.0
