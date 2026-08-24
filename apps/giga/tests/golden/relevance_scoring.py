"""Лексический прокси-скорер для golden-set релевантности (MF-503).

Реального семантического эмбеддинга (GigaChat) в окружении нет — Фаза 1-2
нейропоиска (MF-348/MF-349) ещё не реализованы, кредов GigaChat на этой
машине для `giga` не выдано (see `docs/architecture/readme.md`, "живём без
ключа" из CLAUDE.md). Пока считаем релевантность простым TF-скорингом
(cosine по частотам грубых "стеблей" слов) — это НЕ замена recall@k на
реальных эмбеддингах, а прокси-метод, чтобы измерить конкретный риск этой
карточки: не теряет ли очистка markdown-синтаксиса лексическое содержание
описания по сравнению с plain-baseline, и не вносит ли СЫРОЙ markdown
(с URL/код-фенсами) шум, которого не было в baseline.

Когда Фаза 1-2 подключат реальный `/embed` (GigaChat), этот скорер меняется
на косинус по векторам эмбеддинга — набор `search_relevance.json` и формат
метрики (MRR по документам golden-set) остаются теми же.
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


def stems(text: str) -> Counter:
    tokens = (t.lower() for t in _TOKEN_RE.findall(text))
    kept = [t[:_STEM_LEN] for t in tokens if t not in _STOPWORDS and len(t) > 2]
    return Counter(kept)


def cosine_similarity(a: Counter, b: Counter) -> float:
    if not a or not b:
        return 0.0
    dot = sum(a[k] * b[k] for k in a)
    norm_a = math.sqrt(sum(v * v for v in a.values()))
    norm_b = math.sqrt(sum(v * v for v in b.values()))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def rank_documents(query: str, documents: dict[str, str]) -> list[tuple[str, float]]:
    """Возвращает `(doc_id, score)` по убыванию похожести на `query`."""
    query_stems = stems(query)
    scored = [
        (doc_id, cosine_similarity(query_stems, stems(text))) for doc_id, text in documents.items()
    ]
    return sorted(scored, key=lambda pair: (-pair[1], pair[0]))


def reciprocal_rank(query: str, documents: dict[str, str], expected_doc: str) -> float:
    """MRR-компонента: 1/позиция правильного документа в выдаче (0, если не найден)."""
    ranking = rank_documents(query, documents)
    for position, (doc_id, score) in enumerate(ranking, start=1):
        if doc_id == expected_doc:
            return 1.0 / position if score > 0 else 0.0
    return 0.0


def mean_reciprocal_rank(queries: list[dict], documents: dict[str, str]) -> float:
    scores = [reciprocal_rank(q["text"], documents, q["expected_doc"]) for q in queries]
    return sum(scores) / len(scores) if scores else 0.0
