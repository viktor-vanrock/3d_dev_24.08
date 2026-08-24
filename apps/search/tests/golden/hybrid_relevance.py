"""Симуляторы трёх каналов гибридного поиска для golden-set eval (MF-1998).

Реального HYPERPC (`/embed`, тем более векторного ANN по pgvector) в
окружении нет — та же ситуация, что giga/tests/golden/relevance_scoring.py
для GigaChat. Здесь эмбеддинг заменяет TF-косинус прокси (`_vector_rank`) —
это НЕ замер качества реальной модели, а eval для собственного кода этой
карточки: `portal_search.rank.fuse_rankings`/`rerank_or_fallback` слитого
поверх трёх списков-кандидатов. Когда HYPERPC подключат, прокси меняется
на реальный вызов `/embed`+cosine, формат golden-set и метрика (recall@k)
остаются теми же.

`exact_ids`/`lexical_ranked_ids` симулируют Postgres tsvector/pg_trgm —
не копия SQL, а тот же принцип: точное совпадение title/brand -> exact,
токен-пересечение с title/text -> лексический ранг.
"""

from __future__ import annotations

import math
import re
from collections import Counter

_TOKEN_RE = re.compile(r"\w+", re.UNICODE)
_STEM_LEN = 4
_STOPWORDS = frozenset(
    {
        "для", "без", "или", "под", "что", "как", "это", "при", "его", "все",
        "и", "в", "на", "с", "по", "от", "до", "за", "не", "но", "к", "у", "о",
    }
)


def _stems(text: str) -> Counter:
    tokens = (t.lower() for t in _TOKEN_RE.findall(text))
    kept = [t[:_STEM_LEN] for t in tokens if t not in _STOPWORDS and len(t) > 2]
    return Counter(kept)


def _cosine(a: Counter, b: Counter) -> float:
    if not a or not b:
        return 0.0
    dot = sum(a[k] * b[k] for k in a)
    norm_a = math.sqrt(sum(v * v for v in a.values()))
    norm_b = math.sqrt(sum(v * v for v in b.values()))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def vector_rank(query: str, documents: list[dict]) -> list[str]:
    """Прокси векторного канала: TF-косинус по `title+text`, по убыванию похожести."""
    query_stems = _stems(query)
    scored = [
        (doc["id"], _cosine(query_stems, _stems(f"{doc['title']} {doc['text']}")))
        for doc in documents
    ]
    scored = [pair for pair in scored if pair[1] > 0]
    return [doc_id for doc_id, _ in sorted(scored, key=lambda pair: (-pair[1], pair[0]))]


def lexical_rank(query: str, documents: list[dict]) -> list[str]:
    """Прокси лексического канала: доля токенов запроса, буквально встретившихся
    в title (не в description) — то, что full-text по названию обычно ловит
    сильнее, чем по описанию."""
    query_tokens = {t.lower() for t in _TOKEN_RE.findall(query) if len(t) > 2}
    if not query_tokens:
        return []
    scored = []
    for doc in documents:
        title_tokens = {t.lower() for t in _TOKEN_RE.findall(doc["title"])}
        overlap = len(query_tokens & title_tokens)
        if overlap:
            scored.append((doc["id"], overlap))
    return [doc_id for doc_id, _ in sorted(scored, key=lambda pair: (-pair[1], pair[0]))]


def exact_ids(query: str, documents: list[dict]) -> list[str]:
    """Точное совпадение бренда/названия: `query` целиком — подстрока title,
    ИЛИ `brand` документа встречается в `query` литерально (запрос называет
    бренд, как «крепление стола Prusa MK4» — ILIKE-эквивалент по колонке
    `brand`, не полнотекст по описанию). Порядок — короче title сначала."""
    q = query.strip().lower()
    matches = [
        doc
        for doc in documents
        if q in doc["title"].lower() or (doc.get("brand") and doc["brand"].lower() in q)
    ]
    return [doc["id"] for doc in sorted(matches, key=lambda d: len(d["title"]))]


def recall_at_k(queries: list[dict], fused_by_query: dict[str, list[str]], k: int) -> float:
    hits = sum(1 for q in queries if q["expected_doc"] in fused_by_query[q["id"]][:k])
    return hits / len(queries) if queries else 0.0
