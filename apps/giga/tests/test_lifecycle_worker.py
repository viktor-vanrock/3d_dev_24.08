from pathlib import Path

from portal_queue_lifecycle import ClaimedJob, ClaimToken

from giga.branches import GenerationError
from giga.generation_lifecycle import GenerationPayload
from giga.lifecycle_worker import classify_generation_failure, execute_generation


class _Store:
    def __init__(self) -> None:
        self.uploaded: list[tuple[str, bytes, str]] = []

    def upload_bytes(self, key: str, body: bytes, content_type: str) -> None:
        self.uploaded.append((key, body, content_type))


def test_giga_entrypoint_has_no_legacy_queue_fallback() -> None:
    root = Path(__file__).resolve().parents[1]
    pyproject = (root / "pyproject.toml").read_text(encoding="utf-8")
    source = (root / "src/giga/lifecycle_worker.py").read_text(encoding="utf-8")

    assert 'giga-worker = "giga.lifecycle_worker:run_loop"' in pyproject
    assert "QueueWorkerRunner(" in source
    assert "GenerationRepository(" in source
    assert "run_legacy_loop" not in source
    assert "_wait_disabled(" in source
    assert not (root / "src/giga/worker.py").exists()


def test_execute_generation_uploads_artifact_and_preview(monkeypatch) -> None:
    from datetime import UTC, datetime

    from giga.branches import GenerationResult

    def _execute(_job, report):
        report("running", 42, eta_seconds=30)
        return GenerationResult(
            artifact_bytes=b"artifact",
            artifact_ext="3mf",
            artifact_content_type="model/3mf",
            preview_bytes=b"preview",
            preview_ext="webp",
            preview_content_type="image/webp",
        )

    monkeypatch.setattr("giga.lifecycle_worker.get_executor", lambda _branch: _execute)
    monkeypatch.setattr(
        "giga.lifecycle_worker.GenerationProgressWriter.report",
        lambda *_a, **_k: None,
    )
    store = _Store()
    job = ClaimedJob(
        token=ClaimToken("gen-1", "owner-1", 1),
        payload=GenerationPayload("gen-1", "user-1", "openscad", "holder", {}),
        attempts=1,
        lease_expires_at=datetime.now(UTC),
    )

    result = execute_generation("postgres://unused", store, job)

    assert result.artifact_url == "generations/gen-1/artifact.3mf"
    assert result.preview_url == "generations/gen-1/preview.webp"
    assert [item[1] for item in store.uploaded] == [b"artifact", b"preview"]


def test_generation_failures_keep_existing_terminal_error_policy() -> None:
    failure = classify_generation_failure(
        GenerationError("provider unavailable"),
        None,  # type: ignore[arg-type]
    )

    assert failure.error == "provider unavailable"
    assert failure.retryable is False
