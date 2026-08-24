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


@dataclass(frozen=True, slots=True)
class SearchPayload:
    job_id: str
    model_id: str
    embedding_model: str
    embedding_version: str
    dim: int
    text_sha256: bytes
    content_generation: int


@dataclass(frozen=True, slots=True)
class SearchSuccess:
    content_generation: int


@dataclass(frozen=True, slots=True)
class SearchFailure:
    error: str
    content_generation: int
    retryable: bool = True


class PsycopgTransactionManager:
    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    @contextmanager
    def transaction(self) -> Generator[psycopg.Connection[Any]]:
        with psycopg.connect(self._database_url) as connection:
            with connection.transaction():
                yield connection


class SearchRepository:
    def __init__(self, *, max_attempts: int, embedding_model_prefix: str = "hyperpc/%") -> None:
        if max_attempts < 1:
            raise ValueError("max_attempts must be positive")
        self._max_attempts = max_attempts
        self._embedding_model_prefix = embedding_model_prefix

    def claim(
        self,
        transaction: psycopg.Connection[Any],
        owner_id: str,
        lease_seconds: int,
    ) -> ClaimedJob[SearchPayload] | None:
        with transaction.cursor() as cursor:
            cursor.execute(
                _ACQUIRE_SQL,
                (self._embedding_model_prefix, owner_id, lease_seconds),
            )
            row = cursor.fetchone()
        return None if row is None else _claimed_job(row, owner_id)

    def reclaim_expired(
        self,
        transaction: psycopg.Connection[Any],
        owner_id: str,
        lease_seconds: int,
    ) -> Acquisition[SearchPayload]:
        with transaction.cursor() as cursor:
            cursor.execute(
                """
                with candidate as (
                  select id from search_index_jobs
                   where embedding_model like %s and status='running'
                     and leased_until < clock_timestamp()
                   order by leased_until,id
                     for update skip locked
                   limit 1
                ), updated as (
                  update search_index_jobs jobs
                     set status=case when attempts >= %s then 'failed' else 'running' end,
                         last_error=case when attempts >= %s then 'index attempts exhausted'
                                         else last_error end,
                         leased_by=case when attempts >= %s then null else %s end,
                         leased_until=case when attempts >= %s then null else
                           clock_timestamp()+interval '1 second'*%s end,
                         lease_generation=case when attempts >= %s then lease_generation
                                               else lease_generation+1 end,
                         attempts=case when attempts >= %s then attempts else attempts+1 end,
                         updated_at=clock_timestamp()
                    from candidate
                   where jobs.id=candidate.id
                   returning jobs.*
                )
                select status,id::text,model_id::text,embedding_model,embedding_version,
                       dim,text_sha256,generation,attempts,leased_until,lease_generation
                  from updated
                """,
                (
                    self._embedding_model_prefix,
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
        if row[0] == "failed":
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
                update search_index_jobs
                   set leased_until=clock_timestamp()+interval '1 second'*%s,
                       updated_at=clock_timestamp()
                 where id=%s::uuid and status='running' and leased_by=%s
                   and lease_generation=%s and leased_until > clock_timestamp()
                """,
                (lease_seconds, token.job_id, token.owner_id, token.lease_generation),
            )
            return Outcome.APPLIED if cursor.rowcount == 1 else Outcome.STALE

    def succeed(
        self,
        transaction: psycopg.Connection[Any],
        token: ClaimToken,
        result: SearchSuccess,
    ) -> MutationOutcome:
        with transaction.cursor() as cursor:
            cursor.execute(
                """
                update search_index_jobs
                   set status='done',leased_by=null,leased_until=null,last_error=null,
                       updated_at=clock_timestamp()
                 where id=%s::uuid and status='running' and leased_by=%s
                   and lease_generation=%s and leased_until > clock_timestamp()
                   and generation=%s
                """,
                (
                    token.job_id,
                    token.owner_id,
                    token.lease_generation,
                    result.content_generation,
                ),
            )
            return Outcome.APPLIED if cursor.rowcount == 1 else Outcome.STALE

    def fail(
        self,
        transaction: psycopg.Connection[Any],
        token: ClaimToken,
        failure: SearchFailure,
    ) -> MutationOutcome:
        attempts = self._attempts(transaction, token.job_id)
        retry = failure.retryable and attempts < self._max_attempts
        with transaction.cursor() as cursor:
            cursor.execute(
                """
                update search_index_jobs
                   set status=%s,last_error=%s,leased_by=null,leased_until=null,
                       updated_at=clock_timestamp()
                 where id=%s::uuid and status='running' and leased_by=%s
                   and lease_generation=%s and leased_until > clock_timestamp()
                   and generation=%s
                """,
                (
                    "queued" if retry else "failed",
                    failure.error,
                    token.job_id,
                    token.owner_id,
                    token.lease_generation,
                    failure.content_generation,
                ),
            )
            return Outcome.APPLIED if cursor.rowcount == 1 else Outcome.STALE

    def snapshot(self, transaction: psycopg.Connection[Any]) -> QueueSnapshot:
        with transaction.cursor() as cursor:
            cursor.execute(
                """
                select count(*) filter (
                         where status='queued' and embedding_model like %s
                       ),
                       coalesce(extract(epoch from clock_timestamp()-
                         (min(created_at) filter (
                           where status='queued' and embedding_model like %s
                         ))),0),
                       count(*) filter (
                         where status='running' and embedding_model like %s
                           and leased_until < clock_timestamp()
                       )
                  from search_index_jobs
                """,
                (
                    self._embedding_model_prefix,
                    self._embedding_model_prefix,
                    self._embedding_model_prefix,
                ),
            )
            row = cursor.fetchone()
        return QueueSnapshot(int(row[0]), float(row[1]), int(row[2]))

    @staticmethod
    def _attempts(transaction: psycopg.Connection[Any], job_id: str) -> int:
        with transaction.cursor() as cursor:
            cursor.execute("select attempts from search_index_jobs where id=%s::uuid", (job_id,))
            row = cursor.fetchone()
        return int(row[0]) if row else 0


_ACQUIRE_SQL = """
with candidate as (
  select id from search_index_jobs
   where status='queued' and embedding_model like %s
   order by created_at,id
     for update skip locked
   limit 1
), updated as (
  update search_index_jobs jobs
     set status='running',leased_by=%s,
         leased_until=clock_timestamp()+interval '1 second'*%s,
         lease_generation=lease_generation+1,attempts=attempts+1,
         updated_at=clock_timestamp()
    from candidate
   where jobs.id=candidate.id
   returning jobs.*
)
select id::text,model_id::text,embedding_model,embedding_version,dim,text_sha256,
       generation,attempts,leased_until,lease_generation
  from updated
"""


def _claimed_job(row: tuple[object, ...], owner_id: str) -> ClaimedJob[SearchPayload]:
    (
        job_id,
        model_id,
        model,
        version,
        dim,
        text_sha256,
        content_generation,
        attempts,
        expires_at,
        lease_generation,
    ) = row
    job_id = str(job_id)
    return ClaimedJob(
        token=ClaimToken(job_id, owner_id, int(lease_generation)),
        payload=SearchPayload(
            job_id,
            str(model_id),
            str(model),
            str(version),
            int(dim),
            bytes(text_sha256),
            int(content_generation),
        ),
        attempts=int(attempts),
        lease_expires_at=(
            expires_at
            if isinstance(expires_at, datetime)
            else datetime.fromisoformat(str(expires_at))
        ),
    )
