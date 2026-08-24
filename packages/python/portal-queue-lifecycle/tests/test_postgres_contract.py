from __future__ import annotations

import os
from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime
from typing import cast
from uuid import uuid4

import psycopg
import pytest
from psycopg import Connection, sql

from portal_queue_lifecycle import (
    Acquisition,
    ClaimedJob,
    ClaimToken,
    MutationOutcome,
    Outcome,
    QueueLifecycle,
    QueueSnapshot,
    require_disposable_postgres_url,
    require_expected_database,
)

type PgConnection = Connection[tuple[object, ...]]
type PgLifecycle = QueueLifecycle[PgConnection, str, str, str]


def _connect(database_url: str) -> PgConnection:
    return cast(PgConnection, cast(object, psycopg.connect(database_url)))


class PostgresTransactionManager:
    """Contract fixture: every operation gets a fresh PostgreSQL connection."""

    def __init__(self, database_url: str) -> None:
        self._database_url = database_url
        self.backend_pids: list[int] = []

    @contextmanager
    def transaction(self) -> Generator[PgConnection]:
        with _connect(self._database_url) as connection:
            with connection.cursor() as cursor:
                _ = cursor.execute("SELECT pg_backend_pid()")
                row = cursor.fetchone()
            if row is None:
                raise RuntimeError("PostgreSQL did not return a backend pid")
            self.backend_pids.append(cast(int, row[0]))
            with connection.transaction():
                yield connection


