from contextlib import AbstractContextManager
from typing import Protocol

from .models import Acquisition, ClaimedJob, ClaimToken, MutationOutcome, QueueSnapshot


class TransactionManager[TransactionT](Protocol):
    """Creates one short transaction owned by the lifecycle operation."""

    def transaction(self) -> AbstractContextManager[TransactionT]: ...


class QueueRepository[TransactionT, PayloadT, ResultT, FailureT](Protocol):
    """Domain adapter. It must not open connections or commit transactions."""

    def claim(
        self, transaction: TransactionT, owner_id: str, lease_seconds: int
    ) -> ClaimedJob[PayloadT] | None: ...

    def reclaim_expired(
        self, transaction: TransactionT, owner_id: str, lease_seconds: int
    ) -> Acquisition[PayloadT]: ...

    def heartbeat(
        self, transaction: TransactionT, token: ClaimToken, lease_seconds: int
    ) -> MutationOutcome: ...

    def succeed(
        self, transaction: TransactionT, token: ClaimToken, result: ResultT
    ) -> MutationOutcome: ...

    def fail(
        self, transaction: TransactionT, token: ClaimToken, failure: FailureT
    ) -> MutationOutcome: ...

    def snapshot(self, transaction: TransactionT) -> QueueSnapshot: ...


class MetricsSink(Protocol):
    def increment(
        self, name: str, *, labels: dict[str, str], value: float = 1.0
    ) -> None: ...

    def gauge(self, name: str, value: float, *, labels: dict[str, str]) -> None: ...
