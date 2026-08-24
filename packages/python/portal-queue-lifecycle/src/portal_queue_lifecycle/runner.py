import signal
from collections.abc import Callable, Generator
from contextlib import contextmanager
from enum import StrEnum
from threading import Event, Lock, Thread
from time import monotonic
from types import FrameType
from typing import Protocol, cast, final

from .models import Acquisition, ClaimedJob, ClaimToken, MutationOutcome, Outcome

SignalHandler = Callable[[int, FrameType | None], None] | int | signal.Handlers | None


class HeartbeatLifecycle(Protocol):
    def heartbeat(self, token: ClaimToken, lease_seconds: int) -> MutationOutcome: ...


class WorkerLifecycle[PayloadT, ResultT, FailureT](HeartbeatLifecycle, Protocol):
    def claim(self, owner_id: str, lease_seconds: int) -> Acquisition[PayloadT]: ...

    def reclaim_expired(self, owner_id: str, lease_seconds: int) -> Acquisition[PayloadT]: ...

    def succeed(self, token: ClaimToken, result: ResultT) -> MutationOutcome: ...

    def fail(self, token: ClaimToken, failure: FailureT) -> MutationOutcome: ...


class RunOutcome(StrEnum):
    IDLE = "idle"
    EXHAUSTED = "exhausted"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    STALE = "stale"
    STOPPED = "stopped"
    DRAIN_EXPIRED = "drain_expired"


@final
class ShutdownController:
    """Coordinates stop-claiming and a bounded drain window."""

    def __init__(self, grace_seconds: float) -> None:
        if grace_seconds < 0:
            raise ValueError("grace_seconds must not be negative")
        self.grace_seconds = grace_seconds
        self._requested = Event()
        self._lock = Lock()
        self._deadline: float | None = None

    @property
    def can_acquire(self) -> bool:
        return not self._requested.is_set()

    @property
    def requested(self) -> bool:
        return self._requested.is_set()

    @property
    def drain_expired(self) -> bool:
        deadline = self._deadline
        return deadline is not None and monotonic() >= deadline

    def request(self) -> None:
        with self._lock:
            if self._requested.is_set():
                return
            self._deadline = monotonic() + self.grace_seconds
            self._requested.set()

    def wait(self, timeout: float | None = None) -> bool:
        return self._requested.wait(timeout)

    @contextmanager
    def install_signal_handlers(self) -> Generator[None]:
        previous: dict[signal.Signals, SignalHandler] = {}

        def request_shutdown(_signum: int, _frame: FrameType | None) -> None:
            self.request()

        for signum in (signal.SIGTERM, signal.SIGINT):
            previous[signum] = cast(SignalHandler, signal.getsignal(signum))
            _ = signal.signal(signum, request_shutdown)
        try:
            yield
        finally:
            for signum, handler in previous.items():
                _ = signal.signal(signum, handler)


@final
class PeriodicHeartbeat:
    """Runs fenced heartbeat calls on a dedicated daemon thread."""

    def __init__(
        self,
        lifecycle: HeartbeatLifecycle,
        token: ClaimToken,
        *,
        lease_seconds: int,
        interval_seconds: float,
        shutdown: ShutdownController | None = None,
        stop_timeout_seconds: float = 5.0,
    ) -> None:
        if lease_seconds <= 0:
            raise ValueError("lease_seconds must be positive")
        if interval_seconds <= 0:
            raise ValueError("interval_seconds must be positive")
        if interval_seconds > lease_seconds / 3:
            raise ValueError("interval_seconds must not exceed one third of the lease")
        if stop_timeout_seconds <= 0:
            raise ValueError("stop_timeout_seconds must be positive")
        self._lifecycle = lifecycle
        self._token = token
        self._lease_seconds = lease_seconds
        self._interval_seconds = interval_seconds
        self._shutdown = shutdown
        self._stop_timeout_seconds = stop_timeout_seconds
        self._stop = Event()
        self._error: Exception | None = None
        self._thread = Thread(target=self._run, name="portal-queue-heartbeat", daemon=True)

    @property
    def lease_lost(self) -> bool:
        return self._token.lease_lost

    @property
    def error(self) -> Exception | None:
        return self._error

    def start(self) -> "PeriodicHeartbeat":
        self._thread.start()
        return self

    def stop(self, timeout: float | None = None) -> None:
        self._stop.set()
        self._thread.join(self._stop_timeout_seconds if timeout is None else timeout)
        if self._thread.is_alive():
            self._token.mark_lease_lost()
            raise TimeoutError("heartbeat thread did not stop")

    def __enter__(self) -> "PeriodicHeartbeat":
        return self.start()

    def __exit__(self, *_exc_info: object) -> None:
        self.stop()

    def _run(self) -> None:
        while not self._stop.wait(self._interval_seconds):
            if self._shutdown is not None and self._shutdown.drain_expired:
                self._token.mark_lease_lost()
                return
            try:
                outcome = self._lifecycle.heartbeat(self._token, self._lease_seconds)
            except Exception as error:
                self._error = error
                self._token.mark_lease_lost()
                return
            if outcome is not Outcome.APPLIED:
                self._token.mark_lease_lost()
                return


