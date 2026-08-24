"""Гибридное ранжирование (MF-1998): точные совпадения + лексика + вектор + rerank.

`docs/epics/neural.search.md` § «Гибридный поиск»: не заменять full-text
вектором, комбинировать (RRF — reciprocal rank fusion). Этот модуль — только
слияние уже полученных списков id, БЕЗ доступа к БД: `exact_ids`/
`lexical_ranked_ids` приходят из Postgres tsvector/pg_trgm полнотекста,
`vector_ranked_ids` — из pgvector ANN по эмбеддингу запроса. Кто их достаёт
(SQL, фильтры craft/материал/принтер) — контракт `Back` (см.
`apps/search/readme.md` § «Границы»: «db-rows — читает models (владелец
Back)»); здесь только чистая функция слияния — testable без живой БД.

**Гарантия «точные совпадения не проседают»** (MF-1998 «Готово когда») —
не эвристика поверх скоринга, а структурное свойство: `exact_ids` всегда
идут перед любым RRF-слитым результатом в `fuse_rankings`, и `rerank_or_fallback`
переупорядочивает rerank'ом только «хвост» после них, не весь список.

**Fallback при таймауте HYPERPC — обязательный путь, не best-effort**:
`rerank_or_fallback` ловит `HyperpcError`/`HyperpcTimeout` и возвращает
fused-порядок без изменений — ответ остаётся lexical+vector, не 500
(MF-1998 «Готово когда»).
"""

from __future__ import annotations

import logging

from .hyperpc_client import HyperpcClient, HyperpcError

logger = logging.getLogger("portal_search.rank")

DEFAULT_RRF_K = 60


def fuse_rankings(
    *,
    exact_ids: list[str],
    lexical_ranked_ids: list[str],
    vector_ranked_ids: list[str],
    rrf_k: int = DEFAULT_RRF_K,
) -> list[str]:
    """Сливает лексический и векторный ранжированные списки через RRF, кладёт
    `exact_ids` первыми (в переданном порядке, без переранжирования между собой).

    RRF-скор документа = сумма `1 / (rrf_k + rank + 1)` по спискам, где он
    встретился (`rank` — 0-based позиция); отсутствие в списке даёт 0 для
    этого списка — статья с двумя слабыми совпадениями (лексика И вектор)
    может обогнать документ с одним сильным, что и есть цель гибридизации
    (баланс, а не победа одного канала).
    """
    exact_set = set(exact_ids)
    scores: dict[str, float] = {}
    for ranked in (lexical_ranked_ids, vector_ranked_ids):
        for rank, doc_id in enumerate(ranked):
            if doc_id in exact_set:
                continue
            scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (rrf_k + rank + 1)

    fused_rest = sorted(scores, key=lambda doc_id: (-scores[doc_id], doc_id))

    result: list[str] = []
    seen: set[str] = set()
    for doc_id in (*exact_ids, *fused_rest):
        if doc_id not in seen:
            seen.add(doc_id)
            result.append(doc_id)
    return result


def rerank_or_fallback(
    client: HyperpcClient | None,
    query: str,
    fused_ids: list[str],
    document_text_by_id: dict[str, str],
    *,
    exact_count: int,
    top_k: int | None = None,
) -> list[str]:
    """Уточняет порядок «хвоста» (после `exact_count` точных совпадений) через
    HYPERPC `/rerank`. Возвращает `fused_ids` без изменений, если:
    - `client is None` (HYPERPC не сконфигурирован — `config.load_hyperpc_config` вернул `None`);
    - вызов упал (`HyperpcError`/`HyperpcTimeout`, таймаут/сеть/провайдер).

    Документы без текста в `document_text_by_id` (не должно случаться при
    консистентном индексе, но входной контракт не гарантирует это на 100%)
    остаются в исходном fused-порядке относительно rerank'нутых — не роняют вызов.
    """
    exact_prefix = fused_ids[:exact_count]
    rest = fused_ids[exact_count:]
    if client is None or not rest:
        return fused_ids

    rest_with_text = [doc_id for doc_id in rest if doc_id in document_text_by_id]
    rest_without_text = [doc_id for doc_id in rest if doc_id not in document_text_by_id]
    if not rest_with_text:
        return fused_ids

    try:
        results = client.rerank(
            query,
            [document_text_by_id[doc_id] for doc_id in rest_with_text],
            top_k=top_k,
        )
    except HyperpcError as exc:
        logger.warning("rerank недоступен (%s) — остаёмся на lexical+vector fallback", exc)
        return fused_ids

    reranked = [rest_with_text[r.index] for r in results if 0 <= r.index < len(rest_with_text)]
    # /rerank может вернуть top_k < len(rest_with_text) — недостающие остаются
    # в исходном fused-порядке в хвосте, не выпадают из результата молча.
    remaining = [doc_id for doc_id in rest_with_text if doc_id not in set(reranked)]
    return [*exact_prefix, *reranked, *remaining, *rest_without_text]
