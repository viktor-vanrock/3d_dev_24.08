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

from mesh.conversion_queue import (
    MeshAssetPublication,
    MeshConversionFailure,
    MeshConversionRepository,
    MeshConversionSuccess,
    PromotionOutcome,
    PsycopgTransactionManager,
    promote_next_uploaded_revision,
)

_DATABASE_URL = os.getenv("PORTAL_QUEUE_TEST_DATABASE_URL")


def _lifecycle(
    *, max_attempts: int = 3, metrics: InMemoryMetricsSink | None = None
) -> QueueLifecycle:
    assert _DATABASE_URL is not None
    return QueueLifecycle(
        queue="mesh-conversion",
        transactions=PsycopgTransactionManager(_DATABASE_URL),
        repository=MeshConversionRepository(max_attempts=max_attempts),
        metrics=metrics,
    )


@pytest.fixture
def revision_event() -> tuple[str, str, str, str, str]:
    if _DATABASE_URL is None:
        pytest.skip("PORTAL_QUEUE_TEST_DATABASE_URL is not configured")
    target = require_disposable_postgres_url(_DATABASE_URL)
    owner_id, project_id, model_id, revision_id, event_id = (str(uuid4()) for _ in range(5))
    blob_id = str(uuid4())
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute("select current_database()")
            require_expected_database(
                expected=target.database_name,
                actual=str(cursor.fetchone()[0]),
            )
            cursor.execute("set constraints all deferred")
            cursor.execute(
                "insert into users (id, username) values (%s, %s)",
                (owner_id, f"mesh-queue-{owner_id}"),
            )
            cursor.execute(
                "insert into projects (id, owner_id, title) values (%s, %s, 'Mesh queue')",
                (project_id, owner_id),
            )
            cursor.execute(
                """
                insert into models (id, project_id, name, position, latest_revision_id)
                values (%s, %s, 'Mesh queue model', 0, %s)
                """,
                (model_id, project_id, revision_id),
            )
            cursor.execute(
                """
                insert into model_revisions
                  (id, model_id, source_format, status, source_checksum, source_size_bytes)
                values (%s, %s, 'stl', 'uploaded', decode(repeat('11', 32), 'hex'), 128)
                """,
                (revision_id, model_id),
            )
            cursor.execute(
                """
                insert into storage_blobs
                  (id, owner_id, checksum, size_bytes, s3_key, state)
                values (%s, %s, decode(repeat('11', 32), 'hex'), 128, %s, 'ready')
                """,
                (
                    blob_id,
                    owner_id,
                    f"protected/models/{model_id}/revisions/{revision_id}/source.stl",
                ),
            )
            cursor.execute(
                """
                insert into model_revision_files
                  (model_revision_id, role, size_bytes, checksum, original_filename,
                   mime_type, blob_id, is_source)
                values (%s, 'source', 128, decode(repeat('11', 32), 'hex'),
                        'source.stl', 'model/stl', %s, true)
                """,
                (revision_id, blob_id),
            )
            cursor.execute(
                """
                insert into outbox_events
                  (id, aggregate_type, aggregate_id, event_type, event_version, payload)
                values (%s, 'ModelRevision', %s, 'model.revision.uploaded.v1', 1,
                        jsonb_build_object(
                          'project_id', %s::uuid, 'model_id', %s::uuid, 'revision_id', %s::uuid
                        ))
                """,
                (event_id, revision_id, project_id, model_id, revision_id),
            )
    try:
        yield owner_id, project_id, model_id, revision_id, event_id
    finally:
        with psycopg.connect(_DATABASE_URL) as connection:
            with connection.cursor() as cursor:
                cursor.execute("set constraints all deferred")
                cursor.execute(
                    "delete from outbox_events where payload->>'model_id' = %s",
                    (model_id,),
                )
                cursor.execute("delete from model_revisions where model_id = %s", (model_id,))
                cursor.execute("delete from models where id = %s", (model_id,))
                cursor.execute("delete from projects where id = %s", (project_id,))
                cursor.execute("delete from storage_blobs where owner_id = %s", (owner_id,))
                cursor.execute("delete from users where id = %s", (owner_id,))


def test_promotes_uploaded_revision_without_lifecycle_attempt(
    revision_event: tuple[str, str, str, str, str],
) -> None:
    assert _DATABASE_URL is not None
    *_, revision_id, event_id = revision_event
    with psycopg.connect(_DATABASE_URL) as connection:
        result = promote_next_uploaded_revision(connection)
    assert result.outcome is PromotionOutcome.PROMOTED
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "select status, attempts, lease_generation from model_revisions where id = %s",
                (revision_id,),
            )
            assert cursor.fetchone() == ("pending", 0, 0)
            cursor.execute(
                "select completed_at is not null, last_error_safe from outbox_events where id = %s",
                (event_id,),
            )
            assert cursor.fetchone() == (True, None)


