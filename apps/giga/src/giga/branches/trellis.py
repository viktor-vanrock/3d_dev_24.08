"""Ветка trellis (MF-2001): текст → 2-3 референс-картинки с разных ракурсов
(OpenRouter) → 3D-меш (TRELLIS.2 через ComfyUI на HYPERPC, `docs/process/
hyperpc.local.llm.md`).

TRELLIS.2 — image-to-shape, не text-to-3D (проверено `object_info` живого
инстанса ComfyUI, MF-2001): текстового узла-входа у графа нет. Изначально
референс рисовал GigaChat (`gigachat_client.ask_image`) — переключено на
OpenRouter (решение оператора 2026-07-20, `openrouter_client`, та же модель
`black-forest-labs/flux.2-klein-4b`, что и у `kzd`/`hueforge`):
`GIGACHAT_CREDENTIALS` на VDS не сконфигурирован ни для прода, ни для dev, эта
ветка никогда не работала.

Мульти-вид (front обязателен, back/left — по факту успешной генерации,
честная деградация на меньшее число ракурсов, если один из вызовов упал) —
у ComfyUI уже стоит нода `Trellis2MultiViewImageToShape` (front/back/left/
right/top/bottom, каждый ракурс со своей маской через
`Trellis2RemoveBackground`), одного вида «три четверти сверху» было
недостаточно для уверенной реконструкции формы сбоку/сзади. Граф собирается
программно в `_build_multiview_workflow` (не статический JSON-шаблон с
плейсхолдерами, как раньше single-view `trellis.api.json` — число реальных
входных картинок теперь переменное).

Референс-картинка (MF-2067) — сперва self-hosted Z-Image-Turbo через тот же
ComfyUI, что TRELLIS.2 (`zimage_client`, без внешнего $/картинку расхода);
OpenRouter — честный fallback, только пока веса Z-Image ещё не докачаны или
граф падает (`zimage_client.weights_available`/`GenerationError`), не
одновременный дубль — см. `_generate_view`.

Печатность — обязательный аудит, не декларация (CLAUDE.md зоны AI: «GLB
нельзя называть готовым к печати без проверки»). Живой smoke-test при
подготовке ветки (MF-2001) вернул РЕАЛЬНЫЙ не-watertight меш — это не
гипотетический edge case, а типичный результат сырой AI-генерации:
- меш watertight и в разумных габаритах → конвертируем в STL, artifact_ext
  = "stl" (печатный), preview = масштабированный GLB;
- иначе → artifact_ext = "glb" — честный preview-only результат (GLB как
  формат превью-без-печати уже устоявшаяся конвенция репо, см.
  `docs/epics/formats.policy.md`), никакого STL не выдаём.

3MF-упаковка (сборки/цвет) — зона Mesh, как и в ветке `openscad`, здесь
намеренно не делаем.
"""

from __future__ import annotations

import hashlib
import io
import logging
import os
import time

import trimesh

from .. import openrouter_client
from . import comfyui_client, zimage_client
from ._prompts import load_system_prompt
from .base import NOOP_REPORTER, GenerationError, GenerationJob, GenerationResult, ProgressReporter

logger = logging.getLogger("giga.branches.trellis")

_DEFAULT_TARGET_SIZE_MM = 80.0
_MIN_TARGET_SIZE_MM = 10.0
_MAX_TARGET_SIZE_MM = 300.0
_MAX_GLB_BYTES = 80 * 1024 * 1024
_MAX_FACE_COUNT = 2_000_000

# Ракурсы под Trellis2MultiViewImageToShape (front обязателен) — суффикс
# добавляется к общему стилевому промпту (prompts/trellis.system.md).
_VIEW_PROMPT_SUFFIX: dict[str, str] = {
    "front": "Вид спереди.",
    "back": "Вид сзади (задняя часть предмета, без лица/передней стороны).",
    "left": "Вид сбоку, профиль (камера повёрнута на 90 градусов).",
}
_MODEL_RESOLUTION = "512"
_SHAPE_SAMPLING_PARAMS = {
    "ss_guidance_strength": 6.5,
    "ss_guidance_rescale": 0.05,
    "ss_sampling_steps": 8,
    "shape_guidance_strength": 6.5,
    "shape_guidance_rescale": 0.05,
    "shape_sampling_steps": 8,
    "max_tokens": 24576,
}
_PROCESS_MESH_PARAMS = {
    "remesh": "on",
    "remesh.remesh_band": 1.0,
    "remesh.remove_inner_faces": False,
    "target_face_count": 100000,
    "floater_threshold": 0.001,
    "weld_vertices": True,
    "weld_digits": 4,
    "chart_cone_angle": 90.0,
    "chart_refine_iterations": 0,
    "chart_global_iterations": 1,
    "chart_smooth_strength": 1,
}

