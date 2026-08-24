from __future__ import annotations

from datetime import UTC, datetime, timedelta
from threading import Event
from typing import final

import pytest

from portal_queue_lifecycle import (
    Acquisition,
    ClaimedJob,
    ClaimToken,
    MutationOutcome,
    Outcome,
    PeriodicHeartbeat,
    QueueWorkerRunner,
    RunOutcome,
    ShutdownController,
)


def _job() -> ClaimedJob[dict[str, str]]:
    return ClaimedJob(
        token=ClaimToken("job-1", "worker-1", 1),
        payload={"model_id": "model-1"},
        attempts=1,
        lease_expires_at=datetime.now(UTC) + timedelta(minutes=1),
    )


@final
class FakeWorkerLifecycle:
    def __init__(self) -> None:
        self.job: ClaimedJob[dict[str, str]] = _job()
        self.reclaim_result: Acquisition[dict[str, str]] = Acquisition(Outcome.EMPTY)
        self.claim_result: Acquisition[dict[str, str]] = Acquisition(Outcome.APPLIED, self.job)
        self.heartbeat_result: MutationOutcome = Outcome.APPLIED
        self.succeed_result: MutationOutcome = Outcome.APPLIED
        self.fail_result: MutationOutcome = Outcome.APPLIED
        self.calls: list[str] = []
        self.heartbeat_called = Event()
        self.succeeded_with: str | None = None
        self.failed_with: str | None = None

    def reclaim_expired(
        self, owner_id: str, lease_seconds: int
    ) -> Acquisition[dict[str, str]]:
        del owner_id, lease_seconds
        self.calls.append("reclaim")
        return self.reclaim_result

    def claim(self, owner_id: str, lease_seconds: int) -> Acquisition[dict[str, str]]:
        del owner_id, lease_seconds
        self.calls.append("claim")
        return self.claim_result

    def heartbeat(self, token: ClaimToken, lease_seconds: int) -> MutationOutcome:
        del token, lease_seconds
        self.calls.append("heartbeat")
        self.heartbeat_called.set()
        return self.heartbeat_result

    def succeed(self, token: ClaimToken, result: str) -> MutationOutcome:
        del token
        self.calls.append("succeed")
        self.succeeded_with = result
        return self.succeed_result

    def fail(self, token: ClaimToken, failure: str) -> MutationOutcome:
        del token
        self.calls.append("fail")
        self.failed_with = failure
        return self.fail_result


def _runner(
    lifecycle: FakeWorkerLifecycle,
    shutdown: ShutdownController | None = None,
) -> QueueWorkerRunner[dict[str, str], str, str]:
    return QueueWorkerRunner(
        lifecycle,
        owner_id="worker-1",
        lease_seconds=1,
        heartbeat_interval_seconds=0.01,
        shutdown=shutdown or ShutdownController(grace_seconds=1),
        heartbeat_stop_timeout_seconds=0.1,
    )


def _unexpected_failure(
    error: Exception, job: ClaimedJob[dict[str, str]]
) -> str:
    del error, job
    return "unexpected"


def test_run_once_after_shutdown_does_not_acquire() -> None:
    lifecycle = FakeWorkerLifecycle()
    shutdown = ShutdownController(grace_seconds=1)
    shutdown.request()

    outcome = _runner(lifecycle, shutdown).run_once(
        lambda _job: "result", _unexpected_failure
    )

    assert outcome is RunOutcome.STOPPED
    assert lifecycle.calls == []


def test_invalid_heartbeat_timing_is_rejected_before_acquisition() -> None:
    lifecycle = FakeWorkerLifecycle()

    with pytest.raises(ValueError, match="one third"):
        QueueWorkerRunner(
            lifecycle,
            owner_id="worker-1",
            lease_seconds=1,
            heartbeat_interval_seconds=1,
            shutdown=ShutdownController(grace_seconds=1),
        )

    assert lifecycle.calls == []


def test_run_once_checks_expired_work_before_waiting_work() -> None:
    lifecycle = FakeWorkerLifecycle()

    outcome = _runner(lifecycle).run_once(lambda _job: "result", _unexpected_failure)

    assert outcome is RunOutcome.SUCCEEDED
    assert lifecycle.calls[:2] == ["reclaim", "claim"]


def test_successful_handler_maps_applied_terminal_write_to_succeeded() -> None:
    lifecycle = FakeWorkerLifecycle()

    outcome = _runner(lifecycle).run_once(lambda _job: "converted", _unexpected_failure)

    assert outcome is RunOutcome.SUCCEEDED
    assert lifecycle.succeeded_with == "converted"


