"""Ветка rudalle: текст → RuDALL-E API → 3D-модель (GLB).

Вызывает ``rudalle_client.generate_3d`` и возвращает скачанный 3D-артефакт.
RuDALL-E может вернуть OBJ, если GLB временно недоступен; bytes сохраняются
воркером тем же образом, что и основной GLB-результат.
"""

from __future__ import annotations

import uuid

from .. import rudalle_client
from .base import NOOP_REPORTER, GenerationError, GenerationJob, GenerationResult, ProgressReporter


def run_rudalle(job: GenerationJob, report: ProgressReporter = NOOP_REPORTER) -> GenerationResult:
    config = rudalle_client.load_config()
    if config is None:
        raise GenerationError("RuDALL-E не сконфигурирован (RUDALLE_API_TOKEN)")

    report("loading", 5)
    model_bytes = rudalle_client.generate_3d(config, job.prompt, str(uuid.uuid4()))
    report("export", 100)
    return GenerationResult(
        artifact_bytes=model_bytes,
        artifact_ext="glb",
        artifact_content_type="model/gltf-binary",
    )