class PostgresContractRepository:
    def __init__(self, schema: str) -> None:
        self._table = sql.Identifier(schema, "queue_jobs")
        self.raise_after_success = False

    def claim(
        self, transaction: PgConnection, owner_id: str, lease_seconds: int
    ) -> ClaimedJob[str] | None:
        query = sql.SQL(
            """
            WITH candidate AS (
              SELECT id
              FROM {table}
              WHERE status = 'queued' AND attempts < max_attempts
              ORDER BY id
              FOR UPDATE SKIP LOCKED
              LIMIT 1
            )
            UPDATE {table} AS jobs
            SET status = 'running',
                leased_by = %s,
                leased_until = clock_timestamp() + interval '1 second' * %s,
                lease_generation = jobs.lease_generation + 1,
                attempts = jobs.attempts + 1
            FROM candidate
            WHERE jobs.id = candidate.id
            RETURNING jobs.id, jobs.payload, jobs.attempts,
                      jobs.leased_until, jobs.lease_generation
            """
        ).format(table=self._table)
        with transaction.cursor() as cursor:
            _ = cursor.execute(query, (owner_id, lease_seconds))
            row = cursor.fetchone()
        return None if row is None else self._claimed(row, owner_id)

    def reclaim_expired(
        self, transaction: PgConnection, owner_id: str, lease_seconds: int
    ) -> Acquisition[str]:
        query = sql.SQL(
            """
            WITH candidate AS (
              SELECT id
              FROM {table}
              WHERE status = 'running' AND leased_until < clock_timestamp()
              ORDER BY leased_until, id
              FOR UPDATE SKIP LOCKED
              LIMIT 1
            )
            UPDATE {table} AS jobs
            SET status = CASE
                  WHEN jobs.attempts >= jobs.max_attempts THEN 'failed'
                  ELSE 'running'
                END,
                leased_by = CASE
                  WHEN jobs.attempts >= jobs.max_attempts THEN NULL ELSE %s
                END,
                leased_until = CASE
                  WHEN jobs.attempts >= jobs.max_attempts THEN NULL
                  ELSE clock_timestamp() + interval '1 second' * %s
                END,
                lease_generation = CASE
                  WHEN jobs.attempts >= jobs.max_attempts THEN jobs.lease_generation
                  ELSE jobs.lease_generation + 1
                END,
                attempts = CASE
                  WHEN jobs.attempts >= jobs.max_attempts THEN jobs.attempts
                  ELSE jobs.attempts + 1
                END,
                last_error = CASE
                  WHEN jobs.attempts >= jobs.max_attempts THEN 'attempts_exhausted'
                  ELSE jobs.last_error
                END
            FROM candidate
            WHERE jobs.id = candidate.id
            RETURNING jobs.status, jobs.id, jobs.payload, jobs.attempts,
                      jobs.leased_until, jobs.lease_generation
            """
        ).format(table=self._table)
        with transaction.cursor() as cursor:
            _ = cursor.execute(query, (owner_id, lease_seconds))
            row = cursor.fetchone()
        if row is None:
            return Acquisition(Outcome.EMPTY)
        if cast(str, row[0]) == "failed":
            return Acquisition(Outcome.EXHAUSTED)
        return Acquisition(Outcome.APPLIED, self._claimed(row[1:], owner_id))

    def heartbeat(
        self,
        transaction: PgConnection,
        token: ClaimToken,
        lease_seconds: int,
    ) -> MutationOutcome:
        query = sql.SQL(
            """
            UPDATE {table}
            SET leased_until = clock_timestamp() + interval '1 second' * %s
            WHERE id = %s AND status = 'running' AND leased_by = %s
              AND lease_generation = %s AND leased_until > clock_timestamp()
            RETURNING id
            """
        ).format(table=self._table)
        return self._mutation(transaction, query, (
            lease_seconds,
            token.job_id,
            token.owner_id,
            token.lease_generation,
        ))

    def succeed(
        self, transaction: PgConnection, token: ClaimToken, result: str
    ) -> MutationOutcome:
        query = sql.SQL(
            """
            UPDATE {table}
            SET status = 'done', result = %s, leased_by = NULL, leased_until = NULL
            WHERE id = %s AND status = 'running' AND leased_by = %s
              AND lease_generation = %s AND leased_until > clock_timestamp()
            RETURNING id
            """
        ).format(table=self._table)
        outcome = self._mutation(transaction, query, (
            result,
            token.job_id,
            token.owner_id,
            token.lease_generation,
        ))
        if outcome is Outcome.APPLIED and self.raise_after_success:
            raise RuntimeError("forced rollback after terminal update")
        return outcome

    def fail(
        self, transaction: PgConnection, token: ClaimToken, failure: str
    ) -> MutationOutcome:
        query = sql.SQL(
            """
            UPDATE {table}
            SET status = 'failed', last_error = %s, leased_by = NULL, leased_until = NULL
            WHERE id = %s AND status = 'running' AND leased_by = %s
              AND lease_generation = %s AND leased_until > clock_timestamp()
            RETURNING id
            """
        ).format(table=self._table)
        return self._mutation(transaction, query, (
            failure,
            token.job_id,
            token.owner_id,
            token.lease_generation,
        ))

    def snapshot(self, transaction: PgConnection) -> QueueSnapshot:
        query = sql.SQL(
            """
            SELECT count(*) FILTER (WHERE status = 'queued'),
                   coalesce(extract(epoch FROM clock_timestamp() - min(created_at))
                     FILTER (WHERE status = 'queued'), 0),
                   count(*) FILTER (
                     WHERE status = 'running' AND leased_until < clock_timestamp()
                   )
            FROM {table}
            """
        ).format(table=self._table)
        with transaction.cursor() as cursor:
            _ = cursor.execute(query)
            row = cursor.fetchone()
        if row is None:
            raise RuntimeError("snapshot query returned no row")
        return QueueSnapshot(
            int(cast(int, row[0])),
            float(cast(float, row[1])),
            int(cast(int, row[2])),
        )

    @staticmethod
    def _claimed(row: tuple[object, ...], owner_id: str) -> ClaimedJob[str]:
        job_id, payload, attempts, leased_until, lease_generation = row
        return ClaimedJob(
            token=ClaimToken(cast(str, job_id), owner_id, cast(int, lease_generation)),
            payload=cast(str, payload),
            attempts=cast(int, attempts),
            lease_expires_at=cast(datetime, leased_until),
        )

    @staticmethod
    def _mutation(
        transaction: PgConnection,
        query: sql.Composed,
        parameters: tuple[object, ...],
    ) -> MutationOutcome:
        with transaction.cursor() as cursor:
            _ = cursor.execute(query, parameters)
            return Outcome.APPLIED if cursor.fetchone() is not None else Outcome.STALE