def test_crash_rolls_back_revision_and_event_then_replays(
    revision_event: tuple[str, str, str, str, str],
) -> None:
    assert _DATABASE_URL is not None
    *_, revision_id, event_id = revision_event
    trigger_name = f"fail_outbox_{uuid4().hex}"
    function_name = f"fail_outbox_{uuid4().hex}"
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                sql.SQL(
                    """
                    create function {}() returns trigger language plpgsql as $$
                    begin
                      if new.id = {}::uuid and new.completed_at is not null then
                        raise exception 'simulated promotion crash';
                      end if;
                      return new;
                    end
                    $$
                    """
                ).format(sql.Identifier(function_name), sql.Literal(event_id))
            )
            cursor.execute(
                sql.SQL(
                    "create trigger {} before update on outbox_events "
                    "for each row execute function {}()"
                ).format(sql.Identifier(trigger_name), sql.Identifier(function_name))
            )
    try:
        with psycopg.connect(_DATABASE_URL) as connection:
            with pytest.raises(psycopg.errors.RaiseException, match="simulated promotion crash"):
                promote_next_uploaded_revision(connection)
        with psycopg.connect(_DATABASE_URL) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "select status, attempts from model_revisions where id = %s",
                    (revision_id,),
                )
                assert cursor.fetchone() == ("uploaded", 0)
                cursor.execute("select completed_at from outbox_events where id = %s", (event_id,))
                assert cursor.fetchone() == (None,)
    finally:
        with psycopg.connect(_DATABASE_URL) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    sql.SQL("drop trigger {} on outbox_events").format(
                        sql.Identifier(trigger_name)
                    )
                )
                cursor.execute(sql.SQL("drop function {}()").format(sql.Identifier(function_name)))

    with psycopg.connect(_DATABASE_URL) as connection:
        assert promote_next_uploaded_revision(connection).outcome is PromotionOutcome.PROMOTED


def test_invalid_version_is_completed_without_promoting_revision(
    revision_event: tuple[str, str, str, str, str],
) -> None:
    assert _DATABASE_URL is not None
    *_, revision_id, event_id = revision_event
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute("update outbox_events set event_version = 2 where id = %s", (event_id,))
    with psycopg.connect(_DATABASE_URL) as connection:
        result = promote_next_uploaded_revision(connection)
    assert result.outcome is PromotionOutcome.INVALID
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "select status, attempts from model_revisions where id = %s",
                (revision_id,),
            )
            assert cursor.fetchone() == ("uploaded", 0)
            cursor.execute(
                "select completed_at is not null, last_error_safe from outbox_events where id = %s",
                (event_id,),
            )
            assert cursor.fetchone() == (True, "invalid_model_revision_uploaded_event")


def test_mesh_adapter_claims_pending_revision_with_revision_source(
    revision_event: tuple[str, str, str, str, str],
) -> None:
    assert _DATABASE_URL is not None
    owner_id, _, model_id, revision_id, _ = revision_event
    with psycopg.connect(_DATABASE_URL) as connection:
        assert promote_next_uploaded_revision(connection).outcome is PromotionOutcome.PROMOTED
    lifecycle = QueueLifecycle(
        queue="mesh-conversion",
        transactions=PsycopgTransactionManager(_DATABASE_URL),
        repository=MeshConversionRepository(max_attempts=3),
    )

    acquisition = lifecycle.claim("mesh-worker-1", 30)

    assert acquisition.outcome is Outcome.APPLIED
    assert acquisition.job is not None
    assert acquisition.job.token.job_id == revision_id
    assert acquisition.job.token.lease_generation == 1
    assert acquisition.job.attempts == 1
    assert acquisition.job.payload.model_id == model_id
    assert acquisition.job.payload.owner_id == owner_id
    assert acquisition.job.payload.source_format == "stl"
    assert acquisition.job.payload.source_s3_key == (
        f"protected/models/{model_id}/revisions/{revision_id}/source.stl"
    )
    assert lifecycle.claim("mesh-worker-2", 30).outcome is Outcome.EMPTY
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "select lease_expires_at from model_revisions where id = %s",
                (revision_id,),
            )
            first_deadline = cursor.fetchone()[0]
            cursor.execute("select pg_sleep(0.05)")
    assert lifecycle.heartbeat(acquisition.job.token, 30) is Outcome.APPLIED
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "select lease_expires_at from model_revisions where id = %s",
                (revision_id,),
            )
            assert cursor.fetchone()[0] > first_deadline


