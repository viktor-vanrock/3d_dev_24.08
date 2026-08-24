"""Ветка hueforge (MF-352): картинка в стиле Кандинского → HueForge-набор.

Поток: тот же OpenRouter-клиент генерации изображений, что `kzd.py` (см.
докстринг там про переезд с GigaChat, 2026-07-20), но системный промпт просит
стиль Василия Кандинского; дальше — квантование в ограниченную палитру
филамента (Pillow, фиксированная палитра, не адаптивная — иначе результат не
будет соответствовать реальным цветам филамента) и сборка HueForge-
совместимого набора: квантованная картинка + карта высот слоёв + JSON-порядок
печати (тёмный цвет — низ/первый слой, светлый — верх/последний, как в
реальном HueForge-workflow).

Дефолтная палитра — заглушка типовых PLA-цветов, НЕ каталог филаментов
портала (интеграция с реальными SKU филамента — отдельная карточка
мультифиламента, здесь не дублируется); `params.palette` (список hex)
переопределяет её под конкретный набор катушек пользователя.

Артефакт — ZIP (single-file контракт `GenerationResult.artifact_bytes`),
внутри: `quantized.png`, `heightmap.png`, `layers.json`.
"""

from __future__ import annotations

import io
import json
import math
import zipfile

from PIL import Image

from .. import openrouter_client
from ._prompts import load_system_prompt
from .base import NOOP_REPORTER, GenerationError, GenerationJob, GenerationResult, ProgressReporter

_WORK_MAX_SIDE = 384
_DEFAULT_LAYER_HEIGHT_MM = 0.08
# Байт карты высот кодирует высоту в сотых мм (0..255 → 0..2.55мм) — с запасом
# под типовой HueForge-стек (десяток слоёв по 0.04-0.12мм).
_HEIGHT_MM_PER_BYTE_UNIT = 0.01

_MAX_PALETTE_COLORS = 256  # PIL "P"-режим — 8-битный индекс, больше физически не влезает


_DEFAULT_PALETTE_HEX = [
    "#0d0d0d",  # чёрный
    "#3d3d3d",  # тёмно-серый
    "#8c8c8c",  # серый
    "#f2f2f2",  # белый
    "#c81e2f",  # красный
    "#e8a33d",  # оранжевый
    "#e6d94f",  # жёлтый
    "#3f8f4f",  # зелёный
    "#2f5fa8",  # синий
    "#7a4fa3",  # фиолетовый
]


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    if len(h) != 6:
        raise ValueError(f"ожидался hex вида #rrggbb, получено {hex_color!r}")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _luminance(rgb: tuple[int, int, int]) -> float:
    r, g, b = rgb
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _resolve_palette(params: dict) -> list[tuple[str, tuple[int, int, int]]]:
    """Возвращает [(hex, rgb), ...] отсортированные тёмный→светлый (печатный порядок).

    `params` — недоверенный вход клиента (тот же принцип, что trellis.py про `target_size_mm`):
    каждая форма невалидности здесь ловится явно и заворачивается в `GenerationError` — иначе она
    улетает наружу сырым Python-исключением (`AttributeError`/`ValueError` из внутренностей PIL),
    а `toGenerationResponse` (apps/api/src/generations/contract.ts) отдаёт `error` клиенту как есть,
    без санитайзинга (в отличие от assistant-потока) — живая находка 2026-07-20."""
    hex_colors = params.get("palette") or _DEFAULT_PALETTE_HEX
    if not isinstance(hex_colors, list) or not hex_colors:
        raise GenerationError("hueforge: params.palette должен быть непустым списком hex-цветов")
    if len(hex_colors) > _MAX_PALETTE_COLORS:
        raise GenerationError(
            f"hueforge: params.palette превышает {_MAX_PALETTE_COLORS} цветов "
            f"(получено {len(hex_colors)})"
        )
    if not all(isinstance(hex_color, str) for hex_color in hex_colors):
        raise GenerationError("hueforge: params.palette должен содержать только hex-строки")
    try:
        entries = [(hex_color, _hex_to_rgb(hex_color)) for hex_color in hex_colors]
    except ValueError as exc:
        raise GenerationError(f"hueforge: битый hex в params.palette: {exc}") from exc
    return sorted(entries, key=lambda entry: _luminance(entry[1]))


