"""Юнит-тесты гибридного слияния/rerank — без сети, без БД."""

from __future__ import annotations

from portal_search.hyperpc_client import HyperpcError, RerankResult
from portal_search.rank import fuse_rankings, rerank_or_fallback


def test_fuse_rankings_exact_always_first():
    fused = fuse_rankings(
        exact_ids=["brand-x"],
        lexical_ranked_ids=["a", "b", "brand-x"],
        vector_ranked_ids=["c", "a"],
    )
    assert fused[0] == "brand-x"


def test_fuse_rankings_rrf_prefers_doc_in_both_lists():
    fused = fuse_rankings(
        exact_ids=[],
        lexical_ranked_ids=["a", "b", "c"],
        vector_ranked_ids=["b", "d", "a"],
    )
    # "b" встречается высоко в обоих списках -> должен обогнать "a" (высоко только в лексике)
    # и "c"/"d" (по одному разу).
    assert fused[0] == "b"


def test_fuse_rankings_no_duplicates_and_preserves_unmatched():
    fused = fuse_rankings(
        exact_ids=["x"],
        lexical_ranked_ids=["x", "y"],
        vector_ranked_ids=["z"],
    )
    assert fused.count("x") == 1
    assert set(fused) == {"x", "y", "z"}


def test_fuse_rankings_empty_inputs():
    assert fuse_rankings(exact_ids=[], lexical_ranked_ids=[], vector_ranked_ids=[]) == []


class _StubClient:
    def __init__(self, results=None, error=None):
        self._results = results
        self._error = error
        self.calls = []

    def rerank(self, query, documents, *, top_k=None):
        self.calls.append((query, documents, top_k))
        if self._error is not None:
            raise self._error
        return self._results


def test_rerank_or_fallback_no_client_returns_fused_order():
    fused = ["exact-1", "a", "b"]
    result = rerank_or_fallback(None, "запрос", fused, {}, exact_count=1)
    assert result == fused


def test_rerank_or_fallback_preserves_exact_prefix_reorders_rest():
    fused = ["exact-1", "a", "b"]
    texts = {"a": "текст a", "b": "текст b"}
    client = _StubClient(
        results=[RerankResult(index=1, score=0.9), RerankResult(index=0, score=0.2)]
    )

    result = rerank_or_fallback(client, "запрос", fused, texts, exact_count=1)

    assert result == ["exact-1", "b", "a"]
    assert client.calls[0][1] == ["текст a", "текст b"]


def test_rerank_or_fallback_on_hyperpc_error_returns_fused_order():
    fused = ["exact-1", "a", "b"]
    texts = {"a": "текст a", "b": "текст b"}
    client = _StubClient(error=HyperpcError("таймаут"))

    result = rerank_or_fallback(client, "запрос", fused, texts, exact_count=1)

    assert result == fused


def test_rerank_or_fallback_partial_top_k_keeps_missing_in_tail():
    fused = ["a", "b", "c"]
    texts = {"a": "A", "b": "B", "c": "C"}
    # top_k=1 -> только "b" вернулся отранжированным, "a" и "c" остаются в хвосте
    client = _StubClient(results=[RerankResult(index=1, score=0.99)])

    result = rerank_or_fallback(client, "запрос", fused, texts, exact_count=0, top_k=1)

    assert result[0] == "b"
    assert set(result) == {"a", "b", "c"}


def test_rerank_or_fallback_missing_document_text_kept_at_end():
    fused = ["a", "no-text"]
    texts = {"a": "A"}
    client = _StubClient(results=[RerankResult(index=0, score=0.5)])

    result = rerank_or_fallback(client, "запрос", fused, texts, exact_count=0)

    assert result == ["a", "no-text"]


def test_rerank_or_fallback_empty_rest_no_call():
    client = _StubClient()
    result = rerank_or_fallback(client, "запрос", ["exact-1"], {}, exact_count=1)
    assert result == ["exact-1"]
    assert client.calls == []