def test_two_revision_successes_publish_distinct_assets_and_latest_active_pointer(
    revision_event: tuple[str, str, str, str, str],
) -> None:
    assert _DATABASE_URL is not None
    owner_id, project_id, model_id, first_revision_id, _ = revision_event
    lifecycle = QueueLifecycle(
        queue="mesh-conversion",
        transactions=PsycopgTransactionManager(_DATABASE_URL),
        repository=MeshConversionRepository(max_attempts=3),
    )
    with psycopg.connect(_DATABASE_URL) as connection:
        assert promote_next_uploaded_revision(connection).outcome is PromotionOutcome.PROMOTED
    first = lifecycle.claim("mesh-worker-1", 30)
    assert first.job is not None
    first_key = (
        f"protected/models/{model_id}/revisions/{first_revision_id}/canonical_3mf.3mf"
    )
    first_preview_key = (
        f"public/models/{model_id}/revisions/{first_revision_id}/preview.glb"
    )
    assert (
        lifecycle.succeed(
            first.job.token,
            MeshConversionSuccess(
                bbox={"size": [1, 2, 3], "unit": "mm"},
                assets=(
                    MeshAssetPublication(
                        role="canonical_3mf",
                        s3_key=first_key,
                        size_bytes=11,
                        checksum=b"\x21" * 32,
                        mime_type="model/3mf",
                    ),
                    MeshAssetPublication(
                        role="preview",
                        s3_key=first_preview_key,
                        size_bytes=13,
                        checksum=b"\x41" * 32,
                        mime_type="model/gltf-binary",
                    ),
                ),
            ),
        )
        is Outcome.APPLIED
    )

    second_revision_id = str(uuid4())
    second_event_id = str(uuid4())
    second_blob_id = str(uuid4())
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute("set constraints all deferred")
            cursor.execute(
                """
                insert into model_revisions
                  (id, model_id, source_format, status, source_checksum, source_size_bytes)
                values (%s, %s, 'stl', 'uploaded', decode(repeat('22', 32), 'hex'), 256)
                """,
                (second_revision_id, model_id),
            )
            cursor.execute(
                "update models set latest_revision_id = %s where id = %s",
                (second_revision_id, model_id),
            )
            cursor.execute(
                """
                insert into storage_blobs
                  (id, owner_id, checksum, size_bytes, s3_key, state)
                values (%s, %s, decode(repeat('22', 32), 'hex'), 256, %s, 'ready')
                """,
                (
                    second_blob_id,
                    owner_id,
                    f"protected/models/{model_id}/revisions/{second_revision_id}/source.stl",
                ),
            )
            cursor.execute(
                """
                insert into model_revision_files
                  (model_revision_id, role, size_bytes, checksum, original_filename,
                   mime_type, blob_id, is_source)
                values (%s, 'source', 256, decode(repeat('22', 32), 'hex'),
                        'source.stl', 'model/stl', %s, true)
                """,
                (second_revision_id, second_blob_id),
            )
            cursor.execute(
                """
                insert into outbox_events
                  (id, aggregate_type, aggregate_id, event_type, event_version, payload)
                values (%s, 'ModelRevision', %s, 'model.revision.uploaded.v1', 1,
                        jsonb_build_object(
                          'project_id', %s::uuid, 'model_id', %s::uuid,
                          'revision_id', %s::uuid
                        ))
                """,
                (
                    second_event_id,
                    second_revision_id,
                    project_id,
                    model_id,
                    second_revision_id,
                ),
            )
    with psycopg.connect(_DATABASE_URL) as connection:
        assert promote_next_uploaded_revision(connection).outcome is PromotionOutcome.PROMOTED
    second = lifecycle.claim("mesh-worker-2", 30)
    assert second.job is not None
    second_key = (
        f"protected/models/{model_id}/revisions/{second_revision_id}/canonical_3mf.3mf"
    )
    second_preview_key = (
        f"public/models/{model_id}/revisions/{second_revision_id}/preview.glb"
    )
    assert (
        lifecycle.succeed(
            second.job.token,
            MeshConversionSuccess(
                bbox={"size": [4, 5, 6], "unit": "mm"},
                assets=(
                    MeshAssetPublication(
                        role="canonical_3mf",
                        s3_key=second_key,
                        size_bytes=12,
                        checksum=b"\x31" * 32,
                        mime_type="model/3mf",
                    ),
                    MeshAssetPublication(
                        role="preview",
                        s3_key=second_preview_key,
                        size_bytes=13,
                        checksum=b"\x41" * 32,
                        mime_type="model/gltf-binary",
                    ),
                ),
            ),
        )
        is Outcome.APPLIED
    )

    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                select files.model_revision_id::text, blobs.s3_key
                  from model_revision_files files
                  join storage_blobs blobs on blobs.id = files.blob_id
                 where files.model_revision_id = any(%s::uuid[])
                   and files.role = 'canonical_3mf'
                 order by files.model_revision_id
                """,
                ([first_revision_id, second_revision_id],),
            )
            assert set(cursor.fetchall()) == {
                (first_revision_id, first_key),
                (second_revision_id, second_key),
            }
            cursor.execute(
                """
                select files.model_revision_id::text, blobs.s3_key
                  from model_revision_files files
                  join storage_blobs blobs on blobs.id = files.blob_id
                 where files.model_revision_id = any(%s::uuid[])
                   and files.role = 'preview'
                 order by files.model_revision_id
                """,
                ([first_revision_id, second_revision_id],),
            )
            assert set(cursor.fetchall()) == {
                (first_revision_id, first_preview_key),
                (second_revision_id, first_preview_key),
            }
            assert second_preview_key != first_preview_key
            cursor.execute("select active_revision_id::text from models where id = %s", (model_id,))
            assert cursor.fetchone() == (second_revision_id,)


def test_mesh_failure_policy_requeues_retryable_and_fences_stale_attempt(
    revision_event: tuple[str, str, str, str, str],
) -> None:
    assert _DATABASE_URL is not None
    *_, revision_id, _ = revision_event
    with psycopg.connect(_DATABASE_URL) as connection:
        assert promote_next_uploaded_revision(connection).outcome is PromotionOutcome.PROMOTED
    lifecycle = QueueLifecycle(
        queue="mesh-conversion",
        transactions=PsycopgTransactionManager(_DATABASE_URL),
        repository=MeshConversionRepository(max_attempts=3),
    )
    first = lifecycle.claim("mesh-worker-1", 30)
    assert first.job is not None
    assert (
        lifecycle.fail(
            first.job.token,
            MeshConversionFailure("temporary_s3", "temporary storage error", True),
        )
        is Outcome.APPLIED
    )
    second = lifecycle.claim("mesh-worker-2", 30)
    assert second.job is not None
    assert second.job.attempts == 2
    assert second.job.token.lease_generation == 2
    assert (
        lifecycle.fail(
            first.job.token,
            MeshConversionFailure("late", "stale failure", False),
        )
        is Outcome.STALE
    )
    assert (
        lifecycle.fail(
            second.job.token,
            MeshConversionFailure("invalid_mesh", "invalid geometry", False),
        )
        is Outcome.APPLIED
    )
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                select status, attempts, lease_generation, leased_by, lease_expires_at,
                       failure_code, failure_detail_safe, failed_at is not null
                  from model_revisions where id = %s
                """,
                (revision_id,),
            )
            assert cursor.fetchone() == (
                "failed",
                2,
                2,
                None,
                None,
                "invalid_mesh",
                "invalid geometry",
                True,
            )


