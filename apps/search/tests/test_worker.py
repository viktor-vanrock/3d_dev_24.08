from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime

import trimesh
from portal_queue_lifecycle import ClaimedJob, ClaimToken

from portal_search import lifecycle_worker, profiles
from portal_search.lifecycle import SearchPayload, SearchSuccess
from portal_search.worker import ModelGeometry


def _job() -> ClaimedJob[SearchPayload]:
    return ClaimedJob(
        token=ClaimToken("00000000-0000-0000-0000-000000000001", "search-test", 1),
        payload=SearchPayload(
            job_id="00000000-0000-0000-0000-000000000001",
            model_id="00000000-0000-0000-0000-000000000002",
            embedding_model=profiles.EMBEDDING_MODEL,
            embedding_version=profiles.EMBEDDING_VERSION,
            dim=profiles.HYPERPC_DIM,
            text_sha256=b"hash",
            content_generation=9,
        ),
        attempts=1,
        lease_expires_at=datetime.now(UTC),
    )


class FakeHyperpc:
    def __init__(self) -> None:
        self.calls: list[list[object]] = []

    def embed(self, items: list[object]) -> list[list[float]]:
        self.calls.append(items)
        return [[0.1, 0.2, 0.3] for _ in items]


class FakeContent:
    def __init__(
        self,
        *,
        text: str | None = "printable dragon",
        geometry: ModelGeometry | None = None,
    ) -> None:
        self.text = text
        self.geometry = geometry

    def get_text_document(self, _model_id: str) -> str | None:
        return self.text

    def get_geometry(self, _model_id: str) -> ModelGeometry | None:
        return self.geometry


class FakeHashes:
    def __init__(self, value: bytes | None = None) -> None:
        self.value = value

    def get_indexed_text_sha256(
        self, _model_id: str, _embedding_model: str, _embedding_version: str
    ) -> bytes | None:
        return self.value


class FakeWriter:
    def __init__(self, *, applied: bool = True) -> None:
        self.applied = applied
        self.writes: list[dict[str, object]] = []

    def write(self, **kwargs: object) -> bool:
        self.writes.append(kwargs)
        return self.applied


def test_text_profile_embeds_and_preserves_content_generation() -> None:
    hyperpc = FakeHyperpc()
    writer = FakeWriter()

    result = lifecycle_worker.execute_index(
        _job(),
        hyperpc=hyperpc,
        content=FakeContent(),
        indexed_hashes=FakeHashes(),
        writer=writer,
    )

    assert result == SearchSuccess(content_generation=9)
    assert hyperpc.calls == [["printable dragon"]]
    assert writer.writes[0]["source_generation"] == 9


def test_missing_text_succeeds_without_embedding_write() -> None:
    hyperpc = FakeHyperpc()
    writer = FakeWriter()

    result = lifecycle_worker.execute_index(
        _job(),
        hyperpc=hyperpc,
        content=FakeContent(text=None),
        indexed_hashes=FakeHashes(),
        writer=writer,
    )

    assert result == SearchSuccess(content_generation=9)
    assert hyperpc.calls == []
    assert writer.writes == []


def test_view_profile_renders_and_embeds() -> None:
    base_job = _job()
    job = replace(
        base_job,
        payload=replace(
            base_job.payload,
            embedding_model=profiles.view_embedding_model(0),
        ),
    )
    geometry = trimesh.creation.box().export(file_type="stl")
    hyperpc = FakeHyperpc()
    writer = FakeWriter()

    lifecycle_worker.execute_index(
        job,
        hyperpc=hyperpc,
        content=FakeContent(geometry=ModelGeometry(data=geometry, file_hint="stl")),
        indexed_hashes=FakeHashes(),
        writer=writer,
    )

    assert isinstance(hyperpc.calls[0][0], dict)
    assert "image" in hyperpc.calls[0][0]
    assert writer.writes[0]["embedding_model"] == profiles.view_embedding_model(0)


def test_domain_fence_rejection_is_not_a_queue_failure() -> None:
    result = lifecycle_worker.execute_index(
        _job(),
        hyperpc=FakeHyperpc(),
        content=FakeContent(),
        indexed_hashes=FakeHashes(),
        writer=FakeWriter(applied=False),
    )

    assert result == SearchSuccess(content_generation=9)