def _quantize(image: Image.Image, palette_rgb: list[tuple[int, int, int]]) -> Image.Image:
    palette_image = Image.new("P", (1, 1))
    palette_image.putpalette([channel for rgb in palette_rgb for channel in rgb])
    rgb_image = image.convert("RGB")
    rgb_image.thumbnail((_WORK_MAX_SIDE, _WORK_MAX_SIDE))
    return rgb_image.quantize(palette=palette_image, dither=Image.Dither.FLOYDSTEINBERG)


def _height_map(quantized: Image.Image, palette_size: int, layer_height_mm: float) -> Image.Image:
    unit = max(1, round(layer_height_mm / _HEIGHT_MM_PER_BYTE_UNIT))
    lut = bytes(min(255, (index + 1) * unit) if index < palette_size else 0 for index in range(256))
    heights = quantized.tobytes().translate(lut)
    return Image.frombytes("L", quantized.size, heights)


def _pack_artifact(quantized: Image.Image, height_map: Image.Image, layers: list[dict]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as archive:
        quantized_buf = io.BytesIO()
        quantized.save(quantized_buf, format="PNG")
        archive.writestr("quantized.png", quantized_buf.getvalue())

        height_buf = io.BytesIO()
        height_map.save(height_buf, format="PNG")
        archive.writestr("heightmap.png", height_buf.getvalue())

        layers_json = json.dumps({"layers": layers}, ensure_ascii=False, indent=2)
        archive.writestr("layers.json", layers_json)
    return buf.getvalue()


def run_hueforge(job: GenerationJob, report: ProgressReporter = NOOP_REPORTER) -> GenerationResult:
    config = openrouter_client.load_config()
    if config is None:
        raise GenerationError("OpenRouter не сконфигурирован (OPENROUTER_API_KEY)")

    try:
        layer_height_mm = float(job.params.get("layer_height_mm", _DEFAULT_LAYER_HEIGHT_MM))
    except (TypeError, ValueError) as exc:
        raise GenerationError(
            f"hueforge: params.layer_height_mm должен быть числом: {exc}"
        ) from exc
    # `float("nan")`/`float("inf")` не бросают исключение здесь (живая находка адверсариальной
    # проверки 2026-07-20): "nan" проходит `<=0` (False) и валит `round()` в `_height_map` уже
    # необработанным ValueError/OverflowError — та же категория утечки, что этот фикс и закрывает.
    if not math.isfinite(layer_height_mm) or layer_height_mm <= 0:
        raise GenerationError(
            "hueforge: params.layer_height_mm должен быть положительным конечным числом"
        )

    palette = _resolve_palette(job.params)
    palette_rgb = [rgb for _hex, rgb in palette]

    style_prompt = load_system_prompt("hueforge")
    png_bytes = openrouter_client.generate_image(config, f"{style_prompt}\n\n{job.prompt}")

    with Image.open(io.BytesIO(png_bytes)) as source:
        quantized = _quantize(source, palette_rgb)
    height_map = _height_map(quantized, len(palette_rgb), layer_height_mm)

    layers = [
        {
            "print_order": order,
            "hex": hex_color,
            "height_mm": round((order + 1) * layer_height_mm, 4),
        }
        for order, (hex_color, _rgb) in enumerate(palette)
    ]
    artifact_bytes = _pack_artifact(quantized, height_map, layers)

    preview_buf = io.BytesIO()
    quantized.convert("RGB").save(preview_buf, format="PNG")

    return GenerationResult(
        artifact_bytes=artifact_bytes,
        artifact_ext="zip",
        artifact_content_type="application/zip",
        preview_bytes=preview_buf.getvalue(),
        preview_ext="png",
        preview_content_type="image/png",
    )
