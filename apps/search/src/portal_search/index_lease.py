"""Search-owned content freshness persistence.

Queue lifecycle SQL lives exclusively in :mod:`portal_search.lifecycle`.  This
module keeps the independent domain fence on ``model_embeddings.source_generation``:
an old content generation can never overwrite a newer embedding.
"""

from __future__ import annotations

from typing import Any, Protocol


class IndexedHashReader(Protocol):
    def get_indexed_text_sha256(
        self,
        model_id: str,
        embedding_model: str,
        embedding_version: str,
    ) -> bytes | None: ...


class EmbeddingWriter(Protocol):
    def write(
        self,
        *,
        model_id: str,
        embedding_model: str,
        embedding_version: str,
        dim: int,
        embedding: list[float],
        text_sha256: bytes,
        source_generation: int,
    ) -> bool: ...


class PostgresIndexRepository:
    """Read the domain freshness hash; it does not own queue lifecycle SQL."""

    def __init__(self, connection: Any) -> None:
        self._connection = connection

    def get_indexed_text_sha256(
        self,
        model_id: str,
        embedding_model: str,
        embedding_version: str,
    ) -> bytes | None:
        with self._connection.cursor() as cursor:
            cursor.execute(
                """
                select text_sha256 from model_embeddings
                 where model_id = %s and embedding_model = %s and embedding_version = %s
                """,
                (model_id, embedding_model, embedding_version),
            )
            row = cursor.fetchone()
        return bytes(row[0]) if row else None


class PostgresEmbeddingWriter:
    """Write an embedding only when its content generation is newer."""

    def __init__(self, connection: Any) -> None:
        self._connection = connection

    def write(
        self,
        *,
        model_id: str,
        embedding_model: str,
        embedding_version: str,
        dim: int,
        embedding: list[float],
        text_sha256: bytes,
        source_generation: int,
    ) -> bool:
        if dim == 1024:
            column, cast = "embedding_1024", "vector(1024)"
        elif dim == 2048:
            column, cast = "embedding_2048", "halfvec(2048)"
        else:
            raise ValueError(f"unsupported embedding dimension: {dim}")

        vector_literal = "[" + ",".join(repr(float(value)) for value in embedding) + "]"
        with self._connection.cursor() as cursor:
            cursor.execute(
                f"""
                insert into model_embeddings
                  (model_id, embedding_model, embedding_version, dim,
                   {column}, text_sha256, source_generation)
                values (%s, %s, %s, %s, %s::{cast}, %s, %s)
                on conflict (model_id, embedding_model, embedding_version) do update
                   set {column} = excluded.{column},
                       text_sha256 = excluded.text_sha256,
                       source_generation = excluded.source_generation,
                       indexed_at = now(),
                       updated_at = now()
                 where model_embeddings.source_generation < excluded.source_generation
                """,
                (
                    model_id,
                    embedding_model,
                    embedding_version,
                    dim,
                    vector_literal,
                    text_sha256,
                    source_generation,
                ),
            )
            applied = cursor.rowcount > 0
        self._connection.commit()
        return applied
