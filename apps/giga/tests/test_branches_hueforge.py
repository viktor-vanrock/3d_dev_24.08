"""Тесты ветки hueforge — OpenRouter замокан на уровне `openrouter_client.generate_image`."""

from __future__ import annotations

import io
import json
import zipfile

import pytest
from PIL import Image

from giga import openrouter_client
from giga.branches.base import GenerationError, GenerationJob
from giga.branches.hueforge import _DEFAULT_PALETTE_HEX, run_hueforge


def _quadrant_png_bytes(size=(64, 64)) -> bytes:
    """Четыре ярких квадранта — квантованию есть с чем работать."""
    image = Image.new("RGB", size)
    w, h = size
    colors = [(0, 0, 0), (255, 255, 255), (200, 20, 20), (20, 20, 200)]
    for i, color in enumerate(colors):
        box = image.crop((0, 0, w // 2, h // 2))
        box.paste(color, (0, 0, w // 2, h // 2))
        image.paste(box, ((i % 2) * w // 2, (i // 2) * h // 2))
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def _job(prompt="абстракция", params=None) -> GenerationJob:
    return GenerationJob(id="gen-1", branch="hueforge", prompt=prompt, params=params or {})


def test_run_hueforge_without_credentials_raises(monkeypatch):
    monkeypatch.setattr(openrouter_client, "load_config", lambda: None)
    with pytest.raises(GenerationError, match="OPENROUTER_API_KEY"):
        run_hueforge(_job())


def test_run_hueforge_success_packs_zip_with_layers(monkeypatch):
    source = _quadrant_png_bytes()
    monkeypatch.setattr(openrouter_client, "load_config", lambda: object())
    monkeypatch.setattr(openrouter_client, "generate_image", lambda config, prompt: source)

    result = run_hueforge(_job())

    assert result.artifact_ext == "zip"
    assert result.artifact_content_type == "application/zip"
    assert result.preview_ext == "png"

    with zipfile.ZipFile(io.BytesIO(result.artifact_bytes)) as archive:
        names = set(archive.namelist())
        assert names == {"quantized.png", "heightmap.png", "layers.json"}

        with Image.open(io.BytesIO(archive.read("quantized.png"))) as quantized:
            quantized.load()
            assert quantized.mode == "P"

        with Image.open(io.BytesIO(archive.read("heightmap.png"))) as height_map:
            height_map.load()
            assert height_map.mode == "L"

        layers = json.loads(archive.read("layers.json"))["layers"]
        assert len(layers) == len(_DEFAULT_PALETTE_HEX)
        heights = [layer["height_mm"] for layer in layers]
        assert heights == sorted(heights)
        assert heights[0] > 0


def test_run_hueforge_custom_palette_overrides_default(monkeypatch):
    source = _quadrant_png_bytes()
    monkeypatch.setattr(openrouter_client, "load_config", lambda: object())
    monkeypatch.setattr(openrouter_client, "generate_image", lambda config, prompt: source)

    result = run_hueforge(_job(params={"palette": ["#000000", "#ffffff"], "layer_height_mm": 0.1}))

    with zipfile.ZipFile(io.BytesIO(result.artifact_bytes)) as archive:
        layers = json.loads(archive.read("layers.json"))["layers"]
        assert [layer["hex"] for layer in layers] == ["#000000", "#ffffff"]
        assert layers[0]["height_mm"] == pytest.approx(0.1)
        assert layers[1]["height_mm"] == pytest.approx(0.2)


def test_run_hueforge_invalid_palette_hex_raises(monkeypatch):
    monkeypatch.setattr(openrouter_client, "load_config", lambda: object())
    with pytest.raises(GenerationError, match="hex"):
        run_hueforge(_job(params={"palette": ["not-a-color"]}))


def test_run_hueforge_non_positive_layer_height_raises(monkeypatch):
    monkeypatch.setattr(openrouter_client, "load_config", lambda: object())
    with pytest.raises(GenerationError, match="layer_height_mm"):
        run_hueforge(_job(params={"layer_height_mm": 0}))


# Регрессии живой находки 2026-07-20: эти три формы params раньше улетали наружу сырым
# Python-исключением (ValueError/AttributeError) — apps/api/src/generations/contract.ts::
# toGenerationResponse отдаёт `generations.error` клиенту без санитайзинга (в отличие от
# assistant-потока), так что баг был не только "воркер сам разберётся", а реальная утечка
# внутреннего сообщения пользователю.
def test_run_hueforge_non_numeric_layer_height_raises_clean_error(monkeypatch):
    monkeypatch.setattr(openrouter_client, "load_config", lambda: object())
    with pytest.raises(GenerationError, match="layer_height_mm"):
        run_hueforge(_job(params={"layer_height_mm": "fast"}))


def test_run_hueforge_non_string_palette_entries_raise_clean_error(monkeypatch):
    monkeypatch.setattr(openrouter_client, "load_config", lambda: object())
    with pytest.raises(GenerationError, match="hex-строки"):
        run_hueforge(_job(params={"palette": [123, 456]}))


def test_run_hueforge_oversized_palette_raises_clean_error(monkeypatch):
    monkeypatch.setattr(openrouter_client, "load_config", lambda: object())
    big_palette = [f"#{i:06x}" for i in range(300)]
    with pytest.raises(GenerationError, match="256"):
        run_hueforge(_job(params={"palette": big_palette}))


# Регрессия адверсариальной проверки 2026-07-20: float("nan")/float("inf") не бросают исключение
# в float(), проходят `<= 0` (False для обоих), и валят round() в _height_map необработанным
# ValueError/OverflowError — тот же класс утечки, что и остальные тесты этого файла закрывают.
@pytest.mark.parametrize("bad_value", ["nan", "inf", "-inf"])
def test_run_hueforge_non_finite_layer_height_raises_clean_error(monkeypatch, bad_value):
    monkeypatch.setattr(openrouter_client, "load_config", lambda: object())
    with pytest.raises(GenerationError, match="layer_height_mm"):
        run_hueforge(_job(params={"layer_height_mm": bad_value}))
