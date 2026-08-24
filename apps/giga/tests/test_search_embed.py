"""Юнит-тесты обёртки над GigaChat Embeddings API — на фейковом клиенте, без сети/кредов."""

from __future__ import annotations

import pytest
from gigachat.exceptions import ServerError

from giga.search import embed as search_embed


class _Embedding:
    def __init__(self, index: int, vector: list[float]):
        self.index = index
        self.embedding = vector


class _EmbeddingsResponse:
    def __init__(self, items: list[_Embedding]):
        self.data = items


class _FakeClient:
    def __init__(self, responses=None, raise_on_call=None):
        self._responses = list(responses or [])
        self._raise_on_call = raise_on_call
        self.calls: list[list[str]] = []

    def embeddings(self, texts, model):
        self.calls.append(list(texts))
        if self._raise_on_call:
            raise self._raise_on_call
        return self._responses.pop(0)


def _vec(value: float, dim: int = search_embed.EMBEDDING_DIM) -> list[float]:
    return [value] * dim


def _response(*vectors: list[float]) -> _EmbeddingsResponse:
    return _EmbeddingsResponse([_Embedding(i, v) for i, v in enumerate(vectors)])


def test_embed_texts_empty_list_returns_empty_without_calling_api():
    client = _FakeClient()
    assert search_embed.embed_texts(client, []) == []
    assert client.calls == []


def test_embed_texts_normalizes_to_unit_length():
    client = _FakeClient(responses=[_response(_vec(2.0))])

    [vector] = search_embed.embed_texts(client, ["привет"])

    norm = sum(x * x for x in vector) ** 0.5
    assert norm == pytest.approx(1.0)


def test_embed_texts_preserves_input_order_regardless_of_response_order():
    v_a, v_b = _vec(1.0), _vec(-1.0)
    # Провайдер вернул элементы батча не по порядку — .index должен спасти сборку.
    out_of_order = _EmbeddingsResponse([_Embedding(1, v_b), _Embedding(0, v_a)])
    client = _FakeClient(responses=[out_of_order])

    vectors = search_embed.embed_texts(client, ["а", "б"])

    assert vectors[0][0] > 0
    assert vectors[1][0] < 0


def test_embed_texts_batches_large_input():
    texts = [f"текст {i}" for i in range(search_embed._MAX_BATCH_SIZE + 5)]
    responses = [
        _response(*[_vec(1.0) for _ in range(search_embed._MAX_BATCH_SIZE)]),
        _response(*[_vec(1.0) for _ in range(5)]),
    ]
    client = _FakeClient(responses=responses)

    vectors = search_embed.embed_texts(client, texts)

    assert len(vectors) == len(texts)
    assert len(client.calls) == 2
    assert len(client.calls[0]) == search_embed._MAX_BATCH_SIZE
    assert len(client.calls[1]) == 5


def test_embed_texts_wrong_dimension_raises():
    client = _FakeClient(responses=[_response(_vec(1.0, dim=8))])
    with pytest.raises(search_embed.EmbeddingError):
        search_embed.embed_texts(client, ["привет"])


def test_embed_texts_response_count_mismatch_raises():
    client = _FakeClient(responses=[_response(_vec(1.0))])
    with pytest.raises(search_embed.EmbeddingError):
        search_embed.embed_texts(client, ["раз", "два"])


def test_embed_texts_provider_error_wrapped_as_embedding_error():
    client = _FakeClient(raise_on_call=ServerError("https://gigachat", 500, b"", None))
    with pytest.raises(search_embed.EmbeddingError):
        search_embed.embed_texts(client, ["привет"])