@final
class QueueWorkerRunner[PayloadT, ResultT, FailureT]:
    """Runs one queue job with acquisition gating, heartbeat, and bounded drain."""

    def __init__(
        self,
        lifecycle: WorkerLifecycle[PayloadT, ResultT, FailureT],
        *,
        owner_id: str,
        lease_seconds: int,
        heartbeat_interval_seconds: float,
        shutdown: ShutdownController,
        heartbeat_stop_timeout_seconds: float = 5.0,
    ) -> None:
        if not owner_id:
            raise ValueError("owner_id must not be empty")
        if lease_seconds <= 0:
            raise ValueError("lease_seconds must be positive")
        if heartbeat_interval_seconds <= 0:
            raise ValueError("heartbeat_interval_seconds must be positive")
        if heartbeat_interval_seconds > lease_seconds / 3:
            raise ValueError("heartbeat_interval_seconds must not exceed one third of the lease")
        if heartbeat_stop_timeout_seconds <= 0:
            raise ValueError("heartbeat_stop_timeout_seconds must be positive")
        self._lifecycle = lifecycle
        self._owner_id = owner_id
        self._lease_seconds = lease_seconds
        self._heartbeat_interval_seconds = heartbeat_interval_seconds
        self._shutdown = shutdown
        self._heartbeat_stop_timeout_seconds = heartbeat_stop_timeout_seconds

    def run_once(
        self,
        handler: Callable[[ClaimedJob[PayloadT]], ResultT],
        failure_from_exception: Callable[[Exception, ClaimedJob[PayloadT]], FailureT],
    ) -> RunOutcome:
        acquisition = self._acquire()
        if acquisition.outcome is Outcome.EMPTY:
            return RunOutcome.STOPPED if self._shutdown.requested else RunOutcome.IDLE
        if acquisition.outcome is Outcome.EXHAUSTED:
            return RunOutcome.EXHAUSTED
        job = acquisition.job
        if job is None:
            raise RuntimeError("applied acquisition did not contain a job")
        return self._execute(job, handler, failure_from_exception)

    def _acquire(self) -> Acquisition[PayloadT]:
        if not self._shutdown.can_acquire:
            return Acquisition(Outcome.EMPTY)
        acquisition = self._lifecycle.reclaim_expired(self._owner_id, self._lease_seconds)
        if acquisition.outcome is not Outcome.EMPTY:
            return acquisition
        if not self._shutdown.can_acquire:
            return Acquisition(Outcome.EMPTY)
        return self._lifecycle.claim(self._owner_id, self._lease_seconds)

    def _execute(
        self,
        job: ClaimedJob[PayloadT],
        handler: Callable[[ClaimedJob[PayloadT]], ResultT],
        failure_from_exception: Callable[[Exception, ClaimedJob[PayloadT]], FailureT],
    ) -> RunOutcome:
        completed = Event()
        results: list[ResultT] = []
        errors: list[Exception] = []

        def invoke_handler() -> None:
            try:
                results.append(handler(job))
            except Exception as error:
                errors.append(error)
            finally:
                completed.set()

        handler_thread = Thread(target=invoke_handler, name="portal-queue-handler", daemon=True)
        heartbeat = PeriodicHeartbeat(
            self._lifecycle,
            job.token,
            lease_seconds=self._lease_seconds,
            interval_seconds=self._heartbeat_interval_seconds,
            shutdown=self._shutdown,
            stop_timeout_seconds=self._heartbeat_stop_timeout_seconds,
        )
        handler_thread.start()
        _ = heartbeat.start()
        while not completed.wait(min(self._heartbeat_interval_seconds, 0.1)):
            if self._shutdown.drain_expired:
                job.token.mark_lease_lost()
                try:
                    heartbeat.stop()
                except TimeoutError:
                    pass
                return RunOutcome.DRAIN_EXPIRED
        try:
            heartbeat.stop()
        except TimeoutError:
            return RunOutcome.STALE
        if self._shutdown.drain_expired:
            job.token.mark_lease_lost()
            return RunOutcome.DRAIN_EXPIRED
        if job.token.lease_lost:
            return RunOutcome.STALE
        if errors:
            failure = failure_from_exception(errors[0], job)
            if self._shutdown.drain_expired:
                job.token.mark_lease_lost()
                return RunOutcome.DRAIN_EXPIRED
            outcome = self._lifecycle.fail(job.token, failure)
            return RunOutcome.FAILED if outcome is Outcome.APPLIED else RunOutcome.STALE
        if not results:
            job.token.mark_lease_lost()
            return RunOutcome.STALE
        if self._shutdown.drain_expired:
            job.token.mark_lease_lost()
            return RunOutcome.DRAIN_EXPIRED
        outcome = self._lifecycle.succeed(job.token, results[0])
        return RunOutcome.SUCCEEDED if outcome is Outcome.APPLIED else RunOutcome.STALE