@pytest.fixture
def postgres_contract() -> Generator[tuple[str, str]]:
    database_url = os.getenv("PORTAL_QUEUE_TEST_DATABASE_URL")
    if database_url is None:
        pytest.skip("PORTAL_QUEUE_TEST_DATABASE_URL is not configured")
    target = require_disposable_postgres_url(database_url)
    schema = f"queue_contract_{uuid4().hex}"
    with _connect(database_url) as connection:
        with connection.cursor() as cursor:
            _ = cursor.execute("SELECT current_database()")
            row = cursor.fetchone()
            if row is None:
                raise RuntimeError("PostgreSQL did not return current_database()")
            require_expected_database(expected=target.database_name, actual=cast(str, row[0]))
            _ = cursor.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
            _ = cursor.execute(
                sql.SQL(
                    """
                    CREATE TABLE {}.queue_jobs (
                      id text PRIMARY KEY,
                      payload text NOT NULL,
                      status text NOT NULL CHECK (status IN ('queued','running','done','failed')),
                      attempts integer NOT NULL DEFAULT 0,
                      max_attempts integer NOT NULL,
                      leased_by text,
                      leased_until timestamptz,
                      lease_generation bigint NOT NULL DEFAULT 0,
                      result text,
                      last_error text,
                      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
                    )
                    """
                ).format(sql.Identifier(schema))
            )
        connection.commit()
    try:
        yield database_url, schema
    finally:
        with _connect(database_url) as connection:
            with connection.cursor() as cursor:
                _ = cursor.execute(
                    sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema))
                )
            connection.commit()


def _lifecycle(
    database_url: str, schema: str
) -> tuple[PgLifecycle, PostgresTransactionManager, PostgresContractRepository]:
    transactions = PostgresTransactionManager(database_url)
    repository = PostgresContractRepository(schema)
    lifecycle = QueueLifecycle[PgConnection, str, str, str](
        queue="contract",
        transactions=transactions,
        repository=repository,
    )
    return lifecycle, transactions, repository


def _insert(database_url: str, schema: str, job_id: str, *, max_attempts: int = 3) -> None:
    with _connect(database_url) as connection:
        with connection.cursor() as cursor:
            _ = cursor.execute(
                sql.SQL(
                    "INSERT INTO {}.queue_jobs (id, payload, status, max_attempts) "
                    "VALUES (%s, %s, 'queued', %s)"
                ).format(sql.Identifier(schema)),
                (job_id, f"payload-{job_id}", max_attempts),
            )
        connection.commit()


def _row(database_url: str, schema: str, job_id: str) -> tuple[object, ...]:
    with _connect(database_url) as connection:
        with connection.cursor() as cursor:
            _ = cursor.execute(
                sql.SQL(
                    "SELECT status, attempts, lease_generation, leased_by, result, last_error "
                    "FROM {}.queue_jobs WHERE id = %s"
                ).format(sql.Identifier(schema)),
                (job_id,),
            )
            row = cursor.fetchone()
    if row is None:
        raise RuntimeError("queue row not found")
    return row


def _lease_deadline(database_url: str, schema: str, job_id: str) -> datetime:
    with _connect(database_url) as connection:
        with connection.cursor() as cursor:
            _ = cursor.execute(
                sql.SQL("SELECT leased_until FROM {}.queue_jobs WHERE id = %s").format(
                    sql.Identifier(schema)
                ),
                (job_id,),
            )
            row = cursor.fetchone()
    if row is None or row[0] is None:
        raise RuntimeError("queue row has no lease deadline")
    return cast(datetime, row[0])


def test_concurrent_claim_is_exclusive(postgres_contract: tuple[str, str]) -> None:
    database_url, schema = postgres_contract
    _insert(database_url, schema, "job-1")

    def claim(owner: str) -> Acquisition[str]:
        lifecycle, _, _ = _lifecycle(database_url, schema)
        return lifecycle.claim(owner, 10)

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = tuple(executor.map(claim, ("worker-1", "worker-2")))

    assert sum(result.outcome is Outcome.APPLIED for result in results) == 1
    assert sum(result.outcome is Outcome.EMPTY for result in results) == 1
    assert _row(database_url, schema, "job-1")[1:3] == (1, 1)


