from __future__ import annotations

from datetime import UTC, datetime
from typing import cast

import pytest

from portal_queue_lifecycle import (
    Acquisition,
    AcquisitionOutcome,
    ClaimedJob,
    ClaimToken,
    FailureDisposition,
    Outcome,
    QueueSnapshot,
)


def test_claim_token_accepts_positive_generation() -> None:
    token = ClaimToken("job-1", "worker-1", 1)

    assert token.lease_generation == 1


def test_claim_token_marks_lease_lost_permanently() -> None:
    token = ClaimToken("job-1", "worker-1", 1)

    token.mark_lease_lost()
    token.mark_lease_lost()

    assert token.lease_lost is True


def test_failure_disposition_is_a_closed_domain_policy_result() -> None:
    assert {item.value for item in FailureDisposition} == {"retry", "terminal"}


@pytest.mark.parametrize(
    ("job_id", "owner_id", "lease_generation"),
    [("", "worker-1", 1), ("job-1", "", 1), ("job-1", "worker-1", 0)],
)
def test_claim_token_rejects_invalid_fence(
    job_id: str, owner_id: str, lease_generation: int
) -> None:
    with pytest.raises(ValueError):
        ClaimToken(job_id, owner_id, lease_generation)


def test_claimed_job_rejects_zero_attempts() -> None:
    with pytest.raises(ValueError, match="attempts must be positive"):
        ClaimedJob(
            token=ClaimToken("job-1", "worker-1", 1),
            payload=dict[str, str](),
            attempts=0,
            lease_expires_at=datetime.now(UTC),
        )


def test_claimed_job_rejects_naive_lease_deadline() -> None:
    with pytest.raises(ValueError, match="timezone-aware"):
        ClaimedJob(
            token=ClaimToken("job-1", "worker-1", 1),
            payload=dict[str, str](),
            attempts=1,
            lease_expires_at=datetime.now(),
        )


def test_applied_acquisition_requires_a_job() -> None:
    with pytest.raises(ValueError, match="only an applied acquisition"):
        Acquisition(Outcome.APPLIED)


def test_acquisition_rejects_mutation_outcome_at_runtime() -> None:
    invalid_outcome = cast(AcquisitionOutcome, Outcome.STALE)

    with pytest.raises(ValueError, match="invalid acquisition outcome"):
        Acquisition(invalid_outcome)


def test_non_applied_acquisition_rejects_a_job() -> None:
    job: ClaimedJob[dict[str, str]] = ClaimedJob(
        token=ClaimToken("job-1", "worker-1", 1),
        payload=dict[str, str](),
        attempts=1,
        lease_expires_at=datetime.now(UTC),
    )

    with pytest.raises(ValueError, match="only an applied acquisition"):
        Acquisition(Outcome.EMPTY, job)


@pytest.mark.parametrize(
    ("waiting_depth", "oldest_age", "expired_leases"),
    [(-1, 0.0, 0), (0, -0.1, 0), (0, 0.0, -1)],
)
def test_queue_snapshot_rejects_negative_measurements(
    waiting_depth: int, oldest_age: float, expired_leases: int
) -> None:
    with pytest.raises(ValueError):
        QueueSnapshot(waiting_depth, oldest_age, expired_leases)