# Грубая time-based оценка длительности ComfyUI-этапа (upload → shape → mesh → export),
# калибровка — живой smoke-test MF-2001 (~50с на ЗАНИЖЕННЫХ sampling_steps=4; прод-граф
# использует steps=8 из _SHAPE_SAMPLING_PARAMS, дольше). НЕ честный per-node прогресс:
# `/history` этого ComfyUI пуст, пока job не завершится целиком (см. docstring
# `comfyui_client.wait_for_completion`) — здесь только elapsed/estimated, без вебсокета
# узнать, какая нода исполняется прямо сейчас, нельзя. Переопределяется env для калибровки
# без деплоя кода.
_ESTIMATED_COMFYUI_SECONDS = float(os.getenv("COMFYUI_TRELLIS_ESTIMATED_SECONDS", "150"))
_ESTIMATED_REFERENCE_SECONDS = float(os.getenv("ZIMAGE_ESTIMATED_SECONDS", "30"))


def _job_seed(job_id: str) -> int:
    """Детерминированный seed из job.id — тот же job (в т.ч. ретрай той же
    записи) всегда просит у TRELLIS одну и ту же сэмплинг-траекторию для
    одного и того же набора входных картинок (сами картинки от OpenRouter
    могут отличаться раз от раза — это уже вне нашего контроля, см. CLAUDE.md
    зоны AI § «Детерминизм где возможно»)."""
    digest = hashlib.sha256(job_id.encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % 2_147_483_647


def _safe_prefix(job_id: str) -> str:
    return "giga" + "".join(ch for ch in job_id if ch.isalnum())


def _build_multiview_workflow(view_images: dict[str, str], filename_prefix: str, seed: int) -> dict:
    """`view_images` — `{"front": comfy_image_name, "back": ..., "left": ...}`,
    `"front"` обязателен, `"back"`/`"left"` — только те ракурсы, что реально
    сгенерировались (честная деградация, см. докстринг модуля). Каждый ракурс —
    свой `LoadImage` + `Trellis2RemoveBackground` (даёт `image`+`mask`, не
    полагаемся на альфа-канал результата OpenRouter — он его не отдаёт),
    фид в `Trellis2MultiViewImageToShape` по имени ракурса (`{view}_image`/
    `{view}_mask`)."""
    workflow: dict = {
        "92": {
            "class_type": "LoadTrellis2Models",
            "inputs": {
                "resolution": _MODEL_RESOLUTION,
                "precision": "auto",
                "attn_backend": "auto",
            },
        },
    }
    shape_inputs: dict = {"model_config": ["92", 0], "seed": seed, **_SHAPE_SAMPLING_PARAMS}
    node_ids = {"front": ("1", "12"), "back": ("2", "13"), "left": ("3", "14")}
    for view, image_name in view_images.items():
        load_id, bg_id = node_ids[view]
        workflow[load_id] = {"class_type": "LoadImage", "inputs": {"image": image_name}}
        workflow[bg_id] = {
            "class_type": "Trellis2RemoveBackground",
            "inputs": {"image": [load_id, 0]},
        }
        shape_inputs[f"{view}_image"] = [bg_id, 0]
        shape_inputs[f"{view}_mask"] = [bg_id, 1]
    workflow["104"] = {"class_type": "Trellis2MultiViewImageToShape", "inputs": shape_inputs}
    workflow["110"] = {
        "class_type": "Trellis2ProcessMesh",
        "inputs": {"trimesh": ["104", 0], **_PROCESS_MESH_PARAMS},
    }
    workflow["999"] = {
        "class_type": "Trellis2ExportTrimesh",
        "inputs": {"trimesh": ["110", 0], "filename_prefix": filename_prefix, "file_format": "glb"},
    }
    return workflow


def _generate_view(
    *,
    zimage_config: zimage_client.ZImageConfig | None,
    or_config: openrouter_client.OpenRouterConfig | None,
    style_prompt: str,
    job_prompt: str,
    view: str,
    seed: int,
    job_id: str,
) -> bytes | None:
    """`None` на сбой генерации конкретного ракурса — вызывающая сторона
    решает, деградировать (пропустить ракурс) или прервать job (front).

    Z-Image-Turbo (self-hosted, `zimage_config` не `None` — вызывающая
    сторона уже проверила `weights_available`) — предпочтительный провайдер
    (MF-2067, cost); сбой конкретного вызова (не только отсутствие весов)
    честно деградирует на OpenRouter, если тот сконфигурирован, а не сразу
    пропускает ракурс."""
    prompt = f"{style_prompt} {_VIEW_PROMPT_SUFFIX[view]}\n\n{job_prompt}"
    if zimage_config is not None:
        try:
            prefix = _safe_prefix(f"{job_id}{view}")
            return zimage_client.generate_image(
                zimage_config, prompt, seed=seed, filename_prefix=prefix
            )
        except GenerationError as exc:
            logger.warning(
                "trellis: Z-Image-Turbo не сгенерировал ракурс %r, пробую OpenRouter "
                "(если сконфигурирован): %s",
                view,
                exc,
            )
    if or_config is not None:
        try:
            return openrouter_client.generate_image(or_config, prompt)
        except GenerationError as exc:
            logger.warning("trellis: ракурс %r не сгенерировался (OpenRouter): %s", view, exc)
    return None


def _target_size_mm(params: dict) -> float:
    """Целевой габарит модели в мм — TRELLIS отдаёт геометрию в своих
    нормализованных единицах (смоук-тест MF-2001: extents ~0.5-1.0, явно не
    мм), печатный размер задаёт пользователь. Невалидное/отсутствующее
    значение — честный дефолт, не ошибка (params — недоверенный вход
    клиента, CLAUDE.md зоны AI § «ВХОД ВРАЖДЕБЕН»)."""
    raw = params.get("target_size_mm")
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return _DEFAULT_TARGET_SIZE_MM
    return max(_MIN_TARGET_SIZE_MM, min(_MAX_TARGET_SIZE_MM, float(raw)))


_GLB_MAGIC = b"glTF"


def _load_mesh(glb_bytes: bytes) -> trimesh.Trimesh:
    if glb_bytes[:4] != _GLB_MAGIC:
        # Type-валидация до парсинга (`docs/epics/formats.policy.md`: магические
        # байты GLB — `67 6C 54 46`) — явная проверка, не полагаемся только на
        # то, что парсер trimesh сам откажется от мусора.
        raise GenerationError("trellis: файл от ComfyUI не является GLB (нет magic bytes)")
    try:
        mesh = trimesh.load(io.BytesIO(glb_bytes), file_type="glb", force="mesh")
    except Exception as exc:  # noqa: BLE001 — любой сбой парсинга GLB = невалидный меш
        raise GenerationError(f"trellis: не удалось прочитать GLB: {exc}") from exc
    if mesh.is_empty:
        raise GenerationError("trellis: сгенерированный меш пустой")
    if len(mesh.faces) > _MAX_FACE_COUNT:
        raise GenerationError(
            f"trellis: меш слишком тяжёлый ({len(mesh.faces)} треугольников > {_MAX_FACE_COUNT})"
        )
    return mesh


def _rescale(mesh: trimesh.Trimesh, target_size_mm: float) -> None:
    max_extent = float(mesh.extents.max())
    if max_extent <= 0:
        raise GenerationError("trellis: у меша нулевой габарит")
    mesh.apply_scale(target_size_mm / max_extent)


def _build_result(mesh: trimesh.Trimesh) -> GenerationResult:
    preview_bytes = mesh.export(file_type="glb")
    if mesh.is_watertight:
        stl_bytes = mesh.export(file_type="stl")
        return GenerationResult(
            artifact_bytes=stl_bytes,
            artifact_ext="stl",
            artifact_content_type="model/stl",
            preview_bytes=preview_bytes,
            preview_ext="glb",
            preview_content_type="model/gltf-binary",
        )
    # Не watertight — честно отдаём только GLB-превью, не называем печатным
    # (см. докстринг модуля). GLB как preview-only формат — конвенция репо
    # (`docs/epics/formats.policy.md`), тот же артефакт и превью не дублируем.
    return GenerationResult(
        artifact_bytes=preview_bytes,
        artifact_ext="glb",
        artifact_content_type="model/gltf-binary",
    )


def _running_progress(elapsed_seconds: float) -> tuple[int, int]:
    """20..90% диапазон на время ComfyUI-этапа, никогда не берём 90%+ до
    реального завершения (честнее приврать "почти готово" на 89%, чем
    заявить 100% и зависнуть)."""
    fraction = min(elapsed_seconds / _ESTIMATED_COMFYUI_SECONDS, 0.95)
    progress = int(20 + fraction * 70)
    eta_seconds = max(int(_ESTIMATED_COMFYUI_SECONDS - elapsed_seconds), 0)
    return progress, eta_seconds


def run_trellis(job: GenerationJob, report: ProgressReporter = NOOP_REPORTER) -> GenerationResult:
    """phase — тот же словарь RUN_PHASES, что `packages/contracts/http/assistant.ts::
    RunProgressSnapshot` (amendment MF-1999 §2/§4): loading (референс+upload+submit,
    до старта TRELLIS-сэмплинга) → geometry (сам ComfyUI-пайплайн, элапсед-оценка —
    честная оговорка в `_running_progress`) → validation (mesh-аудит) → export
    (STL/GLB-сборка результата)."""
    zimage_config = zimage_client.load_config()
    zimage_ready = zimage_config is not None and zimage_client.weights_available(zimage_config)
    or_config = openrouter_client.load_config()
    if not zimage_ready:
        zimage_config = None
        if or_config is None:
            raise GenerationError("OpenRouter не сконфигурирован (OPENROUTER_API_KEY)")
    config = comfyui_client.load_config()
    if config is None:
        raise GenerationError("ComfyUI не сконфигурирован (COMFYUI_URL)")

    report(
        "loading",
        5,
        eta_seconds=int(3 * _ESTIMATED_REFERENCE_SECONDS + _ESTIMATED_COMFYUI_SECONDS),
    )
    style_prompt = load_system_prompt("trellis")
    seed = _job_seed(job.id)

    def _view(view: str) -> bytes | None:
        return _generate_view(
            zimage_config=zimage_config,
            or_config=or_config,
            style_prompt=style_prompt,
            job_prompt=job.prompt,
            view=view,
            seed=seed,
            job_id=job.id,
        )

    front_png = _view("front")
    if front_png is None:
        raise GenerationError("trellis: не удалось сгенерировать референс-картинку (вид спереди)")
    view_pngs = {"front": front_png}
    for view in ("back", "left"):
        png_bytes = _view(view)
        if png_bytes is not None:
            view_pngs[view] = png_bytes

    try:
        report("loading", 15, eta_seconds=int(_ESTIMATED_COMFYUI_SECONDS))
        view_images = {
            view: comfyui_client.upload_image(config, png_bytes, "image/png")
            for view, png_bytes in view_pngs.items()
        }

        filename_prefix = _safe_prefix(job.id)
        workflow = _build_multiview_workflow(view_images, filename_prefix, seed)

        submitted_at = time.time()
        report("loading", 20, eta_seconds=int(_ESTIMATED_COMFYUI_SECONDS))

        def _on_tick(elapsed_seconds: float) -> None:
            progress, eta_seconds = _running_progress(elapsed_seconds)
            report("geometry", progress, eta_seconds=eta_seconds)

        comfyui_client.submit_and_wait_with_retry(config, workflow, on_tick=_on_tick)
        completed_at = time.time()

        glb_bytes = comfyui_client.locate_export(
            config,
            filename_prefix=filename_prefix,
            file_format="glb",
            submitted_at=submitted_at,
            completed_at=completed_at,
        )
    except comfyui_client.ComfyUIError as exc:
        raise GenerationError(f"trellis: {exc}") from exc

    report("validation", 95)

    if len(glb_bytes) > _MAX_GLB_BYTES:
        raise GenerationError(
            f"trellis: GLB от ComfyUI слишком большой ({len(glb_bytes)} байт > {_MAX_GLB_BYTES})"
        )

    mesh = _load_mesh(glb_bytes)
    _rescale(mesh, _target_size_mm(job.params))
    report("export", 98)
    return _build_result(mesh)