def test_database_expiry_reclaim_and_stale_terminal_write(
    postgres_contract: tuple[str, str],
) -> None:
    database_url, schema = postgres_contract
    _insert(database_url, schema, "job-1")
    lifecycle, transactions, _ = _lifecycle(database_url, schema)
    first = lifecycle.claim("worker-1", 1)
    assert first.job is not None

    with _connect(database_url) as connection:
        with connection.cursor() as cursor:
            _ = cursor.execute("SELECT pg_sleep(1.05)")

    reclaimed = lifecycle.reclaim_expired("worker-2", 10)
    assert reclaimed.job is not None
    assert reclaimed.job.attempts == 2
    assert reclaimed.job.token.lease_generation == 2
    assert lifecycle.succeed(first.job.token, "stale-result") is Outcome.STALE
    assert lifecycle.succeed(reclaimed.job.token, "fresh-result") is Outcome.APPLIED
    assert _row(database_url, schema, "job-1")[:5] == (
        "done",
        2,
        2,
        None,
        "fresh-result",
    )
    assert len(set(transactions.backend_pids)) == len(transactions.backend_pids)


def test_heartbeat_uses_a_fresh_connection_and_extends_database_deadline(
    postgres_contract: tuple[str, str],
) -> None:
    database_url, schema = postgres_contract
    _insert(database_url, schema, "job-1")
    lifecycle, transactions, _ = _lifecycle(database_url, schema)
    claimed = lifecycle.claim("worker-1", 2)
    assert claimed.job is not None
    first_deadline = _lease_deadline(database_url, schema, "job-1")
    with _connect(database_url) as connection:
        with connection.cursor() as cursor:
            _ = cursor.execute("SELECT pg_sleep(0.05)")

    assert lifecycle.heartbeat(claimed.job.token, 2) is Outcome.APPLIED
    assert _lease_deadline(database_url, schema, "job-1") > first_deadline
    assert len(transactions.backend_pids) == 2
    assert transactions.backend_pids[0] != transactions.backend_pids[1]


def test_reclaim_exhaustion_does_not_create_an_attempt(
    postgres_contract: tuple[str, str],
) -> None:
    database_url, schema = postgres_contract
    _insert(database_url, schema, "job-1", max_attempts=1)
    lifecycle, _, _ = _lifecycle(database_url, schema)
    claimed = lifecycle.claim("worker-1", 1)
    assert claimed.job is not None
    with _connect(database_url) as connection:
        with connection.cursor() as cursor:
            _ = cursor.execute(
                sql.SQL(
                    "UPDATE {}.queue_jobs SET leased_until = "
                    "clock_timestamp() - interval '1 second' "
                    "WHERE id = 'job-1'"
                ).format(sql.Identifier(schema))
            )
        connection.commit()

    assert lifecycle.reclaim_expired("worker-2", 10).outcome is Outcome.EXHAUSTED
    assert _row(database_url, schema, "job-1") == (
        "failed",
        1,
        1,
        None,
        None,
        "attempts_exhausted",
    )


def test_concurrent_reclaim_is_atomic(postgres_contract: tuple[str, str]) -> None:
    database_url, schema = postgres_contract
    _insert(database_url, schema, "job-1")
    first_lifecycle, _, _ = _lifecycle(database_url, schema)
    first = first_lifecycle.claim("worker-1", 10)
    assert first.job is not None
    with _connect(database_url) as connection:
        with connection.cursor() as cursor:
            _ = cursor.execute(
                sql.SQL(
                    "UPDATE {}.queue_jobs SET leased_until = "
                    "clock_timestamp() - interval '1 second' WHERE id = 'job-1'"
                ).format(sql.Identifier(schema))
            )
        connection.commit()

    def reclaim(owner: str) -> Acquisition[str]:
        lifecycle, _, _ = _lifecycle(database_url, schema)
        return lifecycle.reclaim_expired(owner, 10)

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = tuple(executor.map(reclaim, ("worker-2", "worker-3")))

    assert sum(result.outcome is Outcome.APPLIED for result in results) == 1
    assert sum(result.outcome is Outcome.EMPTY for result in results) == 1
    assert _row(database_url, schema, "job-1")[1:3] == (2, 2)


def test_terminal_update_rolls_back_with_transaction(
    postgres_contract: tuple[str, str],
) -> None:
    database_url, schema = postgres_contract
    _insert(database_url, schema, "job-1")
    lifecycle, _, repository = _lifecycle(database_url, schema)
    claimed = lifecycle.claim("worker-1", 10)
    assert claimed.job is not None
    repository.raise_after_success = True

    with pytest.raises(RuntimeError, match="forced rollback"):
        _ = lifecycle.succeed(claimed.job.token, "must-rollback")

    assert _row(database_url, schema, "job-1")[:5] == (
        "running",
        1,
        1,
        "worker-1",
        None,
    )