def test_mesh_adapter_concurrent_claim_is_exclusive_and_emits_metrics(
    revision_event: tuple[str, str, str, str, str],
) -> None:
    assert _DATABASE_URL is not None
    *_, revision_id, _ = revision_event
    with psycopg.connect(_DATABASE_URL) as connection:
        assert promote_next_uploaded_revision(connection).outcome is PromotionOutcome.PROMOTED

    def claim(owner_id: str):
        return _lifecycle().claim(owner_id, 30)

    with ThreadPoolExecutor(max_workers=2) as executor:
        acquisitions = tuple(executor.map(claim, ("mesh-worker-1", "mesh-worker-2")))
    assert sum(item.outcome is Outcome.APPLIED for item in acquisitions) == 1
    assert sum(item.outcome is Outcome.EMPTY for item in acquisitions) == 1

    sink = InMemoryMetricsSink()
    snapshot = _lifecycle(metrics=sink).collect_metrics()
    assert snapshot.waiting_depth == 0
    assert snapshot.expired_leases == 0
    assert {sample.name for sample in sink.gauges()} == {
        "portal_queue_depth",
        "portal_queue_expired_leases",
        "portal_queue_oldest_age_seconds",
    }
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "select attempts, lease_generation from model_revisions where id = %s",
                (revision_id,),
            )
            assert cursor.fetchone() == (1, 1)


