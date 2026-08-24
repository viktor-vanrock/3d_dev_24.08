from __future__ import annotations

from portal_search.index_lease import PostgresEmbeddingWriter, PostgresIndexRepository


class FakeConnection:
    def __init__(self) -> None:
        self.hash: bytes | None = None
        self.source_generation: int | None = None
        self.rowcount = 0

    def cursor(self) -> FakeConnection:
        return self

    def __enter__(self) -> FakeConnection:
        return self

    def __exit__(self, *_exc: object) -> None:
        return None

    def execute(self, sql: str, params: tuple[object, ...]) -> None:
        if "select text_sha256" in sql:
            return
        source_generation = int(params[-1])
        if self.source_generation is None or source_generation > self.source_generation:
            self.hash = bytes(params[-2])
            self.source_generation = source_generation
            self.rowcount = 1
        else:
            self.rowcount = 0

    def fetchone(self) -> tuple[bytes] | None:
        return None if self.hash is None else (self.hash,)

    def commit(self) -> None:
        return None


def _write(connection: FakeConnection, generation: int, text_hash: bytes) -> bool:
    return PostgresEmbeddingWriter(connection).write(
        model_id="model-1",
        embedding_model="hyperpc/test",
        embedding_version="v1",
        dim=1024,
        embedding=[0.1],
        text_sha256=text_hash,
        source_generation=generation,
    )


def test_indexed_hash_reader_returns_none_without_embedding() -> None:
    assert (
        PostgresIndexRepository(FakeConnection()).get_indexed_text_sha256(
            "model-1", "hyperpc/test", "v1"
        )
        is None
    )


def test_embedding_writer_and_hash_reader_share_domain_generation_fence() -> None:
    connection = FakeConnection()

    assert _write(connection, 2, b"fresh")
    assert not _write(connection, 1, b"stale")
    assert not _write(connection, 2, b"same")
    assert _write(connection, 3, b"newer")
    assert (
        PostgresIndexRepository(connection).get_indexed_text_sha256(
            "model-1", "hyperpc/test", "v1"
        )
        == b"newer"
    )


def test_embedding_writer_rejects_unknown_dimension() -> None:
    connection = FakeConnection()
    try:
        PostgresEmbeddingWriter(connection).write(
            model_id="model-1",
            embedding_model="hyperpc/test",
            embedding_version="v1",
            dim=512,
            embedding=[0.1],
            text_sha256=b"hash",
            source_generation=1,
        )
    except ValueError as error:
        assert "512" in str(error)
    else:
        raise AssertionError("unsupported dimension must fail before SQL")
