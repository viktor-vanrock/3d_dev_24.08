"""Юнит-тесты HyperpcClient на httpx.MockTransport — без реальной сети/Tailscale."""

from __future__ import annotations

import httpx
import pytest

from portal_search.config import HyperpcConfig
from portal_search.hyperpc_client import HyperpcClient, HyperpcError, HyperpcTimeout, RerankResult


def _config(**overrides) -> HyperpcConfig:
    defaults = dict(
        base_url="http://hyperpc.test",
        timeout_seconds=1.0,
        max_retries=2,
        retry_backoff_seconds=0.0,
    )
    defaults.update(overrides)
    return HyperpcConfig(**defaults)


def _client(handler, **config_overrides) -> HyperpcClient:
    client = HyperpcClient(_config(**config_overrides))
    client._http = httpx.Client(
        base_url=client._config.base_url,
        timeout=client._config.timeout_seconds,
        transport=httpx.MockTransport(handler),
    )
    return client


def test_health_ok():
    def handler(request):
        assert request.url.path == "/health"
        return httpx.Response(200, json={"status": "ok", "device": "cuda"})

    assert _client(handler).health() is True


def test_health_false_on_error_status():
    def handler(request):
        return httpx.Response(500, json={"status": "error"})

    assert _client(handler).health() is False


def test_health_false_on_network_error():
    def handler(request):
        raise httpx.ConnectError("сеть недоступна", request=request)

    assert _client(handler).health() is False


def test_embed_empty_input_no_call():
    def handler(request):
        raise AssertionError("не должен звать HTTP на пустой ввод")

    assert _client(handler).embed([]) == []


def test_embed_returns_vectors_in_order():
    def handler(request):
        assert request.url.path == "/embed"
        return httpx.Response(200, json={"embeddings": [[0.1, 0.2], [0.3, 0.4]], "dim": 2})

    result = _client(handler).embed(["дракон", "рама дрона"])
    assert result == [[0.1, 0.2], [0.3, 0.4]]


def test_embed_dimension_mismatch_raises():
    def handler(request):
        return httpx.Response(200, json={"embeddings": [[0.1, 0.2]], "dim": 2})

    with pytest.raises(HyperpcError):
        _client(handler).embed(["a", "b"])


def test_embed_multimodal_item_payload():
    captured = {}

    def handler(request):
        import json

        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"embeddings": [[0.1]], "dim": 1})

    item = {"text": "дракон", "image": "https://files.example.net/preview.png"}
    _client(handler).embed([item])
    assert captured["body"]["inputs"] == [item]


def test_rerank_empty_documents_no_call():
    def handler(request):
        raise AssertionError("не должен звать HTTP на пустой documents")

    assert _client(handler).rerank("запрос", []) == []


def test_rerank_returns_sorted_results():
    def handler(request):
        assert request.url.path == "/rerank"
        return httpx.Response(
            200, json={"results": [{"index": 1, "score": 0.9}, {"index": 0, "score": 0.4}]}
        )

    result = _client(handler).rerank("дракон для стола", ["d1", "d2"], top_k=2)
    assert result == [RerankResult(index=1, score=0.9), RerankResult(index=0, score=0.4)]


def test_post_retries_on_5xx_then_succeeds():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(503)
        return httpx.Response(200, json={"embeddings": [[1.0]], "dim": 1})

    result = _client(handler, max_retries=2).embed(["x"])
    assert result == [[1.0]]
    assert calls["n"] == 3


def test_post_raises_timeout_after_exhausting_retries():
    def handler(request):
        raise httpx.ConnectTimeout("нет ответа", request=request)

    with pytest.raises(HyperpcTimeout):
        _client(handler, max_retries=1).embed(["x"])


def test_post_does_not_retry_on_4xx():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(400, text="bad request")

    with pytest.raises(HyperpcError):
        _client(handler, max_retries=3).embed(["x"])
    assert calls["n"] == 1
