from __future__ import annotations

import signal
from threading import Event
from typing import cast, final

import pytest

from portal_queue_lifecycle import (
    ClaimToken,
    MutationOutcome,
    Outcome,
    PeriodicHeartbeat,
    ShutdownController,
)


@final
class FakeHeartbeatLifecycle:
    def __init__(self, outcomes: list[MutationOutcome | Exception]) -> None:
        self._outcomes = iter(outcomes)
        self.called = Event()
        self.calls = 0

    def heartbeat(self, token: ClaimToken, lease_seconds: int) -> MutationOutcome:
        del token, lease_seconds
        self.calls += 1
        self.called.set()
        default_outcome: MutationOutcome = Outcome.APPLIED
        outcome = next(self._outcomes, default_outcome)
        if isinstance(outcome, Exception):
            raise outcome
        return cast(MutationOutcome, outcome)


def _heartbeat(
    lifecycle: FakeHeartbeatLifecycle,
    *,
    shutdown: ShutdownController | None = None,
) -> PeriodicHeartbeat:
    return PeriodicHeartbeat(
        lifecycle,
        ClaimToken("job-1", "worker-1", 1),
        lease_seconds=1,
        interval_seconds=0.01,
        shutdown=shutdown,
    )


def test_periodic_heartbeat_marks_lease_lost_after_stale_outcome() -> None:
    lifecycle = FakeHeartbeatLifecycle([Outcome.STALE])
    heartbeat = _heartbeat(lifecycle).start()

    assert lifecycle.called.wait(1)
    heartbeat.stop(timeout=1)

    assert heartbeat.lease_lost is True


def test_periodic_heartbeat_marks_lease_lost_after_error() -> None:
    error = RuntimeError("database unavailable")
    lifecycle = FakeHeartbeatLifecycle([error])
    heartbeat = _heartbeat(lifecycle).start()

    assert lifecycle.called.wait(1)
    heartbeat.stop(timeout=1)

    assert heartbeat.lease_lost is True
    assert heartbeat.error is error


def test_periodic_heartbeat_keeps_lease_during_shutdown_drain() -> None:
    lifecycle = FakeHeartbeatLifecycle([Outcome.APPLIED])
    shutdown = ShutdownController(grace_seconds=1)
    shutdown.request()
    heartbeat = _heartbeat(lifecycle, shutdown=shutdown).start()

    assert lifecycle.called.wait(1)
    heartbeat.stop(timeout=1)

    assert lifecycle.calls >= 1
    assert heartbeat.lease_lost is False


def test_periodic_heartbeat_stops_after_shutdown_grace_expires(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = iter([10.0, 11.0])
    monkeypatch.setattr("portal_queue_lifecycle.runner.monotonic", lambda: next(now))
    shutdown = ShutdownController(grace_seconds=0.5)
    shutdown.request()
    lifecycle = FakeHeartbeatLifecycle([Outcome.APPLIED])
    heartbeat = _heartbeat(lifecycle, shutdown=shutdown).start()

    heartbeat.stop(timeout=1)

    assert lifecycle.calls == 0


def test_shutdown_request_stops_new_acquisitions() -> None:
    shutdown = ShutdownController(grace_seconds=10)

    shutdown.request()

    assert shutdown.requested is True
    assert shutdown.can_acquire is False


def test_shutdown_request_preserves_first_grace_deadline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clock = iter([10.0, 20.0, 15.0])
    monkeypatch.setattr("portal_queue_lifecycle.runner.monotonic", lambda: next(clock))
    shutdown = ShutdownController(grace_seconds=2)

    shutdown.request()
    shutdown.request()

    assert shutdown.drain_expired is True


def test_signal_handler_requests_shutdown_and_restores_previous_handler() -> None:
    shutdown = ShutdownController(grace_seconds=10)
    previous = signal.getsignal(signal.SIGTERM)

    with shutdown.install_signal_handlers():
        handler = signal.getsignal(signal.SIGTERM)
        assert callable(handler)
        handler(signal.SIGTERM, None)

    assert shutdown.requested is True
    assert signal.getsignal(signal.SIGTERM) is previous


@pytest.mark.parametrize(
    ("lease_seconds", "interval_seconds", "message"),
    [(0, 0.1, "lease_seconds"), (1, 0, "interval_seconds"), (3, 1.1, "one third")],
)
def test_periodic_heartbeat_rejects_unsafe_timing(
    lease_seconds: int, interval_seconds: float, message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        PeriodicHeartbeat(
            FakeHeartbeatLifecycle([]),
            ClaimToken("job-1", "worker-1", 1),
            lease_seconds=lease_seconds,
            interval_seconds=interval_seconds,
        )
