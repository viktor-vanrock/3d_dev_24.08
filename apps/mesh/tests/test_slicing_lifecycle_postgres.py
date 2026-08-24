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
from psycopg import sql

from mesh.slice_trust import SignedSliceTrust
from mesh.slicing_lifecycle import (
    PsycopgTransactionManager,
    SliceJobFailure,
    SliceJobRepository,
    SliceJobSuccess,
)

_DATABASE_URL = os.getenv("PORTAL_QUEUE_TEST_DATABASE_URL")


def _lifecycle(*, max_attempts: int = 3, metrics=None) -> QueueLifecycle:
    assert _DATABASE_URL is not None
    return QueueLifecycle(
        queue="mesh-slicing",
        transactions=PsycopgTransactionManager(_DATABASE_URL),
        repository=SliceJobRepository(max_attempts=max_attempts),
        metrics=metrics,
    )


@pytest.fixture
def slice_job() -> tuple[str, str, str, str]:
    if _DATABASE_URL is None:
        pytest.skip("PORTAL_QUEUE_TEST_DATABASE_URL is not configured")
    target = require_disposable_postgres_url(_DATABASE_URL)
    owner_id, project_id, model_id, revision_id, profile_id, job_id = (
        str(uuid4()) for _ in range(6)
    )
    slice_key = b"\x51" * 32
    trust = _trust_material(owner_id, profile_id, slice_key)
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute("select current_database()")
            require_expected_database(
                expected=target.database_name,
                actual=str(cursor.fetchone()[0]),
            )
            cursor.execute("set constraints all deferred")
            cursor.execute(
                "insert into users(id, username) values (%s, %s)",
                (owner_id, f"slice-queue-{owner_id}"),
            )
            cursor.execute(
                "insert into projects(id, owner_id, title) values (%s, %s, 'Slice queue')",
                (project_id, owner_id),
            )
            cursor.execute(
                """
                insert into models(id, project_id, name, position, latest_revision_id)
                values (%s, %s, 'Slice queue model', 0, %s)
                """,
                (model_id, project_id, revision_id),
            )
            cursor.execute(
                """
                insert into model_revisions
                  (id, model_id, source_format, source_checksum, source_size_bytes)
                values (%s, %s, '3mf', decode(repeat('11', 32), 'hex'), 128)
                """,
                (revision_id, model_id),
            )
            cursor.execute(
                """
                insert into slicer_profiles
                  (id, profile_class, slicer, name, source_name, license)
                values (%s, 'process', 'prusaslicer', 'Slice queue profile', 'test', 'test')
                """,
                (profile_id,),
            )
            cursor.execute(
                """
                insert into slice_jobs
                  (id, model_id, profile_id, requested_by, account_id, attempt_count,
                   slice_trust_contract_version, slice_trust_material)
                values (%s, %s, %s, %s, %s, 7, 'slice-trust.v1', %s)
                """,
                (job_id, model_id, profile_id, owner_id, owner_id, psycopg.types.json.Jsonb(trust)),
            )
    try:
        yield owner_id, model_id, profile_id, job_id
    finally:
        with psycopg.connect(_DATABASE_URL) as connection:
            with connection.cursor() as cursor:
                cursor.execute("set constraints all deferred")
                cursor.execute("delete from slice_cache_hits where account_id = %s", (owner_id,))
                cursor.execute("delete from slice_cache_entries where account_id = %s", (owner_id,))
                cursor.execute("delete from slice_job_attempts where slice_job_id = %s", (job_id,))
                cursor.execute("delete from slice_jobs where id = %s", (job_id,))
                cursor.execute("delete from model_revisions where id = %s", (revision_id,))
                cursor.execute("delete from models where id = %s", (model_id,))
                cursor.execute("delete from slicer_profiles where id = %s", (profile_id,))
                cursor.execute("delete from projects where id = %s", (project_id,))
                cursor.execute("delete from users where id = %s", (owner_id,))


def _trust_material(owner_id: str, profile_id: str, slice_key: bytes) -> dict[str, object]:
    fingerprint = "61" * 32
    return {
        "contract_version": "slice-trust.v1",
        "account_id": owner_id,
        "device_id": str(uuid4()),
        "profile_id": profile_id,
        "slice_key": slice_key.hex(),
        "fingerprint_source": "declared",
        "fingerprint_state": "stock",
        "fingerprint_algorithm_version": "config-fingerprint.v1",
        "config_fingerprint": fingerprint,
        "canonical_config_fingerprint": fingerprint,
        "cross_account_reuse": False,
        "global_dedup_eligible": False,
    }


