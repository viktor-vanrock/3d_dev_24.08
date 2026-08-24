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
class GenerationPayload:
    generation_id: str
    user_id: str
    branch: str
    prompt: str
    params: dict[str, Any]


@dataclass(frozen=True, slots=True)
class GenerationSuccess:
    artifact_url: str
    preview_url: str | None


@dataclass(frozen=True, slots=True)
class GenerationFailure:
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


class GenerationRepository:
    def __init__(self, *, max_attempts: int) -> None:
        if max_attempts < 1:
            raise ValueError("max_attempts must be positive")
        self._max_attempts = max_attempts

    def claim(
        self,
        transaction: psycopg.Connection[Any],
        owner_id: str,
        lease_seconds: int,
    ) -> ClaimedJob[GenerationPayload] | None:
        with transaction.cursor() as cursor:
            cursor.execute(_ACQUIRE_SQL, (owner_id, lease_seconds))
            row = cursor.fetchone()
            if row is not None and row[2] == "concepts":
                cursor.execute(
                    """
                    update generated_concepts
                       set status='running', updated_at=clock_timestamp()
                     where generation_id=%s::uuid and status='queued'
                    """,
                    (row[0],),
                )
        return None if row is None else _claimed_job(row, owner_id)

    def reclaim_expired(
        self,
        transaction: psycopg.Connection[Any],
        owner_id: str,
        lease_seconds: int,
    ) -> Acquisition[GenerationPayload]:
        with transaction.cursor() as cursor:
            cursor.execute(
                """
                with candidate as (
                  select id from generations
                   where status='running' and lease_expires_at < clock_timestamp()
                   order by lease_expires_at, id
                     for update skip locked
                   limit 1
                ), updated as (
                  update generations jobs
                     set status=case when attempts >= %s then 'error' else 'running' end,
                         error=case when attempts >= %s then 'generation attempts exhausted'
                                    else error end,
                         leased_by=case when attempts >= %s then null else %s end,
                         lease_expires_at=case when attempts >= %s then null else
                           clock_timestamp() + interval '1 second' * %s end,
                         lease_generation=case when attempts >= %s then lease_generation
                                               else lease_generation + 1 end,
                         attempts=case when attempts >= %s then attempts else attempts + 1 end,
                         updated_at=clock_timestamp()
                    from candidate
                   where jobs.id=candidate.id
                   returning jobs.*
                )
                select status, id::text, user_id::text, branch, prompt, params,
                       attempts, lease_expires_at, lease_generation
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
            if row is not None and row[0] == "error":
                cursor.execute(
                    """
                    update generated_concepts set status='failed', updated_at=clock_timestamp()
                     where generation_id=%s::uuid
                    """,
                    (row[1],),
                )
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
                update generations
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
        result: GenerationSuccess,
    ) -> MutationOutcome:
        with transaction.cursor() as cursor:
            cursor.execute(
                """
                update generations
                   set status='done', artifact_url=%s, preview_url=%s, error=null,
                       progress=100, phase='export', leased_by=null, lease_expires_at=null,
                       updated_at=clock_timestamp()
                 where id=%s::uuid and status='running' and leased_by=%s
                   and lease_generation=%s and lease_expires_at > clock_timestamp()
                """,
                (
                    result.artifact_url,
                    result.preview_url,
                    token.job_id,
                    token.owner_id,
                    token.lease_generation,
                ),
            )
            if cursor.rowcount != 1:
                return Outcome.STALE
            cursor.execute(
                """
                update generated_concepts
                   set status='ready', ready_at=clock_timestamp(), updated_at=clock_timestamp()
                 where generation_id=%s::uuid
                """,
                (token.job_id,),
            )
        return Outcome.APPLIED

    def fail(
        self,
        transaction: psycopg.Connection[Any],
        token: ClaimToken,
        failure: GenerationFailure,
    ) -> MutationOutcome:
        attempts = self._attempts(transaction, token.job_id)
        retry = failure.retryable and attempts < self._max_attempts
        with transaction.cursor() as cursor:
            cursor.execute(
                """
                update generations
                   set status=%s, error=%s, leased_by=null, lease_expires_at=null,
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
            if cursor.rowcount != 1:
                return Outcome.STALE
            cursor.execute(
                """
                update generated_concepts
                   set status=%s, updated_at=clock_timestamp()
                 where generation_id=%s::uuid
                """,
                ("queued" if retry else "failed", token.job_id),
            )
        return Outcome.APPLIED

    def snapshot(self, transaction: psycopg.Connection[Any]) -> QueueSnapshot:
        with transaction.cursor() as cursor:
            cursor.execute(
                """
                select count(*) filter (where status='queued'),
                       coalesce(extract(epoch from clock_timestamp()-
                         (min(created_at) filter (where status='queued'))), 0),
                       count(*) filter (
                         where status='running' and lease_expires_at < clock_timestamp()
                       )
                  from generations
                """
            )
            row = cursor.fetchone()
        return QueueSnapshot(int(row[0]), float(row[1]), int(row[2]))

    @staticmethod
    def _attempts(transaction: psycopg.Connection[Any], generation_id: str) -> int:
        with transaction.cursor() as cursor:
            cursor.execute("select attempts from generations where id=%s::uuid", (generation_id,))
            row = cursor.fetchone()
        return int(row[0]) if row is not None else 0


class GenerationProgressWriter:
    """Domain progress writes on short transactions with the same acquisition fence."""

    def __init__(self, database_url: str, token: ClaimToken) -> None:
        self._database_url = database_url
        self._token = token

    def report(
        self,
        phase: str,
        progress: int | None,
        *,
        eta_seconds: int | None = None,
    ) -> bool:
        if self._token.lease_lost:
            return False
        with psycopg.connect(self._database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    update generations
                       set phase=%s, progress=%s, eta_seconds=%s,
                           estimate_updated_at=clock_timestamp(), updated_at=clock_timestamp()
                     where id=%s::uuid and status='running' and leased_by=%s
                       and lease_generation=%s and lease_expires_at > clock_timestamp()
                    """,
                    (
                        phase,
                        progress,
                        eta_seconds,
                        self._token.job_id,
                        self._token.owner_id,
                        self._token.lease_generation,
                    ),
                )
                applied = cursor.rowcount == 1
        if not applied:
            self._token.mark_lease_lost()
        return applied


_ACQUIRE_SQL = """
with candidate as (
  select id from generations
   where status='queued'
     and (branch <> 'concepts' or exists (
       select 1 from generated_concepts concepts where concepts.generation_id=generations.id
     ))
   order by created_at, id
     for update skip locked
   limit 1
), updated as (
  update generations jobs
     set status='running', leased_by=%s,
         lease_expires_at=clock_timestamp()+interval '1 second'*%s,
         lease_generation=lease_generation+1, attempts=attempts+1,
         updated_at=clock_timestamp()
    from candidate
   where jobs.id=candidate.id
   returning jobs.*
)
select id::text, user_id::text, branch, prompt, params,
       attempts, lease_expires_at, lease_generation
  from updated
"""


def _claimed_job(row: tuple[object, ...], owner_id: str) -> ClaimedJob[GenerationPayload]:
    generation_id, user_id, branch, prompt, params, attempts, expires_at, generation = row
    generation_id = str(generation_id)
    return ClaimedJob(
        token=ClaimToken(generation_id, owner_id, int(generation)),
        payload=GenerationPayload(
            generation_id=generation_id,
            user_id=str(user_id),
            branch=str(branch),
            prompt=str(prompt),
            params=params if isinstance(params, dict) else {},
        ),
        attempts=int(attempts),
        lease_expires_at=(
            expires_at
            if isinstance(expires_at, datetime)
            else datetime.fromisoformat(str(expires_at))
        ),
    )
