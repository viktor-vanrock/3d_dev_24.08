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

from giga.assistant.lifecycle import (
    AssistantFailure,
    AssistantRepository,
    AssistantSuccess,
    PsycopgTransactionManager,
)

_DATABASE_URL = os.getenv("PORTAL_QUEUE_TEST_DATABASE_URL")


def _lifecycle(*, max_attempts: int = 3, metrics=None) -> QueueLifecycle:
    assert _DATABASE_URL is not None
    return QueueLifecycle(
        queue="giga-assistant",
        transactions=PsycopgTransactionManager(_DATABASE_URL),
        repository=AssistantRepository(max_attempts=max_attempts),
        metrics=metrics,
    )


@pytest.fixture
def assistant_run() -> tuple[str, str, str, str]:
    if _DATABASE_URL is None:
        pytest.skip("PORTAL_QUEUE_TEST_DATABASE_URL is not configured")
    target = require_disposable_postgres_url(_DATABASE_URL)
    user_id, thread_id, message_id, run_id = (str(uuid4()) for _ in range(4))
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute("select current_database()")
            require_expected_database(
                expected=target.database_name,
                actual=str(cursor.fetchone()[0]),
            )
            cursor.execute("set constraints all deferred")
            cursor.execute(
                "insert into users(id,username) values (%s,%s)",
                (user_id, f"assistant-queue-{user_id}"),
            )
            cursor.execute(
                "insert into assistant_threads(id,owner_id,title) values (%s,%s,'Test')",
                (thread_id, user_id),
            )
            cursor.execute(
                """
                insert into assistant_messages(id,thread_id,role,content,client_request_id)
                values (%s,%s,'user','help','request-1')
                """,
                (message_id, thread_id),
            )
            cursor.execute(
                """
                insert into assistant_runs
                  (id,thread_id,triggering_message_id,user_id,message)
                values (%s,%s,%s,%s,'help')
                """,
                (run_id, thread_id, message_id, user_id),
            )
    try:
        yield user_id, thread_id, message_id, run_id
    finally:
        with psycopg.connect(_DATABASE_URL) as connection:
            with connection.cursor() as cursor:
                cursor.execute("set constraints all deferred")
                cursor.execute("delete from assistant_runs where id=%s", (run_id,))
                cursor.execute("delete from assistant_messages where id=%s", (message_id,))
                cursor.execute("delete from assistant_threads where id=%s", (thread_id,))
                cursor.execute("delete from users where id=%s", (user_id,))


def test_concurrent_claim_heartbeat_and_fenced_result(
    assistant_run: tuple[str, str, str, str],
) -> None:
    assert _DATABASE_URL is not None
    *_, run_id = assistant_run
    metrics = InMemoryMetricsSink()
    lifecycle = _lifecycle(metrics=metrics)
    with ThreadPoolExecutor(max_workers=2) as executor:
        claims = tuple(executor.map(lambda owner: lifecycle.claim(owner, 30), ("one", "two")))
    claim = next(item for item in claims if item.outcome is Outcome.APPLIED)
    assert claim.job is not None
    assert sum(item.outcome is Outcome.EMPTY for item in claims) == 1
    assert lifecycle.heartbeat(claim.job.token, 30) is Outcome.APPLIED
    result = AssistantSuccess({"kind": "answer", "text": "ok", "citations": []})
    assert lifecycle.succeed(claim.job.token, result) is Outcome.APPLIED
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "select status,result_type,attempts,lease_generation,leased_by "
                "from assistant_runs where id=%s",
                (run_id,),
            )
            assert cursor.fetchone() == ("done", "answer", 1, 1, None)
    assert lifecycle.collect_metrics().waiting_depth == 0


