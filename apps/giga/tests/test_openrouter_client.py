"""Юнит-тесты `giga.openrouter_client` — httpx.post monkeypatch'нут, без
реальной сети (тот же приём, что `test_comfyui_client.py`)."""

from __future__ import annotations

import base64

import httpx
import pytest

from giga import openrouter_client as orc
from giga.branches.base import GenerationError


class _FakeResponse:
    def __init__(self, status_code=200, json_body=None, text=""):
        self.status_code = status_code
        self._json_body = json_body if json_body is not None else {}
        self.text = text or str(self._json_body)

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("bad status", request=None, response=self)

    def json(self):
        return self._json_body


def _config(**overrides) -> orc.OpenRouterConfig:
    base = dict(api_key="test-key", model="black-forest-labs/flux.2-klein-4b")
    base.update(overrides)
    return orc.OpenRouterConfig(**base)


def test_load_config_none_without_key(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    assert orc.load_config() is None


def test_load_config_reads_env(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-fake")
    monkeypatch.delenv("OPENROUTER_IMAGE_MODEL", raising=False)
    config = orc.load_config()
    assert config is not None
    assert config.api_key == "sk-or-fake"
    assert config.model == "black-forest-labs/flux.2-klein-4b"


def test_generate_image_decodes_base64(monkeypatch):
    png_bytes = b"\x89PNG\r\n\x1a\n" + b"0" * 16
    b64 = base64.b64encode(png_bytes).decode()
    captured = {}

    def _post(url, headers=None, json=None, timeout=None):
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        return _FakeResponse(json_body={"data": [{"b64_json": b64, "media_type": "image/png"}]})

    monkeypatch.setattr(httpx, "post", _post)

    result = orc.generate_image(_config(), "нарисуй кота")

    assert result == png_bytes
    assert captured["url"] == "https://openrouter.ai/api/v1/images"
    assert captured["headers"]["Authorization"] == "Bearer test-key"
    assert captured["json"]["prompt"] == "нарисуй кота"
    assert captured["json"]["model"] == "black-forest-labs/flux.2-klein-4b"


def test_generate_image_empty_data_raises(monkeypatch):
    def _post(url, headers=None, json=None, timeout=None):
        return _FakeResponse(json_body={"data": []})

    monkeypatch.setattr(httpx, "post", _post)

    with pytest.raises(GenerationError, match="пустой data"):
        orc.generate_image(_config(), "prompt")


def test_generate_image_400_is_not_retryable(monkeypatch):
    calls = {"n": 0}

    def _post(url, headers=None, json=None, timeout=None):
        calls["n"] += 1
        return _FakeResponse(status_code=400, text="invalid model")

    monkeypatch.setattr(httpx, "post", _post)

    with pytest.raises(GenerationError):
        orc.generate_image(_config(), "prompt")
    assert calls["n"] == 1  # не ретраится — тот же prompt/модель снова провалится так же


def test_generate_image_retries_on_5xx_then_succeeds(monkeypatch):
    png_bytes = b"\x89PNG\r\n\x1a\n"
    b64 = base64.b64encode(png_bytes).decode()
    calls = {"n": 0}

    def _post(url, headers=None, json=None, timeout=None):
        calls["n"] += 1
        if calls["n"] < 2:
            return _FakeResponse(status_code=503, text="overloaded")
        return _FakeResponse(json_body={"data": [{"b64_json": b64}]})

    monkeypatch.setattr(httpx, "post", _post)
    monkeypatch.setattr(orc, "OPENROUTER_RETRY_BACKOFF_SECONDS", 0.0)

    result = orc.generate_image(_config(), "prompt")

    assert result == png_bytes
    assert calls["n"] == 2


def test_generate_image_bad_base64_raises(monkeypatch):
    def _post(url, headers=None, json=None, timeout=None):
        return _FakeResponse(json_body={"data": [{"b64_json": "not-valid-base64!!!"}]})

    monkeypatch.setattr(httpx, "post", _post)

    with pytest.raises(GenerationError, match="битый base64"):
        orc.generate_image(_config(), "prompt")


def test_load_text_config_reads_env(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-fake")
    monkeypatch.delenv("OPENROUTER_TEXT_MODEL", raising=False)
    config = orc.load_text_config()
    assert config is not None
    assert config.model == "google/gemma-4-31b-it:free"


def test_generate_text_returns_content(monkeypatch):
    captured = {}

    def _post(url, headers=None, json=None, timeout=None):
        captured["url"] = url
        captured["json"] = json
        return _FakeResponse(json_body={"choices": [{"message": {"content": "cube([10,10,10]);"}}]})

    monkeypatch.setattr(httpx, "post", _post)

    result = orc.generate_text(_config(model="model-a"), "system", "user")

    assert result == "cube([10,10,10]);"
    assert captured["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert captured["json"]["model"] == "model-a"
    assert captured["json"]["messages"] == [
        {"role": "system", "content": "system"},
        {"role": "user", "content": "user"},
    ]


def test_generate_text_empty_content_raises(monkeypatch):
    def _post(url, headers=None, json=None, timeout=None):
        return _FakeResponse(json_body={"choices": [{"message": {"content": ""}}]})

    monkeypatch.setattr(httpx, "post", _post)
    monkeypatch.setattr(orc, "OPENROUTER_TEXT_MODEL_FALLBACKS", [])

    with pytest.raises(GenerationError, match="пустой content"):
        orc.generate_text(_config(model="model-a"), "system", "user")


def test_generate_text_falls_back_to_next_model_on_persistent_429(monkeypatch):
    # Регрессия живой находки 2026-07-20: бесплатный тир одной модели (google/gemma-4-31b-it:free)
    # ушёл в 429 целиком (не единичный сбой) — openscad-генерация должна пробовать следующую
    # модель из CLAUDE.md-цепочки, а не сдаваться после исчерпания retry на первой.
    monkeypatch.setattr(orc, "OPENROUTER_MAX_RETRIES", 0)
    monkeypatch.setattr(orc, "OPENROUTER_TEXT_MODEL_FALLBACKS", ["model-b", "model-c"])
    seen_models = []

    def _post(url, headers=None, json=None, timeout=None):
        seen_models.append(json["model"])
        if json["model"] != "model-b":
            return _FakeResponse(status_code=429, text="rate limited")
        return _FakeResponse(json_body={"choices": [{"message": {"content": "cube([1,1,1]);"}}]})

    monkeypatch.setattr(httpx, "post", _post)

    result = orc.generate_text(_config(model="model-a"), "system", "user")

    assert result == "cube([1,1,1]);"
    assert seen_models == ["model-a", "model-b"]


def test_generate_text_raises_when_all_models_exhausted(monkeypatch):
    monkeypatch.setattr(orc, "OPENROUTER_MAX_RETRIES", 0)
    monkeypatch.setattr(orc, "OPENROUTER_TEXT_MODEL_FALLBACKS", ["model-b"])

    def _post(url, headers=None, json=None, timeout=None):
        return _FakeResponse(status_code=429, text="rate limited")

    monkeypatch.setattr(httpx, "post", _post)

    with pytest.raises(GenerationError, match="все модели"):
        orc.generate_text(_config(model="model-a"), "system", "user")
