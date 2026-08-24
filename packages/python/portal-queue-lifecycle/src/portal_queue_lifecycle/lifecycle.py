import logging
from collections.abc import Callable
from typing import final

from .metrics import NoopMetricsSink
from .models import Acquisition, ClaimToken, MutationOutcome, Outcome, QueueSnapshot
from .protocols import (
    MetricsSink,
    QueueRepository,
    TransactionManager,
)

logger = logging.getLogger(__name__)


@final
class QueueLifecycle[TransactionT, PayloadT, ResultT, FailureT]:
    """Transaction-owning orchestration around a domain queue adapter."""

    def __init__(
        self,
        *,
        queue: str,
        transactions: TransactionManager[TransactionT],
        repository: QueueRepository[TransactionT, PayloadT, ResultT, FailureT],
        metrics: MetricsSink | None = None,
    ) -> None:
        if not queue:
            raise ValueError("queue must not be empty")
        self.queue = queue
        self._transactions = transactions
        self._repository = repository
        self._metrics = metrics or NoopMetricsSink()

    def claim(self, owner_id: str, lease_seconds: int) -> Acquisition[PayloadT]:
        self._validate_acquisition(owner_id, lease_seconds)

        def operation(transaction: TransactionT) -> Acquisition[PayloadT]:
            job = self._repository.claim(transaction, owner_id, lease_seconds)
            return (
                Acquisition(Outcome.APPLIED, job)
                if job is not None
                else Acquisition(Outcome.EMPTY)
            )

        return self._run_acquisition("claim", operation)

    def reclaim_expired(self, owner_id: str, lease_seconds: int) -> Acquisition[PayloadT]:
        self._validate_acquisition(owner_id, lease_seconds)
        acquisition = self._run_acquisition(
            "reclaim", lambda transaction: self._repository.reclaim_expired(
                transaction, owner_id, lease_seconds
            )
        )
        if acquisition.outcome in (Outcome.APPLIED, Outcome.EXHAUSTED):
            self._increment(
                "portal_queue_reclaim_total",
                labels={"queue": self.queue, "outcome": acquisition.outcome.value},
            )
        return acquisition

    def heartbeat(self, token: ClaimToken, lease_seconds: int) -> MutationOutcome:
        if lease_seconds <= 0:
            raise ValueError("lease_seconds must be positive")
        try:
            outcome = self._run_outcome(
                "heartbeat",
                lambda transaction: self._repository.heartbeat(transaction, token, lease_seconds),
            )
        except Exception:
            token.mark_lease_lost()
            raise
        if outcome is not Outcome.APPLIED:
            token.mark_lease_lost()
        return outcome

    def succeed(self, token: ClaimToken, result: ResultT) -> MutationOutcome:
        if token.lease_lost:
            self._record("succeed", Outcome.STALE.value)
            return Outcome.STALE
        return self._run_outcome(
            "succeed", lambda transaction: self._repository.succeed(transaction, token, result)
        )

    def fail(self, token: ClaimToken, failure: FailureT) -> MutationOutcome:
        if token.lease_lost:
            self._record("fail", Outcome.STALE.value)
            return Outcome.STALE
        return self._run_outcome(
            "fail", lambda transaction: self._repository.fail(transaction, token, failure)
        )

    def collect_metrics(self) -> QueueSnapshot:
        try:
            with self._transactions.transaction() as transaction:
                snapshot = self._repository.snapshot(transaction)
        except Exception:
            self._record("snapshot", "error")
            raise
        self._gauge(
            "portal_queue_depth", snapshot.waiting_depth, labels={"queue": self.queue}
        )
        self._gauge(
            "portal_queue_oldest_age_seconds",
            snapshot.oldest_waiting_age_seconds,
            labels={"queue": self.queue},
        )
        self._gauge(
            "portal_queue_expired_leases", snapshot.expired_leases, labels={"queue": self.queue}
        )
        self._record("snapshot", Outcome.APPLIED.value)
        return snapshot

    def _run_acquisition(
        self,
        operation: str,
        callback: Callable[[TransactionT], Acquisition[PayloadT]],
    ) -> Acquisition[PayloadT]:
        try:
            with self._transactions.transaction() as transaction:
                acquisition = callback(transaction)
        except Exception:
            self._record(operation, "error")
            raise
        self._record(operation, acquisition.outcome.value)
        return acquisition

    def _run_outcome(
        self, operation: str, callback: Callable[[TransactionT], MutationOutcome]
    ) -> MutationOutcome:
        try:
            with self._transactions.transaction() as transaction:
                outcome = callback(transaction)
        except Exception:
            self._record(operation, "error")
            raise
        self._record(operation, outcome.value)
        return outcome

    def _record(self, operation: str, outcome: str) -> None:
        self._increment(
            "portal_queue_operation_total",
            labels={"queue": self.queue, "operation": operation, "outcome": outcome},
        )

    def _increment(self, name: str, *, labels: dict[str, str]) -> None:
        try:
            self._metrics.increment(name, labels=labels)
        except Exception:
            # Observability must never change an already committed lifecycle outcome.
            self._report_metrics_error(name)
            return

    def _gauge(self, name: str, value: float, *, labels: dict[str, str]) -> None:
        try:
            self._metrics.gauge(name, value, labels=labels)
        except Exception:
            # Snapshot collection remains usable when the metrics backend is unavailable.
            self._report_metrics_error(name)
            return

    def _report_metrics_error(self, metric_name: str) -> None:
        try:
            logger.exception(
                "queue metrics sink failed",
                extra={"queue": self.queue, "metric_name": metric_name},
            )
        except Exception:
            # Logging is an independent evidence path, but lifecycle correctness stays fail-open.
            return

    @staticmethod
    def _validate_acquisition(owner_id: str, lease_seconds: int) -> None:
        if not owner_id:
            raise ValueError("owner_id must not be empty")
        if lease_seconds <= 0:
            raise ValueError("lease_seconds must be positive")
