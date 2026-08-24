"""Идентичность HYPERPC-профилей в versioned-индексе (MF-1998 поверх MF-2003).

`docs/architecture/neural.search.md` § «Versioned индекс» (Data, MF-2003,
`apps/api/db/migrations/20260720110000_versioned_search_index.sql`) фиксирует
identity `(model_id, embedding_model, embedding_version)` на `model_embeddings`/
`search_index_jobs`, с `embedding_model='hyperpc/qwen3-vl-embedding-2b'` уже как
пример в живом тесте (`versioned-search-index.migration.test.ts`) — это имя
здесь не изобретено заново, а взято из уже зафиксированного контракта.

**Мульти-view — расширение AI поверх этого контракта, не решение Data**: схема
не предполагала явно несколько геометрических ракурсов одной модели, но
identity-триплет естественно вмещает их без изменения схемы — каждый ракурс
получает свой `embedding_model` (текстовый профиль остаётся отдельной строкой
с тем же `embedding_version`). Отражено как открытый пункт в
`docs/contracts/model.index.v1.md`.
"""

from __future__ import annotations

EMBEDDING_MODEL = "hyperpc/qwen3-vl-embedding-2b"
EMBEDDING_VERSION = "v1"
HYPERPC_DIM = 2048

_VIEW_SUFFIX_PREFIX = ":view"


def view_embedding_model(view_index: int) -> str:
    """Профиль эмбеддинга конкретного ракурса рендера (`render.DEFAULT_VIEWS[view_index]`)."""
    return f"{EMBEDDING_MODEL}{_VIEW_SUFFIX_PREFIX}{view_index}"


def is_view_profile(embedding_model: str) -> bool:
    return embedding_model.startswith(f"{EMBEDDING_MODEL}{_VIEW_SUFFIX_PREFIX}")


def view_index_from_profile(embedding_model: str) -> int:
    if not is_view_profile(embedding_model):
        raise ValueError(f"не view-профиль: {embedding_model!r}")
    return int(embedding_model.rsplit(_VIEW_SUFFIX_PREFIX, 1)[1])