def test_failed_handler_maps_applied_terminal_write_to_failed() -> None:
    lifecycle = FakeWorkerLifecycle()

    def fail_handler(_job: ClaimedJob[dict[str, str]]) -> str:
        raise RuntimeError("conversion failed")

    def classify_failure(
        error: Exception, _job: ClaimedJob[dict[str, str]]
    ) -> str:
        return str(error)

    outcome = _runner(lifecycle).run_once(fail_handler, classify_failure)

    assert outcome is RunOutcome.FAILED
    assert lifecycle.failed_with == "conversion failed"


def test_heartbeat_loss_returns_stale_without_terminal_write() -> None:
    lifecycle = FakeWorkerLifecycle()
    lifecycle.heartbeat_result = Outcome.STALE

    def finish_after_heartbeat(_job: ClaimedJob[dict[str, str]]) -> str:
        assert lifecycle.heartbeat_called.wait(1)
        return "late-result"

    outcome = _runner(lifecycle).run_once(finish_after_heartbeat, _unexpected_failure)

    assert outcome is RunOutcome.STALE
    assert "succeed" not in lifecycle.calls
    assert "fail" not in lifecycle.calls


def test_drain_deadline_returns_drain_expired_with_blocked_handler() -> None:
    lifecycle = FakeWorkerLifecycle()
    shutdown = ShutdownController(grace_seconds=0)
    release_handler = Event()

    def blocked_handler(_job: ClaimedJob[dict[str, str]]) -> str:
        shutdown.request()
        assert release_handler.wait(1)
        return "late-result"

    outcome = _runner(lifecycle, shutdown).run_once(blocked_handler, _unexpected_failure)
    release_handler.set()

    assert outcome is RunOutcome.DRAIN_EXPIRED
    assert lifecycle.job.token.lease_lost is True
    assert "succeed" not in lifecycle.calls
    assert "fail" not in lifecycle.calls


def test_handler_completing_at_zero_grace_cannot_publish_terminal_result() -> None:
    lifecycle = FakeWorkerLifecycle()
    shutdown = ShutdownController(grace_seconds=0)

    def finish_at_deadline(_job: ClaimedJob[dict[str, str]]) -> str:
        shutdown.request()
        return "result-after-deadline"

    outcome = _runner(lifecycle, shutdown).run_once(
        finish_at_deadline, _unexpected_failure
    )

    assert outcome is RunOutcome.DRAIN_EXPIRED
    assert lifecycle.job.token.lease_lost is True
    assert "succeed" not in lifecycle.calls
    assert "fail" not in lifecycle.calls


def test_failure_classification_crossing_deadline_cannot_publish_failure() -> None:
    lifecycle = FakeWorkerLifecycle()
    shutdown = ShutdownController(grace_seconds=0)

    def failed_handler(_job: ClaimedJob[dict[str, str]]) -> str:
        raise RuntimeError("conversion failed")

    def classify_after_deadline(
        error: Exception, _job: ClaimedJob[dict[str, str]]
    ) -> str:
        shutdown.request()
        return str(error)

    outcome = _runner(lifecycle, shutdown).run_once(
        failed_handler, classify_after_deadline
    )

    assert outcome is RunOutcome.DRAIN_EXPIRED
    assert lifecycle.job.token.lease_lost is True
    assert "fail" not in lifecycle.calls


@final
class BlockingHeartbeatLifecycle:
    def __init__(self) -> None:
        self.called = Event()
        self.release = Event()

    def heartbeat(self, token: ClaimToken, lease_seconds: int) -> MutationOutcome:
        del token, lease_seconds
        self.called.set()
        assert self.release.wait(1)
        return Outcome.APPLIED


def test_periodic_heartbeat_stop_timeout_marks_token_lost() -> None:
    lifecycle = BlockingHeartbeatLifecycle()
    token = ClaimToken("job-1", "worker-1", 1)
    heartbeat = PeriodicHeartbeat(
        lifecycle,
        token,
        lease_seconds=1,
        interval_seconds=0.01,
        stop_timeout_seconds=0.01,
    ).start()
    assert lifecycle.called.wait(1)

    with pytest.raises(TimeoutError, match="did not stop"):
        heartbeat.stop()

    assert token.lease_lost is True
    lifecycle.release.set()
    heartbeat.stop(timeout=1)
