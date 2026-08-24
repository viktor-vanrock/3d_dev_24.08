from __future__ import annotations

import json
import os
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import psycopg
import pytest
from portal_queue_lifecycle import (
    ClaimToken,
    InMemoryMetricsSink,
    Outcome,
    QueueLifecycle,
    require_disposable_postgres_url,
    require_expected_database,
    run_until_ready_then_sigkill,
)

from giga.generation_lifecycle import (
    GenerationFailure,
    GenerationProgressWriter,
    GenerationRepository,
    GenerationSuccess,
    PsycopgTransactionManager,
)

_DATABASE_URL = os.getenv("PORTAL_QUEUE_TEST_DATABASE_URL")


def _lifecycle(*, max_attempts: int = 3, metrics=None) -> QueueLifecycle:
    assert _DATABASE_URL is not None
    return QueueLifecycle(
        queue="giga-generation",
        transactions=PsycopgTransactionManager(_DATABASE_URL),
        repository=GenerationRepository(max_attempts=max_attempts),
        metrics=metrics,
    )


@pytest.fixture
def generation() -> tuple[str, str]:
    if _DATABASE_URL is None:
        pytest.skip("PORTAL_QUEUE_TEST_DATABASE_URL is not configured")
    target = require_disposable_postgres_url(_DATABASE_URL)
    user_id, generation_id = str(uuid4()), str(uuid4())
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute("select current_database()")
            require_expected_database(
                expected=target.database_name,
                actual=str(cursor.fetchone()[0]),
            )
            cursor.execute(
                "insert into users(id,username) values (%s,%s)",
                (user_id, f"generation-queue-{user_id}"),
            )
            cursor.execute(
                """
                insert into generations(id,user_id,branch,prompt,params)
                values (%s,%s,'concepts','test generation','{}')
                """,
                (generation_id, user_id),
            )
            cursor.execute(
                """
                insert into generated_concepts
                  (generation_id,normalized_query,label,prompt,cache_key)
                values (%s,'test','Test','test generation',%s)
                """,
                (generation_id, f"test-{generation_id}"),
            )
    try:
        yield user_id, generation_id
    finally:
        with psycopg.connect(_DATABASE_URL) as connection:
            with connection.cursor() as cursor:
                cursor.execute("delete from generations where id=%s", (generation_id,))
                cursor.execute("delete from users where id=%s", (user_id,))


def test_concurrent_claim_fences_progress_and_completes_concept_atomically(
    generation: tuple[str, str],
) -> None:
    assert _DATABASE_URL is not None
    _, generation_id = generation
    metrics = InMemoryMetricsSink()
    lifecycle = _lifecycle(metrics=metrics)
    with ThreadPoolExecutor(max_workers=2) as executor:
        claims = tuple(executor.map(lambda owner: lifecycle.claim(owner, 30), ("one", "two")))
    applied = next(item for item in claims if item.outcome is Outcome.APPLIED)
    assert applied.job is not None
    assert sum(item.outcome is Outcome.EMPTY for item in claims) == 1
    writer = GenerationProgressWriter(_DATABASE_URL, applied.job.token)
    assert writer.report("geometry", 40, eta_seconds=30) is True
    assert lifecycle.succeed(
        applied.job.token,
        GenerationSuccess("generations/result.json", "generations/preview.webp"),
    ) is Outcome.APPLIED
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "select status,phase,progress,attempts,lease_generation "
                "from generations where id=%s",
                (generation_id,),
            )
            assert cursor.fetchone() == ("done", "export", 100, 1, 1)
            cursor.execute(
                "select status,ready_at is not null from generated_concepts where generation_id=%s",
                (generation_id,),
            )
            assert cursor.fetchone() == ("ready", True)
    assert lifecycle.collect_metrics().waiting_depth == 0


def test_expired_reclaim_rejects_stale_progress_result_and_error(
    generation: tuple[str, str],
) -> None:
    assert _DATABASE_URL is not None
    _, generation_id = generation
    lifecycle = _lifecycle()
    first = lifecycle.claim("old", 30)
    assert first.job is not None
    with psycopg.connect(_DATABASE_URL) as connection:
        connection.execute(
            "update generations set lease_expires_at=clock_timestamp()-interval '1 second' "
            "where id=%s",
            (generation_id,),
        )
    second = lifecycle.reclaim_expired("new", 30)
    assert second.job is not None
    assert GenerationProgressWriter(_DATABASE_URL, first.job.token).report("geometry", 50) is False
    assert lifecycle.succeed(
        first.job.token,
        GenerationSuccess("late", None),
    ) is Outcome.STALE
    assert lifecycle.fail(first.job.token, GenerationFailure("late", False)) is Outcome.STALE
    assert lifecycle.succeed(
        second.job.token,
        GenerationSuccess("generations/new.json", None),
    ) is Outcome.APPLIED
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "select status,attempts,lease_generation from generations where id=%s",
                (generation_id,),
            )
            assert cursor.fetchone() == ("done", 2, 2)


