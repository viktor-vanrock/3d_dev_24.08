"""Ветка rudalle_image: изображение из S3 → RuDALL-E Image to 3D → GLB."""

from __future__ import annotations

import base64
import uuid

from .. import rudalle_client
from ..config import load_s3_config
from ..storage import ObjectStore
from .base import NOOP_REPORTER, GenerationError, GenerationJob, GenerationResult, ProgressReporter


def run_rudalle_image(
    job: GenerationJob, report: ProgressReporter = NOOP_REPORTER
) -> GenerationResult:
    """Скачивает исходное изображение из generation-бакета и генерирует GLB."""
    config = rudalle_client.load_config()
    if config is None:
        raise GenerationError("RuDALL-E не сконфигурирован")

    s3_key = str(job.params.get("s3_key") or "").strip()
    if not s3_key:
        raise GenerationError("rudalle_image: отсутствует params.s3_key")

    ext = s3_key.rsplit(".", 1)[-1].lower()
    if ext == "jpeg":
        ext = "jpg"

    s3_config = load_s3_config()
    if s3_config is None:
        raise GenerationError(
            "rudalle_image: S3 не сконфигурирован (S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY)"
        )

    report("loading", 5)
    try:
        image_bytes = ObjectStore(s3_config).download_bytes(s3_key)
        image_base64 = base64.b64encode(image_bytes).decode("utf-8")
        model_bytes = rudalle_client.generate_3d_from_image(
            config=config,
            image_base64=image_base64,
            image_ext=ext,
            trace_id=str(uuid.uuid4()),
            prompt=job.prompt or "",
        )
    except TimeoutError as exc:
        raise GenerationError(f"rudalle_image: превышен timeout: {exc}") from exc
    except GenerationError:
        raise
    except Exception as exc:
        raise GenerationError(f"rudalle_image: не удалось сгенерировать модель: {exc}") from exc

    report("export", 100)
    return GenerationResult(
        artifact_bytes=model_bytes,
        artifact_ext="glb",
        artifact_content_type="model/gltf-binary",
    )
