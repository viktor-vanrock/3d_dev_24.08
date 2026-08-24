from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from threading import Event
from typing import Literal


class Outcome(StrEnum):
    """Closed set of externally observable lifecycle outcomes."""

    APPLIED = "applied"
    EMPTY = "empty"
    STALE = "stale"
    EXHAUSTED = "exhausted"


class FailureDisposition(StrEnum):
    """Mechanical disposition selected by the domain adapter/policy."""

    RETRY = "retry"
    TERMINAL = "terminal"


type AcquisitionOutcome = Literal[Outcome.APPLIED, Outcome.EMPTY, Outcome.EXHAUSTED]
type MutationOutcome = Literal[Outcome.APPLIED, Outcome.STALE]


@dataclass(frozen=True, slots=True)
class ClaimToken:
    """Fence for exactly one acquisition of a queue row."""

    job_id: str
    owner_id: str
    lease_generation: int
    _lease_lost: Event = field(default_factory=Event, init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        if not self.job_id:
            raise ValueError("job_id must not be empty")
        if not self.owner_id:
            raise ValueError("owner_id must not be empty")
        if self.lease_generation < 1:
            raise ValueError("lease_generation must be positive")

    @property
    def lease_lost(self) -> bool:
        return self._lease_lost.is_set()

    def mark_lease_lost(self) -> None:
        """Permanently prevents terminal writes from this local execution context."""

        self._lease_lost.set()


@dataclass(frozen=True, slots=True)
class ClaimedJob[PayloadT]:
    token: ClaimToken
    payload: PayloadT
    attempts: int
    lease_expires_at: datetime

    def __post_init__(self) -> None:
        if self.attempts < 1:
            raise ValueError("attempts must be positive for a claimed job")
        if self.lease_expires_at.tzinfo is None:
            raise ValueError("lease_expires_at must be timezone-aware")


@dataclass(frozen=True, slots=True)
class Acquisition[PayloadT]:
    outcome: AcquisitionOutcome
    job: ClaimedJob[PayloadT] | None = None

    def __post_init__(self) -> None:
        if self.outcome not in (Outcome.APPLIED, Outcome.EMPTY, Outcome.EXHAUSTED):
            raise ValueError("invalid acquisition outcome")
        has_job = self.job is not None
        if has_job != (self.outcome is Outcome.APPLIED):
            raise ValueError("only an applied acquisition can contain a job")


@dataclass(frozen=True, slots=True)
class QueueSnapshot:
    waiting_depth: int
    oldest_waiting_age_seconds: float
    expired_leases: int

    def __post_init__(self) -> None:
        if self.waiting_depth < 0 or self.expired_leases < 0:
            raise ValueError("queue counts must not be negative")
        if self.oldest_waiting_age_seconds < 0:
            raise ValueError("oldest waiting age must not be negative")