def test_sigkill_then_reclaim_fences_captured_generation_worker(
    generation: tuple[str, str],
) -> None:
    assert _DATABASE_URL is not None
    _, generation_id = generation
    child_code = """
import json
import os
from pathlib import Path
import time

from giga.generation_lifecycle import GenerationRepository, PsycopgTransactionManager
from portal_queue_lifecycle import QueueLifecycle

url = os.environ["PORTAL_QUEUE_TEST_DATABASE_URL"]
lifecycle = QueueLifecycle(
    queue="giga-generation",
    transactions=PsycopgTransactionManager(url),
    repository=GenerationRepository(max_attempts=3),
)
job = lifecycle.claim("generation-worker-crashed", 1).job
if job is None:
    raise RuntimeError("child failed to claim generation")
Path(os.environ["PORTAL_QUEUE_CRASH_READY_FILE"]).write_text(json.dumps({
    "job_id": job.token.job_id,
    "owner_id": job.token.owner_id,
    "lease_generation": job.token.lease_generation,
}), encoding="utf-8")
time.sleep(60)
"""
    environment = dict(os.environ)
    environment["PORTAL_QUEUE_TEST_DATABASE_URL"] = _DATABASE_URL
    captured = json.loads(run_until_ready_then_sigkill(child_code, environment))
    with psycopg.connect(_DATABASE_URL) as connection:
        connection.execute("select pg_sleep(1.05)")

    lifecycle = _lifecycle()
    reclaimed = lifecycle.reclaim_expired("generation-worker-recovery", 30)
    assert reclaimed.job is not None
    assert reclaimed.job.attempts == 2
    result = GenerationSuccess("generations/recovered.json", None)
    assert lifecycle.succeed(reclaimed.job.token, result) is Outcome.APPLIED
    stale = ClaimToken(
        str(captured["job_id"]),
        str(captured["owner_id"]),
        int(captured["lease_generation"]),
    )
    assert GenerationProgressWriter(_DATABASE_URL, stale).report("late", 90) is False
    assert lifecycle.heartbeat(stale, 30) is Outcome.STALE
    assert lifecycle.succeed(stale, result) is Outcome.STALE
    assert lifecycle.fail(stale, GenerationFailure("late", False)) is Outcome.STALE
    with psycopg.connect(_DATABASE_URL) as connection:
        assert connection.execute(
            "select status,attempts,lease_generation from generations where id=%s",
            (generation_id,),
        ).fetchone() == ("done", 2, 2)


def test_external_timeout_wins_progress_completion_and_failure_races(
    generation: tuple[str, str],
) -> None:
    assert _DATABASE_URL is not None
    _, generation_id = generation
    lifecycle = _lifecycle()
    claim = lifecycle.claim("worker", 30)
    assert claim.job is not None
    with psycopg.connect(_DATABASE_URL) as connection:
        connection.execute(
            "update generations set status='timed_out',leased_by=null,lease_expires_at=null "
            "where id=%s",
            (generation_id,),
        )
        connection.execute(
            "update generated_concepts set status='failed' where generation_id=%s",
            (generation_id,),
        )
    assert GenerationProgressWriter(_DATABASE_URL, claim.job.token).report("export", 90) is False
    assert lifecycle.succeed(claim.job.token, GenerationSuccess("late", None)) is Outcome.STALE
    assert lifecycle.fail(claim.job.token, GenerationFailure("late", False)) is Outcome.STALE
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute("select status from generations where id=%s", (generation_id,))
            assert cursor.fetchone() == ("timed_out",)
            cursor.execute(
                "select status from generated_concepts where generation_id=%s",
                (generation_id,),
            )
            assert cursor.fetchone() == ("failed",)


def test_expired_attempt_exhaustion_fails_generation_and_concept(
    generation: tuple[str, str],
) -> None:
    assert _DATABASE_URL is not None
    _, generation_id = generation
    lifecycle = _lifecycle(max_attempts=1)
    claim = lifecycle.claim("one", 30)
    assert claim.job is not None
    with psycopg.connect(_DATABASE_URL) as connection:
        connection.execute(
            "update generations set lease_expires_at=clock_timestamp()-interval '1 second' "
            "where id=%s",
            (generation_id,),
        )
    assert lifecycle.reclaim_expired("two", 30).outcome is Outcome.EXHAUSTED
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute("select status,attempts from generations where id=%s", (generation_id,))
            assert cursor.fetchone() == ("error", 1)
            cursor.execute(
                "select status from generated_concepts where generation_id=%s",
                (generation_id,),
            )
            assert cursor.fetchone() == ("failed",)
