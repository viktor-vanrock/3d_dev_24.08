"""Тесты ветки kzd — OpenRouter замокан на уровне `openrouter_client.generate_image`."""

from __future__ import annotations

import io

import pytest
from PIL import Image

from giga import openrouter_client
from giga.branches.base import GenerationError, GenerationJob
from giga.branches.kzd import run_kzd


def _png_bytes(size=(64, 64), color=(200, 40, 40)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


def _job(prompt="кот в скафандре") -> GenerationJob:
    return GenerationJob(id="gen-1", branch="kzd", prompt=prompt, params={})


def test_run_kzd_without_credentials_raises(monkeypatch):
    monkeypatch.setattr(openrouter_client, "load_config", lambda: None)
    with pytest.raises(GenerationError, match="OPENROUTER_API_KEY"):
        run_kzd(_job())


def test_run_kzd_success_returns_artifact_and_preview(monkeypatch):
    source = _png_bytes()
    monkeypatch.setattr(openrouter_client, "load_config", lambda: object())
    monkeypatch.setattr(openrouter_client, "generate_image", lambda config, prompt: source)

    result = run_kzd(_job())

    assert result.artifact_bytes == source
    assert result.artifact_ext == "png"
    assert result.artifact_content_type == "image/png"

    assert result.preview_ext == "webp"
    assert result.preview_content_type == "image/webp"
    with Image.open(io.BytesIO(result.preview_bytes)) as preview:
        preview.load()
        assert preview.format == "WEBP"
        assert max(preview.size) <= 512


def test_run_kzd_propagates_provider_error(monkeypatch):
    monkeypatch.setattr(openrouter_client, "load_config", lambda: object())

    def _raise(config, prompt):
        raise GenerationError("провайдер отказал")

    monkeypatch.setattr(openrouter_client, "generate_image", _raise)

    with pytest.raises(GenerationError):
        run_kzd(_job())