def test_expired_reclaim_rejects_old_owner_and_generation(
    assistant_run: tuple[str, str, str, str],
) -> None:
    assert _DATABASE_URL is not None
    *_, run_id = assistant_run
    lifecycle = _lifecycle()
    first = lifecycle.claim("old", 30)
    assert first.job is not None
    with psycopg.connect(_DATABASE_URL) as connection:
        connection.execute(
            "update assistant_runs set lease_expires_at=clock_timestamp()-interval '1 second' "
            "where id=%s",
            (run_id,),
        )
    second = lifecycle.reclaim_expired("new", 30)
    assert second.job is not None
    result = AssistantSuccess({"kind": "clarification", "question": "which model?"})
    assert lifecycle.heartbeat(first.job.token, 30) is Outcome.STALE
    assert lifecycle.succeed(first.job.token, result) is Outcome.STALE
    assert lifecycle.fail(first.job.token, AssistantFailure("late", False)) is Outcome.STALE
    assert lifecycle.succeed(second.job.token, result) is Outcome.APPLIED
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "select status,attempts,lease_generation from assistant_runs where id=%s",
                (run_id,),
            )
            assert cursor.fetchone() == ("done", 2, 2)


def test_sigkill_then_reclaim_fences_captured_assistant_worker(
    assistant_run: tuple[str, str, str, str],
) -> None:
    assert _DATABASE_URL is not None
    *_, run_id = assistant_run
    child_code = """
import json
import os
from pathlib import Path
import time

from giga.assistant.lifecycle import AssistantRepository, PsycopgTransactionManager
from portal_queue_lifecycle import QueueLifecycle

url = os.environ["PORTAL_QUEUE_TEST_DATABASE_URL"]
lifecycle = QueueLifecycle(
    queue="giga-assistant",
    transactions=PsycopgTransactionManager(url),
    repository=AssistantRepository(max_attempts=3),
)
job = lifecycle.claim("assistant-worker-crashed", 1).job
if job is None:
    raise RuntimeError("child failed to claim assistant run")
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
    reclaimed = lifecycle.reclaim_expired("assistant-worker-recovery", 30)
    assert reclaimed.job is not None
    assert reclaimed.job.attempts == 2
    result = AssistantSuccess({"kind": "answer", "text": "recovered", "citations": []})
    assert lifecycle.succeed(reclaimed.job.token, result) is Outcome.APPLIED
    stale = ClaimToken(
        str(captured["job_id"]),
        str(captured["owner_id"]),
        int(captured["lease_generation"]),
    )
    assert lifecycle.heartbeat(stale, 30) is Outcome.STALE
    assert lifecycle.succeed(stale, result) is Outcome.STALE
    assert lifecycle.fail(stale, AssistantFailure("late", False)) is Outcome.STALE
    with psycopg.connect(_DATABASE_URL) as connection:
        assert connection.execute(
            "select status,attempts,lease_generation from assistant_runs where id=%s",
            (run_id,),
        ).fetchone() == ("done", 2, 2)


def test_external_error_wins_result_and_failure_race(
    assistant_run: tuple[str, str, str, str],
) -> None:
    assert _DATABASE_URL is not None
    *_, run_id = assistant_run
    lifecycle = _lifecycle()
    claim = lifecycle.claim("worker", 30)
    assert claim.job is not None
    with psycopg.connect(_DATABASE_URL) as connection:
        connection.execute(
            "update assistant_runs set status='error',error='external timeout',"
            "leased_by=null,lease_expires_at=null where id=%s",
            (run_id,),
        )
    assert lifecycle.heartbeat(claim.job.token, 30) is Outcome.STALE
    assert lifecycle.succeed(
        claim.job.token,
        AssistantSuccess({"kind": "answer", "text": "late", "citations": []}),
    ) is Outcome.STALE
    assert lifecycle.fail(claim.job.token, AssistantFailure("late", False)) is Outcome.STALE
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute("select status,error from assistant_runs where id=%s", (run_id,))
            assert cursor.fetchone() == ("error", "external timeout")


def test_expired_attempt_exhaustion_is_terminal(
    assistant_run: tuple[str, str, str, str],
) -> None:
    assert _DATABASE_URL is not None
    *_, run_id = assistant_run
    lifecycle = _lifecycle(max_attempts=1)
    claim = lifecycle.claim("one", 30)
    assert claim.job is not None
    with psycopg.connect(_DATABASE_URL) as connection:
        connection.execute(
            "update assistant_runs set lease_expires_at=clock_timestamp()-interval '1 second' "
            "where id=%s",
            (run_id,),
        )
    assert lifecycle.reclaim_expired("two", 30).outcome is Outcome.EXHAUSTED
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "select status,attempts,error from assistant_runs where id=%s",
                (run_id,),
            )
            assert cursor.fetchone() == ("error", 1, "assistant attempts exhausted")
