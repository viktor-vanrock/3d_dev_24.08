"""Клиент к Z-Image-Turbo через тот же ComfyUI, что TRELLIS.2 (слот 3, порт
8188, HYPERPC, `docs/process/hyperpc.local.llm.md`) — self-hosted замена
OpenRouter для шага «текст → референс-картинка» ветки `trellis` (MF-2067).

Зачем: `openrouter_client` (решение оператора 2026-07-20) стоит $/картинку и
требует внешний ключ; Z-Image-Turbo уже разворачивается на своей же машине
рядом с TRELLIS.2 — тот же физический вызов ComfyUI, без внешнего провайдера
и его расхода (принцип зоны AI «СТОИМОСТЬ»). `trellis.py` предпочитает этот
клиент и деградирует на OpenRouter, только если веса ещё не готовы или граф
падает — см. `trellis._generate_view`.

Граф — официальный `image_z_image_turbo_int8` (карточка MF-2067): `UNETLoader`
→ `CLIPLoader` (type=lumina2) → `CLIPTextEncode` → `ConditioningZeroOut`
(у Z-Image-Turbo нет классического negative prompt — негативный кондишн
обнуляется, не пишется текстом) → `ModelSamplingAuraFlow(shift=3)` →
`KSampler(steps=8, cfg=1, sampler=res_multistep, scheduler=simple)` →
`VAEDecode` → `SaveImage`. `EmptyLatentImage` — обязательный вход KSampler,
в списке карточки не назван явно, но без него граф не строится.

Имена файлов весов (`ZIMAGE_UNET_NAME`/`ZIMAGE_CLIP_NAME`/`ZIMAGE_VAE_NAME`) —
из env, не хардкод: только оператор/Ops знает, как ComfyUI на HYPERPC
реально называет скачанные файлы в `models/unet`/`models/clip`/`models/vae`.
Без них (или без `COMFYUI_URL`) — `load_config()` возвращает `None`, тот же
честный no-op паттерн, что `comfyui_client.load_config`/`openrouter_client.
load_config`.

Пока веса докачиваются — `load_config()` может быть не `None` (ComfyUI сам
уже поднят), но `weights_available()` живой проверкой `/object_info` честно
скажет `False` (карточка MF-2067: «endpoint обязан отдавать честный
unavailable/degraded status, не фейковые изображения»); вызывающая сторона
не должна звать `generate_image` без предварительной проверки.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

import httpx

from . import comfyui_client
from .base import GenerationError

logger = logging.getLogger("giga.branches.zimage")

ZIMAGE_STEPS = int(os.getenv("ZIMAGE_STEPS", "8"))
ZIMAGE_CFG = float(os.getenv("ZIMAGE_CFG", "1"))
ZIMAGE_SAMPLER_NAME = os.getenv("ZIMAGE_SAMPLER_NAME", "res_multistep")
ZIMAGE_SCHEDULER = os.getenv("ZIMAGE_SCHEDULER", "simple")
ZIMAGE_MODEL_SHIFT = float(os.getenv("ZIMAGE_MODEL_SHIFT", "3"))
ZIMAGE_WIDTH = int(os.getenv("ZIMAGE_WIDTH", "1024"))
ZIMAGE_HEIGHT = int(os.getenv("ZIMAGE_HEIGHT", "1024"))

_UNET_LOADER_NODE = "UNETLoader"
_UNET_NAME_INPUT = "unet_name"
_SAVE_IMAGE_NODE_ID = "10"


@dataclass(frozen=True)
class ZImageConfig:
    comfyui: comfyui_client.ComfyUIConfig
    unet_name: str
    clip_name: str
    vae_name: str


def load_config() -> ZImageConfig | None:
    """`None`, если ComfyUI не сконфигурирован (`COMFYUI_URL`) или имена
    весов не заданы (`ZIMAGE_UNET_NAME`/`ZIMAGE_CLIP_NAME`/`ZIMAGE_VAE_NAME`)
    — см. докстринг модуля."""
    comfyui_config = comfyui_client.load_config()
    if comfyui_config is None:
        return None
    unet_name = os.getenv("ZIMAGE_UNET_NAME")
    clip_name = os.getenv("ZIMAGE_CLIP_NAME")
    vae_name = os.getenv("ZIMAGE_VAE_NAME")
    if not unet_name or not clip_name or not vae_name:
        return None
    return ZImageConfig(
        comfyui=comfyui_config, unet_name=unet_name, clip_name=clip_name, vae_name=vae_name
    )


def weights_available(config: ZImageConfig) -> bool:
    """Живая проверка `/object_info/UNETLoader` — ComfyUI перечисляет реально
    присутствующие на диске файлы весов как COMBO-опции `unet_name`. Наличие
    поднятого ComfyUI-процесса (`comfyui_client.load_config()` не `None`)
    само по себе не значит, что конкретный чекпоинт уже докачан — см.
    докстринг модуля про честный unavailable/degraded статус. Любой сбой
    проверки (сеть/неразбираемый ответ) — тоже честное `False`, не
    предположение об успехе."""
    try:
        response = httpx.get(
            f"{config.comfyui.base_url}/object_info/{_UNET_LOADER_NODE}",
            timeout=config.comfyui.timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("zimage: не удалось проверить /object_info/%s: %s", _UNET_LOADER_NODE, exc)
        return False
    try:
        options = payload[_UNET_LOADER_NODE]["input"]["required"][_UNET_NAME_INPUT][0]
    except (KeyError, IndexError, TypeError):
        return False
    return isinstance(options, list) and config.unet_name in options


def _build_workflow(config: ZImageConfig, prompt: str, seed: int, filename_prefix: str) -> dict:
    return {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": config.unet_name, "weight_dtype": "default"},
        },
        "2": {
            "class_type": "CLIPLoader",
            "inputs": {"clip_name": config.clip_name, "type": "lumina2"},
        },
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": config.vae_name}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["2", 0]}},
        "5": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["4", 0]}},
        "6": {
            "class_type": "ModelSamplingAuraFlow",
            "inputs": {"model": ["1", 0], "shift": ZIMAGE_MODEL_SHIFT},
        },
        "7": {
            "class_type": "EmptySD3LatentImage",
            "inputs": {"width": ZIMAGE_WIDTH, "height": ZIMAGE_HEIGHT, "batch_size": 1},
        },
        "8": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["6", 0],
                "positive": ["4", 0],
                "negative": ["5", 0],
                "latent_image": ["7", 0],
                "seed": seed,
                "steps": ZIMAGE_STEPS,
                "cfg": ZIMAGE_CFG,
                "sampler_name": ZIMAGE_SAMPLER_NAME,
                "scheduler": ZIMAGE_SCHEDULER,
                "denoise": 1.0,
            },
        },
        "9": {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["3", 0]}},
        _SAVE_IMAGE_NODE_ID: {
            "class_type": "SaveImage",
            "inputs": {"images": ["9", 0], "filename_prefix": filename_prefix},
        },
    }


def generate_image(config: ZImageConfig, prompt: str, *, seed: int, filename_prefix: str) -> bytes:
    """Один вызов графа Z-Image-Turbo → PNG-байты сохранённого кадра.

    Один и тот же `seed` для всех ракурсов одного job'а (принцип зоны AI
    «Детерминизм где возможно») — при неизменном style-промпте и разной
    только view-суффиксной части текста это лучшее доступное приближение к
    консистентности объекта между ракурсами без image-conditioning входа у
    самого Z-Image-Turbo (тот же приём, что уже принят для OpenRouter-пути в
    `trellis._generate_view`).

    Ошибки ComfyUI (сеть/валидация/OOM) → `GenerationError`, тот же контракт,
    что `comfyui_client`/`openrouter_client` — вызывающая сторона решает,
    деградировать на OpenRouter или прервать job."""
    workflow = _build_workflow(config, prompt, seed, filename_prefix)
    try:
        history_entry = comfyui_client.submit_and_wait_with_retry(config.comfyui, workflow)
        images = comfyui_client.extract_saved_images(history_entry, _SAVE_IMAGE_NODE_ID)
        if not images:
            raise comfyui_client.ComfyUIOutputNotFoundError(
                "zimage: SaveImage не зарегистрировал вывод в history"
            )
        filename, subfolder = images[0]
        content = comfyui_client.fetch_view(config.comfyui, filename, subfolder=subfolder)
        if content is None:
            raise comfyui_client.ComfyUIOutputNotFoundError(
                f"zimage: файл {filename!r} не найден через /view"
            )
        return content
    except comfyui_client.ComfyUIError as exc:
        raise GenerationError(f"zimage: {exc}") from exc
