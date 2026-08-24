from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from portal_queue_lifecycle import (
    Acquisition,
    ClaimedJob,
    ClaimToken,
    InMemoryMetricsSink,
    Outcome,
    QueueLifecycle,
)

from .conftest import FakeQueueRepository, FakeTransaction, FakeTransactionManager


def _lifecycle(
    transactions: FakeTransactionManager,
    repository: FakeQueueRepository,
    metrics: InMemoryMetricsSink | None = None,
) -> QueueLifecycle[FakeTransaction, dict[str, str], str, str]:
    return QueueLifecycle(
        queue="mesh-conversion",
        transactions=transactions,
        repository=repository,
        metrics=metrics,
    )


def test_claim_maps_missing_job_to_empty_outcome() -> None:
    transactions = FakeTransactionManager()
    repository = FakeQueueRepository()
    repository.claim_result = None

    acquisition = _lifecycle(transactions, repository).claim("worker-1", 90)

    assert acquisition == Acquisition(Outcome.EMPTY)


def test_claim_maps_job_to_applied_outcome() -> None:
    transactions = FakeTransactionManager()
    repository = FakeQueueRepository()

    acquisition = _lifecycle(transactions, repository).claim("worker-1", 90)

    assert acquisition == Acquisition(Outcome.APPLIED, repository.job)


def test_claim_passes_lifecycle_owned_transaction_to_repository() -> None:
    transactions = FakeTransactionManager()
    repository = FakeQueueRepository()

    _lifecycle(transactions, repository).claim("worker-1", 90)

    assert repository.calls[0][1] is transactions.transactions[0]
    assert transactions.transactions[0].committed is True


def test_repository_error_rolls_back_lifecycle_owned_transaction() -> None:
    transactions = FakeTransactionManager()
    repository = FakeQueueRepository()
    repository.raise_on = "succeed"

    with pytest.raises(RuntimeError, match="succeed failed"):
        _lifecycle(transactions, repository).succeed(repository.token, "result")

    assert transactions.transactions[0].rolled_back is True
    assert transactions.transactions[0].committed is False


def test_each_operation_uses_a_separate_short_transaction() -> None:
    transactions = FakeTransactionManager()
    repository = FakeQueueRepository()
    lifecycle = _lifecycle(transactions, repository)

    lifecycle.heartbeat(repository.token, 90)
    lifecycle.succeed(repository.token, "result")
    lifecycle.fail(repository.token, "failure")

    assert len(transactions.transactions) == 3
    assert len({id(transaction) for transaction in transactions.transactions}) == 3


def test_heartbeat_rejects_owner_mismatch_as_stale() -> None:
    transactions = FakeTransactionManager()
    repository = FakeQueueRepository()
    stale_token = ClaimToken("job-1", "worker-2", 1)

    outcome = _lifecycle(transactions, repository).heartbeat(stale_token, 90)

    assert outcome is Outcome.STALE


def test_heartbeat_rejects_generation_mismatch_as_stale() -> None:
    transactions = FakeTransactionManager()
    repository = FakeQueueRepository()
    stale_token = ClaimToken("job-1", "worker-1", 2)

    outcome = _lifecycle(transactions, repository).heartbeat(stale_token, 90)

    assert outcome is Outcome.STALE


def test_heartbeat_maps_expired_lease_to_stale() -> None:
    transactions = FakeTransactionManager()
    repository = FakeQueueRepository()
    repository.heartbeat_result = Outcome.STALE

    outcome = _lifecycle(transactions, repository).heartbeat(repository.token, 90)

    assert outcome is Outcome.STALE


def test_stale_heartbeat_marks_claim_token_lease_lost() -> None:
    transactions = FakeTransactionManager()
    repository = FakeQueueRepository()
    repository.heartbeat_result = Outcome.STALE

    _ = _lifecycle(transactions, repository).heartbeat(repository.token, 90)

    assert repository.token.lease_lost is True


def test_heartbeat_error_marks_claim_token_lease_lost() -> None:
    transactions = FakeTransactionManager()
    repository = FakeQueueRepository()
    repository.raise_on = "heartbeat"

    with pytest.raises(RuntimeError, match="heartbeat failed"):
        _ = _lifecycle(transactions, repository).heartbeat(repository.token, 90)

    assert repository.token.lease_lost is True


def test_reclaim_preserves_incremented_attempt_count() -> None:
    transactions = FakeTransactionManager()
    repository = FakeQueueRepository()
    reclaimed = ClaimedJob(
        token=ClaimToken("job-1", "worker-2", 2),
        payload={"model_id": "model-1"},
        attempts=2,
        lease_expires_at=datetime.now(UTC) + timedelta(minutes=1),
    )
    repository.reclaim_result = Acquisition(Outcome.APPLIED, reclaimed)

    acquisition = _lifecycle(transactions, repository).reclaim_expired("worker-2", 90)

    assert acquisition.job is not None
    assert acquisition.job.attempts == 2


def test_reclaim_maps_attempt_exhaustion_without_a_job() -> None:
    transactions = FakeTransactionManager()
    repository = FakeQueueRepository()
    repository.reclaim_result = Acquisition(Outcome.EXHAUSTED)

    acquisition = _lifecycle(transactions, repository).reclaim_expired("worker-2", 90)

    assert acquisition == Acquisition(Outcome.EXHAUSTED)


@pytest.mark.parametrize("operation", ["succeed", "fail"])
def test_terminal_operation_preserves_stale_outcome(operation: str) -> None:
    transactions = FakeTransactionManager()
    repository = FakeQueueRepository()
    setattr(repository, f"{operation}_result", Outcome.STALE)
    lifecycle = _lifecycle(transactions, repository)

    outcome = getattr(lifecycle, operation)(repository.token, "value")

    assert outcome is Outcome.STALE


def test_succeed_rejects_lease_lost_token_without_opening_transaction() -> None:
    transactions = FakeTransactionManager()
    repository = FakeQueueRepository()
    repository.token.mark_lease_lost()

    outcome = _lifecycle(transactions, repository).succeed(repository.token, "result")

    assert outcome is Outcome.STALE
    assert transactions.transactions == []
    assert repository.calls == []


def test_fail_rejects_lease_lost_token_without_opening_transaction() -> None:
    transactions = FakeTransactionManager()
    repository = FakeQueueRepository()
    repository.token.mark_lease_lost()

    outcome = _lifecycle(transactions, repository).fail(repository.token, "failure")

    assert outcome is Outcome.STALE
    assert transactions.transactions == []
    assert repository.calls == []


@pytest.mark.parametrize(
    ("owner_id", "lease_seconds", "message"),
    [("", 90, "owner_id"), ("worker-1", 0, "lease_seconds")],
)
def test_claim_rejects_invalid_acquisition_parameters(
    owner_id: str, lease_seconds: int, message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        _lifecycle(FakeTransactionManager(), FakeQueueRepository()).claim(
            owner_id, lease_seconds
        )


def test_operation_error_is_recorded_without_high_cardinality_labels() -> None:
    transactions = FakeTransactionManager()
    repository = FakeQueueRepository()
    repository.raise_on = "heartbeat"
    metrics = InMemoryMetricsSink()

    with pytest.raises(RuntimeError):
        _lifecycle(transactions, repository, metrics).heartbeat(repository.token, 90)

    sample = metrics.counters()[0]
    assert dict(sample.labels) == {
        "operation": "heartbeat",
        "outcome": "error",
        "queue": "mesh-conversion",
    }
