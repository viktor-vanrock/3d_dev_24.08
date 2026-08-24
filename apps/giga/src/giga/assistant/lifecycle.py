from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import psycopg
from portal_queue_lifecycle import (
    Acquisition,
    ClaimedJob,
    ClaimToken,
    MutationOutcome,
    Outcome,
    QueueSnapshot,
)
from psycopg.types.json import Jsonb


@dataclass(frozen=True, slots=True)
class AssistantPayload:
    run_id: str
    thread_id: str
    user_id: str
    message: str


@dataclass(frozen=True, slots=True)
class AssistantSuccess:
    result: dict[str, Any]


@dataclass(frozen=True, slots=True)
class AssistantFailure:
    error: str
    retryable: bool


class PsycopgTransactionManager:
    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    @contextmanager
    def transaction(self) -> Generator[psycopg.Connection[Any]]:
        with psycopg.connect(self._database_url) as connection:
            with connection.transaction():
                yield connection


class AssistantRepository:
    def __init__(self, *, max_attempts: int) -> None:
        if max_attempts < 1:
            raise ValueError("max_attempts must be positive")
        self._max_attempts = max_attempts

    def claim(
        self,
        transaction: psycopg.Connection[Any],
        owner_id: str,
        lease_seconds: int,
    ) -> ClaimedJob[AssistantPayload] | None:
        with transaction.cursor() as cursor:
            cursor.execute(_ACQUIRE_SQL, (owner_id, lease_seconds))
            row = cursor.fetchone()
        return None if row is None else _claimed_job(row, owner_id)

    def reclaim_expired(
        self,
        transaction: psycopg.Connection[Any],
        owner_id: str,
        lease_seconds: int,
    ) -> Acquisition[AssistantPayload]:
        with transaction.cursor() as cursor:
            cursor.execute(
                """
                with candidate as (
                  select id from assistant_runs
                   where status='running' and lease_expires_at < clock_timestamp()
                   order by lease_expires_at, id
                     for update skip locked
                   limit 1
                ), updated as (
                  update assistant_runs runs
                     set status=case when attempts >= %s then 'error' else 'running' end,
                         error=case when attempts >= %s then 'assistant attempts exhausted'
                                    else error end,
                         leased_by=case when attempts >= %s then null else %s end,
                         lease_expires_at=case when attempts >= %s then null else
                           clock_timestamp()+interval '1 second'*%s end,
                         lease_generation=case when attempts >= %s then lease_generation
                                               else lease_generation+1 end,
                         attempts=case when attempts >= %s then attempts else attempts+1 end,
                         updated_at=clock_timestamp()
                    from candidate
                   where runs.id=candidate.id
                   returning runs.*
                )
                select status,id::text,thread_id::text,user_id::text,message,
                       attempts,lease_expires_at,lease_generation
                  from updated
                """,
                (
                    self._max_attempts,
                    self._max_attempts,
                    self._max_attempts,
                    owner_id,
                    self._max_attempts,
                    lease_seconds,
                    self._max_attempts,
                    self._max_attempts,
                ),
            )
            row = cursor.fetchone()
        if row is None:
            return Acquisition(Outcome.EMPTY)
        if row[0] == "error":
            return Acquisition(Outcome.EXHAUSTED)
        return Acquisition(Outcome.APPLIED, _claimed_job(row[1:], owner_id))

    def heartbeat(
        self,
        transaction: psycopg.Connection[Any],
        token: ClaimToken,
        lease_seconds: int,
    ) -> MutationOutcome:
        with transaction.cursor() as cursor:
            cursor.execute(
                """
                update assistant_runs
                   set lease_expires_at=clock_timestamp()+interval '1 second'*%s,
                       updated_at=clock_timestamp()
                 where id=%s::uuid and status='running' and leased_by=%s
                   and lease_generation=%s and lease_expires_at > clock_timestamp()
                """,
                (lease_seconds, token.job_id, token.owner_id, token.lease_generation),
            )
            return Outcome.APPLIED if cursor.rowcount == 1 else Outcome.STALE

    def succeed(
        self,
        transaction: psycopg.Connection[Any],
        token: ClaimToken,
        success: AssistantSuccess,
    ) -> MutationOutcome:
        result_type = success.result.get("kind")
        error_code = success.result.get("code") if result_type == "error" else None
        with transaction.cursor() as cursor:
            cursor.execute(
                """
                update assistant_runs
                   set status='done',result_type=%s,error_code=%s,result=%s,error=null,
                       leased_by=null,lease_expires_at=null,updated_at=clock_timestamp()
                 where id=%s::uuid and status='running' and leased_by=%s
                   and lease_generation=%s and lease_expires_at > clock_timestamp()
                """,
                (
                    result_type,
                    error_code,
                    Jsonb(success.result),
                    token.job_id,
                    token.owner_id,
                    token.lease_generation,
                ),
            )
            return Outcome.APPLIED if cursor.rowcount == 1 else Outcome.STALE

    def fail(
        self,
        transaction: psycopg.Connection[Any],
        token: ClaimToken,
        failure: AssistantFailure,
    ) -> MutationOutcome:
        retry = failure.retryable and self._attempts(transaction, token.job_id) < self._max_attempts
        with transaction.cursor() as cursor:
            cursor.execute(
                """
                update assistant_runs
                   set status=%s,error=%s,leased_by=null,lease_expires_at=null,
                       updated_at=clock_timestamp()
                 where id=%s::uuid and status='running' and leased_by=%s
                   and lease_generation=%s and lease_expires_at > clock_timestamp()
                """,
                (
                    "queued" if retry else "error",
                    failure.error,
                    token.job_id,
                    token.owner_id,
                    token.lease_generation,
                ),
            )
            return Outcome.APPLIED if cursor.rowcount == 1 else Outcome.STALE

    def snapshot(self, transaction: psycopg.Connection[Any]) -> QueueSnapshot:
        with transaction.cursor() as cursor:
            cursor.execute(
                """
                select count(*) filter (where status='queued'),
                       coalesce(extract(epoch from clock_timestamp()-
                         (min(created_at) filter (where status='queued'))),0),
                       count(*) filter (
                         where status='running' and lease_expires_at < clock_timestamp()
                       )
                  from assistant_runs
                """
            )
            row = cursor.fetchone()
        return QueueSnapshot(int(row[0]), float(row[1]), int(row[2]))

    @staticmethod
    def _attempts(transaction: psycopg.Connection[Any], run_id: str) -> int:
        with transaction.cursor() as cursor:
            cursor.execute("select attempts from assistant_runs where id=%s::uuid", (run_id,))
            row = cursor.fetchone()
        return int(row[0]) if row else 0


_ACQUIRE_SQL = """
with candidate as (
  select id from assistant_runs
   where status='queued'
   order by created_at,id
     for update skip locked
   limit 1
), updated as (
  update assistant_runs runs
     set status='running',leased_by=%s,
         lease_expires_at=clock_timestamp()+interval '1 second'*%s,
         lease_generation=lease_generation+1,attempts=attempts+1,
         updated_at=clock_timestamp()
    from candidate
   where runs.id=candidate.id
   returning runs.*
)
select id::text,thread_id::text,user_id::text,message,
       attempts,lease_expires_at,lease_generation
  from updated
"""


def _claimed_job(row: tuple[object, ...], owner_id: str) -> ClaimedJob[AssistantPayload]:
    run_id, thread_id, user_id, message, attempts, expires_at, generation = row
    run_id = str(run_id)
    return ClaimedJob(
        token=ClaimToken(run_id, owner_id, int(generation)),
        payload=AssistantPayload(run_id, str(thread_id), str(user_id), str(message)),
        attempts=int(attempts),
        lease_expires_at=(
            expires_at
            if isinstance(expires_at, datetime)
            else datetime.fromisoformat(str(expires_at))
        ),
    )
