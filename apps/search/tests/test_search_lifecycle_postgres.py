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

from portal_search.content import PostgresModelContentProvider
from portal_search.index_lease import PostgresEmbeddingWriter
from portal_search.lifecycle import (
    PsycopgTransactionManager,
    SearchFailure,
    SearchRepository,
    SearchSuccess,
)

_DATABASE_URL = os.getenv("PORTAL_QUEUE_TEST_DATABASE_URL")


def _lifecycle(
    *, max_attempts: int = 3, metrics: InMemoryMetricsSink | None = None
) -> QueueLifecycle:
    assert _DATABASE_URL is not None
    return QueueLifecycle(
        queue="search-index",
        transactions=PsycopgTransactionManager(_DATABASE_URL),
        repository=SearchRepository(max_attempts=max_attempts),
        metrics=metrics,
    )


@pytest.fixture
def search_job() -> tuple[str, str]:
    if _DATABASE_URL is None:
        pytest.skip("PORTAL_QUEUE_TEST_DATABASE_URL is not configured")
    target = require_disposable_postgres_url(_DATABASE_URL)
    user_id = str(uuid4())
    project_id = str(uuid4())
    job_id = str(uuid4())
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute("select current_database()")
            require_expected_database(
                expected=target.database_name,
                actual=str(cursor.fetchone()[0]),
            )
            cursor.execute(
                "insert into users (id, username) values (%s, %s)",
                (user_id, f"search-queue-{user_id}"),
            )
            cursor.execute(
                "insert into projects (id, owner_id, title) values (%s, %s, 'Search queue')",
                (project_id, user_id),
            )
            cursor.execute(
                """
                insert into search_index_jobs
                  (id, model_id, embedding_model, embedding_version, dim,
                   text_sha256, generation)
                values (%s, %s, 'hyperpc/test-embedding', 'v1', 1024,
                        decode(repeat('11', 32), 'hex'), 7)
                """,
                (job_id, project_id),
            )
    try:
        yield project_id, job_id
    finally:
        with psycopg.connect(_DATABASE_URL) as connection:
            with connection.cursor() as cursor:
                cursor.execute("delete from model_embeddings where model_id = %s", (project_id,))
                cursor.execute("delete from search_index_jobs where model_id = %s", (project_id,))
                cursor.execute("delete from projects where id = %s", (project_id,))
                cursor.execute("delete from users where id = %s", (user_id,))


def _expire(job_id: str) -> None:
    assert _DATABASE_URL is not None
    with psycopg.connect(_DATABASE_URL) as connection:
        connection.execute(
            "update search_index_jobs set leased_until=clock_timestamp()-interval '1 second' "
            "where id=%s",
            (job_id,),
        )


def _state(job_id: str) -> tuple[object, ...]:
    assert _DATABASE_URL is not None
    with psycopg.connect(_DATABASE_URL) as connection:
        row = connection.execute(
            """
            select status,generation,lease_generation,attempts,leased_by,leased_until,last_error
              from search_index_jobs where id=%s
            """,
            (job_id,),
        ).fetchone()
    assert row is not None
    return tuple(row)


def test_concurrent_claim_is_exclusive_and_preserves_content_generation(
    search_job: tuple[str, str],
) -> None:
    _, job_id = search_job
    metrics = InMemoryMetricsSink()
    lifecycle = _lifecycle(metrics=metrics)
    with ThreadPoolExecutor(max_workers=2) as executor:
        acquisitions = tuple(
            executor.map(lambda owner: lifecycle.claim(owner, 30), ("search-a", "search-b"))
        )

    applied = [item for item in acquisitions if item.outcome is Outcome.APPLIED]
    assert len(applied) == 1
    assert sum(item.outcome is Outcome.EMPTY for item in acquisitions) == 1
    assert applied[0].job is not None
    assert applied[0].job.payload.content_generation == 7
    assert applied[0].job.token.lease_generation == 1
    assert _state(job_id)[1:4] == (7, 1, 1)

    snapshot = lifecycle.collect_metrics()
    assert snapshot.waiting_depth == 0
    assert snapshot.expired_leases == 0
    labels = {sample.labels for sample in metrics.counters()}
    assert (("operation", "claim"), ("outcome", "applied"), ("queue", "search-index")) in labels
    assert all(
        "job" not in dict(label_set) and "owner" not in dict(label_set)
        for label_set in labels
    )


def test_explicit_reclaim_fences_stale_owner_and_generation(
    search_job: tuple[str, str],
) -> None:
    _, job_id = search_job
    lifecycle = _lifecycle()
    first = lifecycle.claim("search-old", 30)
    assert first.job is not None
    _expire(job_id)

    reclaimed = lifecycle.reclaim_expired("search-new", 30)

    assert reclaimed.outcome is Outcome.APPLIED
    assert reclaimed.job is not None
    assert reclaimed.job.payload.content_generation == 7
    assert reclaimed.job.token.lease_generation == 2
    assert reclaimed.job.attempts == 2
    assert lifecycle.succeed(first.job.token, SearchSuccess(7)) is Outcome.STALE
    assert (
        lifecycle.fail(first.job.token, SearchFailure("late", content_generation=7))
        is Outcome.STALE
    )
    assert lifecycle.succeed(reclaimed.job.token, SearchSuccess(7)) is Outcome.APPLIED
    assert _state(job_id)[:4] == ("done", 7, 2, 2)


