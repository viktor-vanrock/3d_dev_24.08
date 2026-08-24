"""Ветка kzd (MF-352): изображение по тексту.

«КЗД» = картинка по тексту. Изначально шла через встроенную генерацию
изображений GigaChat (Kandinsky под капотом) — переключена на OpenRouter
Images API (`openrouter_client`, решение оператора 2026-07-20):
`GIGACHAT_CREDENTIALS` на VDS не сконфигурирован ни для прода, ни для dev,
эта ветка никогда не работала. OpenRouter — тот же клиент, что у trellis.

Генерация 3D-модели («и, если доступно, →model» в описании фазы) недоступна —
эта часть branch намеренно не реализована (условие «если доступно» в
исходной постановке), ветка отдаёт только изображение.
"""

from __future__ import annotations

import io

from PIL import Image

from .. import openrouter_client
from ._prompts import load_system_prompt
from .base import NOOP_REPORTER, GenerationError, GenerationJob, GenerationResult, ProgressReporter

_PREVIEW_MAX_SIDE = 512


def _build_preview(png_bytes: bytes) -> bytes:
    with Image.open(io.BytesIO(png_bytes)) as image:
        image = image.convert("RGB")
        image.thumbnail((_PREVIEW_MAX_SIDE, _PREVIEW_MAX_SIDE))
        buf = io.BytesIO()
        image.save(buf, format="WEBP", quality=85)
        return buf.getvalue()


def run_kzd(job: GenerationJob, report: ProgressReporter = NOOP_REPORTER) -> GenerationResult:
    config = openrouter_client.load_config()
    if config is None:
        raise GenerationError("OpenRouter не сконфигурирован (OPENROUTER_API_KEY)")

    style_prompt = load_system_prompt("kzd")
    png_bytes = openrouter_client.generate_image(config, f"{style_prompt}\n\n{job.prompt}")

    return GenerationResult(
        artifact_bytes=png_bytes,
        artifact_ext="png",
        artifact_content_type="image/png",
        preview_bytes=_build_preview(png_bytes),
        preview_ext="webp",
        preview_content_type="image/webp",
    )
