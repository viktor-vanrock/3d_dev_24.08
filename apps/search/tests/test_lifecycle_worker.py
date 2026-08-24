from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import Mock

from portal_queue_lifecycle import ClaimedJob, ClaimToken

from portal_search import lifecycle_worker
from portal_search.config import WorkerConfig
from portal_search.lifecycle import SearchPayload, SearchSuccess


def _config(*, enabled: bool) -> WorkerConfig:
    return WorkerConfig(
        database_url="postgresql://example.invalid/search_test",
        poll_interval_seconds=1,
        lease_seconds=30,
        worker_id="search-test",
        max_attempts=3,
        lifecycle_enabled=enabled,
        heartbeat_interval_seconds=10,
        shutdown_grace_seconds=5,
    )


def _job() -> ClaimedJob[SearchPayload]:
    return ClaimedJob(
        token=ClaimToken("00000000-0000-0000-0000-000000000001", "search-test", 1),
        payload=SearchPayload(
            job_id="00000000-0000-0000-0000-000000000001",
            model_id="00000000-0000-0000-0000-000000000002",
            embedding_model="hyperpc/test-embedding",
            embedding_version="v1",
            dim=1024,
            text_sha256=b"hash",
            content_generation=9,
        ),
        attempts=1,
        lease_expires_at=datetime.now(UTC),
    )


def test_disabled_lifecycle_waits_fail_closed_without_claiming(monkeypatch) -> None:
    wait = Mock()
    monkeypatch.setattr(lifecycle_worker, "load_worker_config", lambda: _config(enabled=False))
    monkeypatch.setattr(lifecycle_worker, "_wait_until_signal", wait)

    lifecycle_worker.run_loop()

    wait.assert_called_once_with()


def test_matching_index_hash_skips_provider_and_preserves_content_generation() -> None:
    job = _job()
    indexed_hashes = Mock()
    indexed_hashes.get_indexed_text_sha256.return_value = job.payload.text_sha256
    hyperpc = Mock()
    content = Mock()
    writer = Mock()

    result = lifecycle_worker.execute_index(
        job,
        hyperpc=hyperpc,
        content=content,
        indexed_hashes=indexed_hashes,
        writer=writer,
    )

    assert result == SearchSuccess(content_generation=9)
    hyperpc.assert_not_called()
    content.assert_not_called()
    writer.write.assert_not_called()


def test_failure_classification_carries_content_generation() -> None:
    failure = lifecycle_worker.classify_index_failure(RuntimeError("provider down"), _job())

    assert failure.error == "provider down"
    assert failure.content_generation == 9
    assert failure.retryable is True
