"""Domain-only embedding helpers used by the Search lifecycle worker.

Queue acquisition, leases, retries, fencing, metrics and shutdown belong to
``portal_queue_lifecycle`` plus the Search-owned adapter in ``lifecycle.py``.
This module deliberately knows only how to turn Search content into an embedding.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Protocol

from . import profiles
from .render import load_mesh, render_views


@dataclass(frozen=True)
class ModelGeometry:
    data: bytes
    file_hint: str


class ModelContentProvider(Protocol):
    def get_text_document(self, model_id: str) -> str | None: ...

    def get_geometry(self, model_id: str) -> ModelGeometry | None: ...


class IndexDocument(Protocol):
    model_id: str
    embedding_model: str


class EmbeddingClient(Protocol):
    def embed(self, items: list[object]) -> list[list[float]]: ...


class IndexingError(Exception):
    """A domain indexing failure classified by the lifecycle worker."""


def _embed_text(
    job: IndexDocument,
    content: ModelContentProvider,
    hyperpc: EmbeddingClient,
) -> list[float] | None:
    text = content.get_text_document(job.model_id)
    if not text:
        return None
    vectors = hyperpc.embed([text])
    return vectors[0]


def _embed_view(
    job: IndexDocument,
    content: ModelContentProvider,
    hyperpc: EmbeddingClient,
) -> list[float] | None:
    geometry = content.get_geometry(job.model_id)
    if geometry is None:
        return None
    view_index = profiles.view_index_from_profile(job.embedding_model)
    mesh = load_mesh(geometry.data, geometry.file_hint)
    all_views = render_views(mesh)
    if view_index >= len(all_views):
        raise IndexingError(f"view_index={view_index} outside rendered views ({len(all_views)})")
    view = all_views[view_index]
    image = base64.b64encode(view.png_bytes).decode("ascii")
    vectors = hyperpc.embed([{"image": f"data:image/png;base64,{image}"}])
    return vectors[0]