def _success(owner_id: str, model_id: str, profile_id: str) -> SliceJobSuccess:
    slice_key = b"\x51" * 32
    return SliceJobSuccess(
        gcode_s3_key=f"protected/slices/{owner_id}/{slice_key.hex()}.gcode",
        size_bytes=42,
        slice_key=slice_key,
        metrics={"print_time_seconds": 12},
        signed_trust=SignedSliceTrust(
            _trust_material(owner_id, profile_id, slice_key),
            "test-key",
            "test-signature",
        ),
        preview_manifest_s3_key=None,
        requested_by=owner_id,
        model_id=model_id,
        cache_hit=False,
    )


def test_concurrent_claim_is_exclusive_and_preserves_domain_attempt(
    slice_job: tuple[str, str, str, str],
) -> None:
    assert _DATABASE_URL is not None
    *_, job_id = slice_job
    metrics = InMemoryMetricsSink()
    lifecycle = _lifecycle(metrics=metrics)
    with ThreadPoolExecutor(max_workers=2) as executor:
        claims = tuple(executor.map(lambda owner: lifecycle.claim(owner, 30), ("one", "two")))
    assert sum(claim.outcome is Outcome.APPLIED for claim in claims) == 1
    assert sum(claim.outcome is Outcome.EMPTY for claim in claims) == 1
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "select attempt_count, lifecycle_attempts, lease_generation "
                "from slice_jobs where id=%s",
                (job_id,),
            )
            assert cursor.fetchone() == (7, 1, 1)
    assert lifecycle.collect_metrics().waiting_depth == 0


def test_expired_reclaim_fences_old_worker_and_publishes_result_atomically(
    slice_job: tuple[str, str, str, str],
) -> None:
    assert _DATABASE_URL is not None
    owner_id, model_id, profile_id, job_id = slice_job
    lifecycle = _lifecycle()
    first = lifecycle.claim("slice-old", 30)
    assert first.job is not None
    with psycopg.connect(_DATABASE_URL) as connection:
        connection.execute(
            "update slice_jobs set lease_expires_at=clock_timestamp()-interval '1 second' "
            "where id=%s",
            (job_id,),
        )
    second = lifecycle.reclaim_expired("slice-new", 30)
    assert second.job is not None
    result = _success(owner_id, model_id, profile_id)
    assert lifecycle.succeed(second.job.token, result) is Outcome.APPLIED
    assert lifecycle.heartbeat(first.job.token, 30) is Outcome.STALE
    assert lifecycle.succeed(first.job.token, result) is Outcome.STALE
    assert lifecycle.fail(first.job.token, SliceJobFailure("late", "late", False)) is Outcome.STALE
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                select status, attempt_count, lifecycle_attempts, lease_generation,
                       leased_by, lease_expires_at, slice_trust_key_id
                  from slice_jobs where id=%s
                """,
                (job_id,),
            )
            assert cursor.fetchone() == ("ready", 7, 2, 2, None, None, "test-key")
            cursor.execute(
                "select count(*) from slice_cache_entries where account_id=%s",
                (owner_id,),
            )
            assert cursor.fetchone() == (1,)
            cursor.execute(
                "select count(*) from slice_cache_hits where account_id=%s",
                (owner_id,),
            )
            assert cursor.fetchone() == (1,)


def test_sigkill_then_reclaim_fences_captured_slice_worker(
    slice_job: tuple[str, str, str, str],
) -> None:
    assert _DATABASE_URL is not None
    owner_id, model_id, profile_id, job_id = slice_job
    child_code = """
import json
import os
from pathlib import Path
import time

from mesh.slicing_lifecycle import PsycopgTransactionManager, SliceJobRepository
from portal_queue_lifecycle import QueueLifecycle

url = os.environ["PORTAL_QUEUE_TEST_DATABASE_URL"]
lifecycle = QueueLifecycle(
    queue="mesh-slicing",
    transactions=PsycopgTransactionManager(url),
    repository=SliceJobRepository(max_attempts=3),
)
job = lifecycle.claim("slice-worker-crashed", 1).job
if job is None:
    raise RuntimeError("child failed to claim slice job")
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
    reclaimed = lifecycle.reclaim_expired("slice-worker-recovery", 30)
    assert reclaimed.job is not None
    assert reclaimed.job.attempts == 2
    assert reclaimed.job.token.lease_generation == 2
    result = _success(owner_id, model_id, profile_id)
    assert lifecycle.succeed(reclaimed.job.token, result) is Outcome.APPLIED
    stale = ClaimToken(
        str(captured["job_id"]),
        str(captured["owner_id"]),
        int(captured["lease_generation"]),
    )
    assert lifecycle.heartbeat(stale, 30) is Outcome.STALE
    assert lifecycle.succeed(stale, result) is Outcome.STALE
    assert lifecycle.fail(stale, SliceJobFailure("late", "late", False)) is Outcome.STALE
    with psycopg.connect(_DATABASE_URL) as connection:
        assert connection.execute(
            "select status,lifecycle_attempts,lease_generation from slice_jobs where id=%s",
            (job_id,),
        ).fetchone() == ("ready", 2, 2)


