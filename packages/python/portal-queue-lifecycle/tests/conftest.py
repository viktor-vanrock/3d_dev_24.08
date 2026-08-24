from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import final

from portal_queue_lifecycle import (
    Acquisition,
    ClaimedJob,
    ClaimToken,
    MutationOutcome,
    Outcome,
    QueueSnapshot,
)


@dataclass
class FakeTransaction:
    committed: bool = False
    rolled_back: bool = False


@final
class FakeTransactionManager:
    def __init__(self) -> None:
        self.transactions: list[FakeTransaction] = []

    @contextmanager
    def transaction(self) -> Generator[FakeTransaction, None, None]:
        transaction = FakeTransaction()
        self.transactions.append(transaction)
        try:
            yield transaction
        except BaseException:
            transaction.rolled_back = True
            raise
        else:
            transaction.committed = True


@final
class FakeQueueRepository:
    def __init__(self) -> None:
        self.token: ClaimToken = ClaimToken("job-1", "worker-1", 1)
        self.job: ClaimedJob[dict[str, str]] = ClaimedJob(
            token=self.token,
            payload={"model_id": "model-1"},
            attempts=1,
            lease_expires_at=datetime.now(UTC) + timedelta(minutes=1),
        )
        self.claim_result: ClaimedJob[dict[str, str]] | None = self.job
        self.reclaim_result: Acquisition[dict[str, str]] = Acquisition(Outcome.EMPTY)
        self.heartbeat_result: MutationOutcome = Outcome.APPLIED
        self.succeed_result: MutationOutcome = Outcome.APPLIED
        self.fail_result: MutationOutcome = Outcome.APPLIED
        self.snapshot_result: QueueSnapshot = QueueSnapshot(3, 12.5, 1)
        self.raise_on: str | None = None
        self.calls: list[tuple[str, FakeTransaction, object]] = []

    def _record(self, operation: str, transaction: FakeTransaction, value: object) -> None:
        self.calls.append((operation, transaction, value))
        if self.raise_on == operation:
            raise RuntimeError(f"{operation} failed")

    def claim(
        self, transaction: FakeTransaction, owner_id: str, lease_seconds: int
    ) -> ClaimedJob[dict[str, str]] | None:
        self._record("claim", transaction, (owner_id, lease_seconds))
        return self.claim_result

    def reclaim_expired(
        self, transaction: FakeTransaction, owner_id: str, lease_seconds: int
    ) -> Acquisition[dict[str, str]]:
        self._record("reclaim", transaction, (owner_id, lease_seconds))
        return self.reclaim_result

    def heartbeat(
        self, transaction: FakeTransaction, token: ClaimToken, lease_seconds: int
    ) -> MutationOutcome:
        self._record("heartbeat", transaction, (token, lease_seconds))
        if token.owner_id != self.token.owner_id:
            return Outcome.STALE
        if token.lease_generation != self.token.lease_generation:
            return Outcome.STALE
        return self.heartbeat_result

    def succeed(
        self, transaction: FakeTransaction, token: ClaimToken, result: str
    ) -> MutationOutcome:
        self._record("succeed", transaction, (token, result))
        return self.succeed_result

    def fail(
        self, transaction: FakeTransaction, token: ClaimToken, failure: str
    ) -> MutationOutcome:
        self._record("fail", transaction, (token, failure))
        return self.fail_result

    def snapshot(self, transaction: FakeTransaction) -> QueueSnapshot:
        self._record("snapshot", transaction, None)
        return self.snapshot_result