def test_mesh_expiry_reclaim_rejects_all_stale_token_writes(
    revision_event: tuple[str, str, str, str, str],
) -> None:
    assert _DATABASE_URL is not None
    *_, revision_id, _ = revision_event
    with psycopg.connect(_DATABASE_URL) as connection:
        assert promote_next_uploaded_revision(connection).outcome is PromotionOutcome.PROMOTED
    lifecycle = _lifecycle()
    first = lifecycle.claim("mesh-worker-1", 30)
    assert first.job is not None
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                update model_revisions
                   set lease_expires_at = clock_timestamp() - interval '1 second'
                 where id = %s
                """,
                (revision_id,),
            )
    reclaimed = lifecycle.reclaim_expired("mesh-worker-2", 30)
    assert reclaimed.job is not None
    assert reclaimed.job.attempts == 2
    assert reclaimed.job.token.lease_generation == 2
    stale_owner = ClaimToken(revision_id, "mesh-worker-3", 2)
    stale_generation = ClaimToken(revision_id, "mesh-worker-2", 1)
    failure = MeshConversionFailure("late", "late result", False)
    success = MeshConversionSuccess(bbox={}, assets=())
    for token in (first.job.token, stale_owner, stale_generation):
        assert lifecycle.heartbeat(token, 30) is Outcome.STALE
        assert lifecycle.succeed(token, success) is Outcome.STALE
        assert lifecycle.fail(token, failure) is Outcome.STALE


def test_mesh_reclaim_exhaustion_does_not_increment_attempts(
    revision_event: tuple[str, str, str, str, str],
) -> None:
    assert _DATABASE_URL is not None
    *_, revision_id, _ = revision_event
    with psycopg.connect(_DATABASE_URL) as connection:
        assert promote_next_uploaded_revision(connection).outcome is PromotionOutcome.PROMOTED
    lifecycle = _lifecycle(max_attempts=1)
    claimed = lifecycle.claim("mesh-worker-1", 30)
    assert claimed.job is not None
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                update model_revisions
                   set lease_expires_at = clock_timestamp() - interval '1 second'
                 where id = %s
                """,
                (revision_id,),
            )
    assert lifecycle.reclaim_expired("mesh-worker-2", 30).outcome is Outcome.EXHAUSTED
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "select status, attempts, lease_generation from model_revisions where id = %s",
                (revision_id,),
            )
            assert cursor.fetchone() == ("failed", 1, 1)


def test_sigkill_then_reclaim_finishes_once_and_rejects_captured_token(
    revision_event: tuple[str, str, str, str, str],
) -> None:
    assert _DATABASE_URL is not None
    *_, revision_id, _ = revision_event
    with psycopg.connect(_DATABASE_URL) as connection:
        assert promote_next_uploaded_revision(connection).outcome is PromotionOutcome.PROMOTED
    child_code = """
import json
import os
from pathlib import Path
import time
from mesh.conversion_queue import MeshConversionRepository, PsycopgTransactionManager
from portal_queue_lifecycle import QueueLifecycle

url = os.environ["PORTAL_QUEUE_TEST_DATABASE_URL"]
lifecycle = QueueLifecycle(
    queue="mesh-conversion",
    transactions=PsycopgTransactionManager(url),
    repository=MeshConversionRepository(max_attempts=3),
)
job = lifecycle.claim("mesh-worker-crashed", 1).job
if job is None:
    raise RuntimeError("child failed to claim revision")
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
        with connection.cursor() as cursor:
            cursor.execute("select pg_sleep(1.05)")

    lifecycle = _lifecycle()
    reclaimed = lifecycle.reclaim_expired("mesh-worker-recovery", 30)
    assert reclaimed.job is not None
    assert reclaimed.job.attempts == 2
    assert reclaimed.job.token.lease_generation == 2
    success = MeshConversionSuccess(bbox={"size": [1, 1, 1], "unit": "mm"}, assets=())
    assert lifecycle.succeed(reclaimed.job.token, success) is Outcome.APPLIED
    stale = ClaimToken(
        str(captured["job_id"]),
        str(captured["owner_id"]),
        int(captured["lease_generation"]),
    )
    assert lifecycle.heartbeat(stale, 30) is Outcome.STALE
    assert lifecycle.succeed(stale, success) is Outcome.STALE
    assert (
        lifecycle.fail(
            stale,
            MeshConversionFailure("late", "late crash result", False),
        )
        is Outcome.STALE
    )
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "select status, attempts, lease_generation from model_revisions where id = %s",
                (revision_id,),
            )
            assert cursor.fetchone() == ("ready", 2, 2)