def test_retryable_failure_requeues_then_terminal_failure_preserves_domain_attempt(
    slice_job: tuple[str, str, str, str],
) -> None:
    assert _DATABASE_URL is not None
    *_, job_id = slice_job
    lifecycle = _lifecycle(max_attempts=2)
    first = lifecycle.claim("slice-one", 30)
    assert first.job is not None
    assert (
        lifecycle.fail(first.job.token, SliceJobFailure("temporary", None, True)) is Outcome.APPLIED
    )
    second = lifecycle.claim("slice-two", 30)
    assert second.job is not None
    assert second.job.attempts == 2
    assert (
        lifecycle.fail(second.job.token, SliceJobFailure("invalid", "INVALID", False))
        is Outcome.APPLIED
    )
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "select status, retryable, attempt_count, lifecycle_attempts "
                "from slice_jobs where id=%s",
                (job_id,),
            )
            assert cursor.fetchone() == ("failed", False, 7, 2)


def test_expired_attempt_exhaustion_is_terminal(slice_job: tuple[str, str, str, str]) -> None:
    assert _DATABASE_URL is not None
    *_, job_id = slice_job
    lifecycle = _lifecycle(max_attempts=1)
    claim = lifecycle.claim("slice-one", 30)
    assert claim.job is not None
    with psycopg.connect(_DATABASE_URL) as connection:
        connection.execute(
            "update slice_jobs set lease_expires_at=clock_timestamp()-interval '1 second' "
            "where id=%s",
            (job_id,),
        )
    assert lifecycle.reclaim_expired("slice-two", 30).outcome is Outcome.EXHAUSTED
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "select status, retryable, attempt_count, lifecycle_attempts, error_code "
                "from slice_jobs where id=%s",
                (job_id,),
            )
            assert cursor.fetchone() == ("failed", False, 7, 1, "attempts_exhausted")


def test_success_rolls_back_cache_and_result_on_terminal_write_error(
    slice_job: tuple[str, str, str, str],
) -> None:
    assert _DATABASE_URL is not None
    owner_id, model_id, profile_id, job_id = slice_job
    lifecycle = _lifecycle()
    claim = lifecycle.claim("slice-one", 30)
    assert claim.job is not None
    trigger = f"slice_fail_{uuid4().hex}"
    function = f"slice_fail_{uuid4().hex}"
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                sql.SQL(
                    """
                    create function {}() returns trigger language plpgsql as $$
                    begin
                      if new.id = {}::uuid and new.status = 'ready' then
                        raise exception 'simulated slice terminal crash';
                      end if;
                      return new;
                    end $$
                    """
                ).format(sql.Identifier(function), sql.Literal(job_id))
            )
            cursor.execute(
                sql.SQL(
                    "create trigger {} before update on slice_jobs "
                    "for each row execute function {}()"
                ).format(sql.Identifier(trigger), sql.Identifier(function))
            )
    try:
        with pytest.raises(psycopg.errors.RaiseException, match="simulated slice terminal crash"):
            lifecycle.succeed(claim.job.token, _success(owner_id, model_id, profile_id))
        with psycopg.connect(_DATABASE_URL) as connection:
            with connection.cursor() as cursor:
                cursor.execute("select status from slice_jobs where id=%s", (job_id,))
                assert cursor.fetchone() == ("processing",)
                cursor.execute(
                    "select count(*) from slice_cache_entries where account_id=%s",
                    (owner_id,),
                )
                assert cursor.fetchone() == (0,)
                cursor.execute(
                    "select count(*) from slice_cache_hits where account_id=%s",
                    (owner_id,),
                )
                assert cursor.fetchone() == (0,)
    finally:
        with psycopg.connect(_DATABASE_URL) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    sql.SQL("drop trigger {} on slice_jobs").format(sql.Identifier(trigger))
                )
                cursor.execute(sql.SQL("drop function {}()").format(sql.Identifier(function)))
