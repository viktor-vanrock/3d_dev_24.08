"""Eval MF-1998: гибридное слияние (rank.fuse_rankings) на golden-set RU
maker-запросов. Метод — см. докстринг golden/hybrid_relevance.py (TF-косинус
как прокси векторного канала, реального HYPERPC в окружении нет).

Критерии приёмки MF-1998, проверяемые здесь:
1. recall@1 гибридного слияния по семантическим запросам (q1-q6, без точного
   пересечения слов с найденным документом) не хуже, чем recall@1 одного
   векторного канала — гибридизация не должна портить то, что вектор уже
   находит.
2. Точное совпадение бренда (q7 "Prusa MK4") не проседает за лексически
   похожим, но неверным по бренду декоем (d8) — d7 обязан быть #1.
3. При недоступном HYPERPC (`rerank_or_fallback` с `client=None`) порядок
   остаётся lexical+vector fused, поиск не падает и не возвращает пусто —
   «при timeout HYPERPC ответ остаётся lexical, не 500».
"""

from __future__ import annotations

import json
from pathlib import Path

from golden.hybrid_relevance import exact_ids, lexical_rank, recall_at_k, vector_rank

from portal_search.rank import fuse_rankings, rerank_or_fallback

_GOLDEN_SET_PATH = Path(__file__).parent / "golden" / "ru_maker_queries.json"


def _load_golden_set() -> dict:
    return json.loads(_GOLDEN_SET_PATH.read_text(encoding="utf-8"))


def _fused_by_query(golden: dict) -> dict[str, list[str]]:
    documents = golden["documents"]
    fused = {}
    for q in golden["queries"]:
        fused[q["id"]] = fuse_rankings(
            exact_ids=exact_ids(q["text"], documents),
            lexical_ranked_ids=lexical_rank(q["text"], documents),
            vector_ranked_ids=vector_rank(q["text"], documents),
        )
    return fused


def test_hybrid_recall_at_1_not_worse_than_vector_only_on_semantic_queries():
    golden = _load_golden_set()
    documents = golden["documents"]
    semantic_queries = [q for q in golden["queries"] if q["kind"] == "semantic"]

    fused = _fused_by_query(golden)
    vector_only = {
        q["id"]: vector_rank(q["text"], documents) for q in semantic_queries
    }

    recall_hybrid = recall_at_k(semantic_queries, fused, k=1)
    recall_vector_only = recall_at_k(semantic_queries, vector_only, k=1)

    print(f"\nMF-1998 recall@1 — hybrid={recall_hybrid:.2f} vector_only={recall_vector_only:.2f}")
    assert recall_hybrid >= recall_vector_only


def test_exact_brand_match_not_buried_by_lexically_similar_decoy():
    golden = _load_golden_set()
    documents = golden["documents"]
    query = next(q for q in golden["queries"] if q["id"] == "q7")

    fused = fuse_rankings(
        exact_ids=exact_ids(query["text"], documents),
        lexical_ranked_ids=lexical_rank(query["text"], documents),
        vector_ranked_ids=vector_rank(query["text"], documents),
    )

    assert fused[0] == query["expected_doc"], (
        f"точное совпадение бренда просело: fused={fused[:3]}, "
        f"ожидали {query['expected_doc']} первым"
    )
    assert query["decoy_doc"] in fused  # декой не выпал из выдачи, просто не первый


def test_fallback_without_hyperpc_keeps_fused_order_never_empty():
    golden = _load_golden_set()
    documents = golden["documents"]
    doc_text = {d["id"]: f"{d['title']} {d['text']}" for d in documents}

    for q in golden["queries"]:
        fused = fuse_rankings(
            exact_ids=exact_ids(q["text"], documents),
            lexical_ranked_ids=lexical_rank(q["text"], documents),
            vector_ranked_ids=vector_rank(q["text"], documents),
        )
        exact_count = len(exact_ids(q["text"], documents))

        result = rerank_or_fallback(None, q["text"], fused, doc_text, exact_count=exact_count)

        assert result == fused
        assert result, f"запрос {q['id']}: fallback вернул пустой результат вместо lexical/vector"
