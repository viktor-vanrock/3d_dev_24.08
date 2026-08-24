"""Юнит-тесты `giga.assistant.hyperpc_client` — httpx.get/post monkeypatch'нуты,
без реальной сети/Tailscale."""

from __future__ import annotations

import httpx
import pytest

from giga.assistant import hyperpc_client as hp


class _FakeResponse:
    def __init__(self, status_code=200, json_body=None):
        self.status_code = status_code
        self._json_body = json_body if json_body is not None else {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("bad status", request=None, response=self)

    def json(self):
        return self._json_body


def test_load_config_none_without_structured_url(monkeypatch):
    monkeypatch.delenv("HYPERPC_STRUCTURED_URL", raising=False)
    assert hp.load_config() is None


def test_load_config_reads_env(monkeypatch):
    monkeypatch.setenv("HYPERPC_STRUCTURED_URL", "http://100.74.48.83:1236/")
    monkeypatch.setenv("HYPERPC_FAST_URL", "http://100.74.48.83:1235/")
    config = hp.load_config()
    assert config is not None
    assert config.structured_url == "http://100.74.48.83:1236"
    assert config.fast_url == "http://100.74.48.83:1235"


def test_discover_model_reads_first_model_id(monkeypatch):
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, timeout=None: _FakeResponse(
            json_body={"data": [{"id": "C:\\models\\qwen3.6-35b-a3b.gguf"}]}
        ),
    )
    model = hp.discover_model("http://hyperpc:1236")
    assert model == "C:\\models\\qwen3.6-35b-a3b.gguf"


def test_discover_model_none_on_network_failure(monkeypatch):
    def _raise(url, timeout=None):
        raise httpx.ConnectError("refused")

    monkeypatch.setattr(httpx, "get", _raise)
    assert hp.discover_model("http://hyperpc:1236") is None


def test_health_check_false_on_bad_status(monkeypatch):
    monkeypatch.setattr(httpx, "get", lambda url, timeout=None: _FakeResponse(status_code=503))
    assert hp.health_check("http://hyperpc:1236") is False


def test_chat_structured_disables_thinking_and_uses_temperature_zero(monkeypatch):
    captured = {}

    monkeypatch.setattr(
        httpx, "get", lambda url, timeout=None: _FakeResponse(json_body={"data": [{"id": "m"}]})
    )

    def _post(url, json, timeout=None):
        captured["url"] = url
        captured["json"] = json
        return _FakeResponse(
            json_body={"choices": [{"message": {"content": '{"kind": "answer"}'}}]}
        )

    monkeypatch.setattr(httpx, "post", _post)

    config = hp.HyperpcConfig(
        structured_url="http://hyperpc:1236",
        fast_url=None,
        timeout_seconds=5.0,
        max_retries=1,
        retry_backoff_seconds=0.01,
    )
    content = hp.chat_structured(config, "system", "user")

    assert content == '{"kind": "answer"}'
    assert captured["json"]["temperature"] == 0.0
    assert captured["json"]["chat_template_kwargs"] == {"enable_thinking": False}
    assert captured["url"] == "http://hyperpc:1236/v1/chat/completions"


def test_chat_structured_raises_invalid_response_without_model_discovery(monkeypatch):
    monkeypatch.setattr(httpx, "get", lambda url, timeout=None: _FakeResponse(json_body={}))
    config = hp.HyperpcConfig(
        structured_url="http://hyperpc:1236",
        fast_url=None,
        timeout_seconds=5.0,
        max_retries=1,
        retry_backoff_seconds=0.01,
    )
    with pytest.raises(hp.HyperpcInvalidResponseError):
        hp.chat_structured(config, "system", "user")


def test_chat_structured_timeout_is_retryable_and_stable(monkeypatch):
    monkeypatch.setattr(
        httpx, "get", lambda url, timeout=None: _FakeResponse(json_body={"data": [{"id": "m"}]})
    )

    calls = {"n": 0}

    def _post(url, json, timeout=None):
        calls["n"] += 1
        raise httpx.ReadTimeout("slow")

    monkeypatch.setattr(httpx, "post", _post)

    config = hp.HyperpcConfig(
        structured_url="http://hyperpc:1236",
        fast_url=None,
        timeout_seconds=1.0,
        max_retries=2,
        retry_backoff_seconds=0.0,
    )
    with pytest.raises(hp.HyperpcTimeoutError):
        hp.chat_structured(config, "system", "user")
    assert calls["n"] == 3  # 1 initial + 2 retries — исчерпан весь бюджет попыток


def test_chat_fast_requires_fast_url():
    config = hp.HyperpcConfig(
        structured_url="http://hyperpc:1236",
        fast_url=None,
        timeout_seconds=5.0,
        max_retries=1,
        retry_backoff_seconds=0.01,
    )
    with pytest.raises(hp.HyperpcInvalidResponseError):
        hp.chat_fast(config, "system", "user")
