"""Один Z-Image product shot для постоянного кэша концептов (MF-2067/MF-2068).

Ветка не строит 3D и не генерирует три временных ракурса: её результат — готовый PNG,
который воркер кладёт одновременно как artifact и preview. После этого кэш
`generated_concepts` становится `ready`, а клик по карточке создаёт отдельный TRELLIS-job
по сохранённому prompt.
"""

from __future__ import annotations

import hashlib
import re

from . import zimage_client
from .base import GenerationError, GenerationJob, GenerationResult, ProgressReporter

_PRODUCT_SHOT_SUFFIX = (
    " Preview of the future physical 3D print, not a finished retail product or an illustration. "
    "Single coherent watertight-looking printable object with sensible wall thickness, stable "
    "contact with the surface, and no floating or disconnected parts. Centered studio product "
    "shot, three-quarter front view, seamless pure white background, soft grounded shadow, "
    "the complete silhouette fully inside the frame. No printer, filament spool, supports, "
    "hands, text, logo, watermark, collage, or extra objects."
)
_WHITE_PLASTIC_MATERIAL = (
    " MATERIAL OVERRIDE — HIGHEST PRIORITY: monochrome prototype manufactured entirely from "
    "unpainted matte white 3D-printed plastic. Every visible surface is the same neutral white "
    "plastic. Show form, seams, texture, and relief only through soft light and shadow. No paint, "
    "colored accents, decals, graphics, multi-material parts, metallic finish, wood, glass, "
    "ceramic, or photoreal consumer-product materials."
)
_FUNCTIONAL_QUERY_RE = re.compile(
    r"(держател|подставк|органайзер|креплен|кронштейн|крюч|стойк|док-станц)",
    re.IGNORECASE,
)
_HEADPHONE_HOLDER_RE = re.compile(
    r"(?:держател\w*.*наушник\w*|наушник\w*.*держател\w*)",
    re.IGNORECASE,
)
_HEADPHONE_WORD_RE = re.compile(
    r"(?:наушник\w*|headphones?|headsets?|earcups?|headbands?)",
    re.IGNORECASE,
)
_FUNCTIONAL_SUBJECT_SUFFIX = (
    " The primary subject is the empty functional holder, stand, organizer, mount, or support "
    "structure requested by the prompt. Show that supporting structure itself fully visible, "
    "with its base, contact points, slots, and supports clearly readable. Omit the item it is "
    "designed to hold; never replace the support structure with that item."
)
_EMPTY_HEADPHONE_STAND_PROMPT = (
    "An empty freestanding T-shaped desktop display stand, broad stable base, one vertical "
    "column, and a wide gently curved top support bar. Show the complete stand silhouette and "
    "the empty negative space around it. The functional support structure is the only object."
)


def _seed(job: GenerationJob) -> int:
    digest = hashlib.sha256(f"{job.id}:{job.prompt}".encode()).digest()
    return int.from_bytes(digest[:8], "big") & ((1 << 63) - 1)


def _finish_prompt(subject_prompt: str) -> str:
    return f"{subject_prompt}{_PRODUCT_SHOT_SUFFIX}{_WHITE_PLASTIC_MATERIAL}"


def _image_prompt(job: GenerationJob) -> str:
    query = str(job.params.get("normalized_query") or "").strip()
    label = str(job.params.get("label") or "").strip()
    subject = " ".join(part for part in (query, label, job.prompt) if part)
    if _HEADPHONE_HOLDER_RE.search(subject):
        # Даже отрицательное «без наушников» усиливает токен зависимого предмета у diffusion-
        # модели. Для этой частой связи полностью убираем его из image-prompt и описываем
        # положительной геометрией только пустую Т-образную стойку.
        motif = job.prompt.rsplit(": ", maxsplit=1)[-1].strip(" .")
        safe_motif = _HEADPHONE_WORD_RE.sub("", motif).strip(" ,.;:-")
        motif_suffix = f" Surface and shape direction: {safe_motif}." if safe_motif else ""
        return _finish_prompt(f"{_EMPTY_HEADPHONE_STAND_PROMPT}{motif_suffix}")
    functional_guard = _FUNCTIONAL_SUBJECT_SUFFIX if _FUNCTIONAL_QUERY_RE.search(subject) else ""
    identity = (
        f' The requested primary object is exactly "{label or query}". Preserve its functional '
        "head noun and all object relationships literally."
        if label or query
        else ""
    )
    return _finish_prompt(f"{job.prompt.strip()}.{identity}{functional_guard}")


def run_concepts(job: GenerationJob, report: ProgressReporter) -> GenerationResult:
    config = zimage_client.load_config()
    if config is None:
        raise GenerationError("zimage: COMFYUI/Z-Image не сконфигурирован")
    report("loading", 5, eta_seconds=30)
    if not zimage_client.weights_available(config):
        raise GenerationError("zimage: веса ещё недоступны")

    report("draft", 15, eta_seconds=24)
    image = zimage_client.generate_image(
        config,
        _image_prompt(job),
        seed=_seed(job),
        filename_prefix=f"portal-concept-{job.id}",
    )
    report("export", 95, eta_seconds=1)
    return GenerationResult(
        artifact_bytes=image,
        artifact_ext="png",
        artifact_content_type="image/png",
        preview_bytes=image,
        preview_ext="png",
        preview_content_type="image/png",
    )