def test_sigkill_then_reclaim_fences_captured_search_worker(
    search_job: tuple[str, str],
) -> None:
    _, job_id = search_job
    assert _DATABASE_URL is not None
    child_code = """
import json
import os
from pathlib import Path
import time

from portal_queue_lifecycle import QueueLifecycle
from portal_search.lifecycle import PsycopgTransactionManager, SearchRepository

url = os.environ["PORTAL_QUEUE_TEST_DATABASE_URL"]
lifecycle = QueueLifecycle(
    queue="search-index",
    transactions=PsycopgTransactionManager(url),
    repository=SearchRepository(max_attempts=3),
)
job = lifecycle.claim("search-worker-crashed", 1).job
if job is None:
    raise RuntimeError("child failed to claim search job")
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
    reclaimed = lifecycle.reclaim_expired("search-worker-recovery", 30)
    assert reclaimed.job is not None
    assert reclaimed.job.attempts == 2
    result = SearchSuccess(content_generation=7)
    assert lifecycle.succeed(reclaimed.job.token, result) is Outcome.APPLIED
    stale = ClaimToken(
        str(captured["job_id"]),
        str(captured["owner_id"]),
        int(captured["lease_generation"]),
    )
    assert lifecycle.heartbeat(stale, 30) is Outcome.STALE
    assert lifecycle.succeed(stale, result) is Outcome.STALE
    assert (
        lifecycle.fail(stale, SearchFailure("late", content_generation=7, retryable=False))
        is Outcome.STALE
    )
    assert _state(job_id)[:4] == ("done", 7, 2, 2)


def test_reclaim_exhaustion_does_not_mutate_content_generation(
    search_job: tuple[str, str],
) -> None:
    _, job_id = search_job
    metrics = InMemoryMetricsSink()
    lifecycle = _lifecycle(max_attempts=2, metrics=metrics)
    first = lifecycle.claim("search-1", 30)
    assert first.job is not None
    _expire(job_id)
    second = lifecycle.reclaim_expired("search-2", 30)
    assert second.job is not None
    _expire(job_id)

    exhausted = lifecycle.reclaim_expired("search-3", 30)

    assert exhausted.outcome is Outcome.EXHAUSTED
    assert _state(job_id) == (
        "failed",
        7,
        2,
        2,
        None,
        None,
        "index attempts exhausted",
    )
    assert any(
        sample.name == "portal_queue_reclaim_total"
        and dict(sample.labels) == {"outcome": "exhausted", "queue": "search-index"}
        for sample in metrics.counters()
    )


def test_reenqueue_during_processing_advances_only_content_generation_explicitly(
    search_job: tuple[str, str],
) -> None:
    _, job_id = search_job
    lifecycle = _lifecycle()
    old = lifecycle.claim("search-old", 30)
    assert old.job is not None
    assert _DATABASE_URL is not None
    with psycopg.connect(_DATABASE_URL) as connection:
        connection.execute(
            """
            update search_index_jobs
               set status='queued',generation=8,text_sha256=decode(repeat('22',32),'hex'),
                   leased_by=null,leased_until=null,updated_at=clock_timestamp()
             where id=%s
            """,
            (job_id,),
        )

    fresh = lifecycle.claim("search-fresh", 30)

    assert fresh.job is not None
    assert fresh.job.payload.content_generation == 8
    assert fresh.job.token.lease_generation == 2
    assert lifecycle.succeed(old.job.token, SearchSuccess(7)) is Outcome.STALE
    assert (
        lifecycle.fail(old.job.token, SearchFailure("stale", content_generation=7))
        is Outcome.STALE
    )
    assert lifecycle.succeed(fresh.job.token, SearchSuccess(8)) is Outcome.APPLIED
    assert _state(job_id)[:4] == ("done", 8, 2, 2)


def test_embedding_writer_rejects_same_or_older_content_generation(
    search_job: tuple[str, str],
) -> None:
    project_id, _ = search_job
    assert _DATABASE_URL is not None
    vector = [0.0] * 1024
    with psycopg.connect(_DATABASE_URL) as connection:
        writer = PostgresEmbeddingWriter(connection)
        assert writer.write(
            model_id=project_id,
            embedding_model="hyperpc/test-embedding",
            embedding_version="v1",
            dim=1024,
            embedding=vector,
            text_sha256=b"generation-7",
            source_generation=7,
        )
        assert not writer.write(
            model_id=project_id,
            embedding_model="hyperpc/test-embedding",
            embedding_version="v1",
            dim=1024,
            embedding=vector,
            text_sha256=b"same-generation",
            source_generation=7,
        )
        assert not writer.write(
            model_id=project_id,
            embedding_model="hyperpc/test-embedding",
            embedding_version="v1",
            dim=1024,
            embedding=vector,
            text_sha256=b"older-generation",
            source_generation=6,
        )
        assert writer.write(
            model_id=project_id,
            embedding_model="hyperpc/test-embedding",
            embedding_version="v1",
            dim=1024,
            embedding=vector,
            text_sha256=b"generation-8",
            source_generation=8,
        )
    with psycopg.connect(_DATABASE_URL) as connection:
        assert connection.execute(
            """
            select source_generation,text_sha256 from model_embeddings
             where model_id=%s and embedding_model='hyperpc/test-embedding'
               and embedding_version='v1'
            """,
            (project_id,),
        ).fetchone() == (8, b"generation-8")


def test_content_reader_uses_published_revision_snapshot_and_blob(
    search_job: tuple[str, str],
) -> None:
    project_id, _ = search_job
    assert _DATABASE_URL is not None
    model_id, revision_id, publication_id, blob_id = (str(uuid4()) for _ in range(4))
    key = f"protected/models/{model_id}/revisions/{revision_id}/canonical_3mf.3mf"
    with psycopg.connect(_DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute("set constraints all deferred")
            owner_id = str(
                cursor.execute(
                    "select owner_id from projects where id=%s", (project_id,)
                ).fetchone()[0]
            )
            cursor.execute(
                """
                insert into models
                  (id,project_id,name,position,latest_revision_id,active_revision_id)
                values (%s,%s,'Primary',0,%s,%s)
                """,
                (model_id, project_id, revision_id, revision_id),
            )
            cursor.execute(
                """
                insert into model_revisions
                  (id,model_id,source_format,status,source_checksum,source_size_bytes,ready_at)
                values (%s,%s,'3mf','ready',decode(repeat('33',32),'hex'),128,now())
                """,
                (revision_id, model_id),
            )
            cursor.execute(
                """
                insert into storage_blobs
                  (id,owner_id,checksum,size_bytes,s3_key,state)
                values (%s,%s,decode(repeat('44',32),'hex'),128,%s,'ready')
                """,
                (blob_id, owner_id, key),
            )
            cursor.execute(
                """
                insert into model_revision_files
                  (model_revision_id,role,size_bytes,checksum,original_filename,
                   mime_type,blob_id,is_source)
                values (%s,'canonical_3mf',128,decode(repeat('44',32),'hex'),
                        'canonical.3mf','model/3mf',%s,false)
                """,
                (revision_id, blob_id),
            )
            cursor.execute(
                """
                insert into project_revisions
                  (id,project_id,content_hash,primary_model_id,metadata_snapshot)
                values (%s,%s,decode(repeat('55',32),'hex'),%s,%s::jsonb)
                """,
                (
                    publication_id,
                    project_id,
                    model_id,
                    '{"title":"Published dragon","description":"Printable",'
                    '"tags":["fantasy","dragon"]}',
                ),
            )
            cursor.execute(
                """
                insert into project_revision_models
                  (project_revision_id,project_id,model_id,model_revision_id,position)
                values (%s,%s,%s,%s,0)
                """,
                (publication_id, project_id, model_id, revision_id),
            )
            cursor.execute(
                "update projects set primary_model_id=%s,published_revision_id=%s where id=%s",
                (model_id, publication_id, project_id),
            )

    class FakeS3:
        def download_fileobj(self, bucket: str, object_key: str, fileobj) -> None:
            assert (bucket, object_key) == ("3mf", key)
            fileobj.write(b"published-3mf")

    try:
        with psycopg.connect(_DATABASE_URL, autocommit=True) as connection:
            provider = PostgresModelContentProvider(connection, FakeS3(), "3mf")
            assert provider.get_text_document(project_id) == (
                "Published dragon\n\nPrintable\n\ndragon, fantasy"
            )
            geometry = provider.get_geometry(project_id)
            assert geometry is not None
            assert geometry.data == b"published-3mf"
            assert geometry.file_hint == "3mf"
    finally:
        with psycopg.connect(_DATABASE_URL) as connection:
            with connection.cursor() as cursor:
                cursor.execute("set constraints all deferred")
                cursor.execute(
                    "update projects set primary_model_id=null,published_revision_id=null "
                    "where id=%s",
                    (project_id,),
                )
                cursor.execute(
                    "delete from project_revision_models where project_revision_id=%s",
                    (publication_id,),
                )
                cursor.execute("delete from project_revisions where id=%s", (publication_id,))
                cursor.execute(
                    "delete from model_revision_files where model_revision_id=%s",
                    (revision_id,),
                )
                cursor.execute("delete from model_revisions where id=%s", (revision_id,))
                cursor.execute("delete from models where id=%s", (model_id,))
                cursor.execute("delete from storage_blobs where id=%s", (blob_id,))
