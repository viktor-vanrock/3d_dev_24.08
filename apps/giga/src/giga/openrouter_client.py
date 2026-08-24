"""Тонкий HTTP-клиент к OpenRouter Images API (`POST /api/v1/images`) —
замена GigaChat для шага «текст → референс-картинка» веток kzd/hueforge/
trellis (решение оператора 2026-07-20: `GIGACHAT_CREDENTIALS` на VDS не
сконфигурирован ни для прода, ни для dev, GigaChat в этом окружении никогда
не работал).

Модель по умолчанию — `black-forest-labs/flux.2-klein-4b` ($0.014/мегапиксель,
самая дешёвая модель с достаточной популярностью/доверием из тех, что
реально сравнивались вручную на этой же сессии: FLUX Klein даёт чистый
силуэт объекта на однотонном фоне без лишней подставки, Seedream 4.5 точнее
и дороже втрое, но сама добавляет постамент, которого мы не просили — для
reference-картинки под 3D-реконструкцию силуэт важнее фотореализма).

Ключ — `OPENROUTER_API_KEY`, общий с интерактивным OpenCode-раннтаймом на
этой же VDS (оператор явно выбрал не заводить отдельный под apps/giga,
2026-07-20) — расходы на картинки идут в общий OpenRouter-баланс аккаунта,
не отдельной строкой.

Без `OPENROUTER_API_KEY` — `load_config()` возвращает `None` (тот же
паттерн, что `gigachat_client.load_client`/`comfyui_client.load_config`):
сервис не падает, конкретная генерация уходит в `status=error`.
"""

from __future__ import annotations

import base64
import binascii
import os
import time
from dataclasses import dataclass

import httpx

from .branches.base import GenerationError

OPENROUTER_TIMEOUT_SECONDS = float(os.getenv("OPENROUTER_TIMEOUT_SECONDS", "60"))
OPENROUTER_MAX_RETRIES = int(os.getenv("OPENROUTER_MAX_RETRIES", "2"))
OPENROUTER_RETRY_BACKOFF_SECONDS = float(os.getenv("OPENROUTER_RETRY_BACKOFF_SECONDS", "1.0"))
OPENROUTER_IMAGE_MODEL = os.getenv("OPENROUTER_IMAGE_MODEL", "black-forest-labs/flux.2-klein-4b")
# Ветка openscad (текст → OpenSCAD-код) — тот же общий ключ, отдельная модель: чат-модель, не
# картиночная. Бесплатный тир (CLAUDE.md зоны AI § «OpenRouter — Free cloud models», тот же выбор,
# что дефолт оператора в его собственном рабочем окружении) — cost>speed, open source preferred,
# сама generation не время-критична (уже идёт через очередь/поллинг), а retry-на-ошибку-компиляции
# в _generate_once частично компенсирует более слабую модель.
OPENROUTER_TEXT_MODEL = os.getenv("OPENROUTER_TEXT_MODEL", "google/gemma-4-31b-it:free")
# CLAUDE.md зоны AI § «OpenRouter»: "Если rate-limited: google/gemma-4-26b-a4b-it:free,
# nvidia/nemotron-3-super-120b-a12b:free" — тот же порядок, оператор уже принял это решение.
OPENROUTER_TEXT_MODEL_FALLBACKS = [
    m.strip()
    for m in os.getenv(
        "OPENROUTER_TEXT_MODEL_FALLBACKS",
        "google/gemma-4-26b-a4b-it:free,nvidia/nemotron-3-super-120b-a12b:free",
    ).split(",")
    if m.strip()
]
_IMAGES_URL = "https://openrouter.ai/api/v1/images"
_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions"
_RETRY_STATUS_CODES = (429, 500, 502, 503, 504)


@dataclass(frozen=True)
class OpenRouterConfig:
    api_key: str
    model: str


def load_config() -> OpenRouterConfig | None:
    """`None`, если `OPENROUTER_API_KEY` не задан."""
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        return None
    return OpenRouterConfig(api_key=api_key, model=OPENROUTER_IMAGE_MODEL)


def load_text_config() -> OpenRouterConfig | None:
    """`None`, если `OPENROUTER_API_KEY` не задан — тот же ключ, что `load_config()`."""
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        return None
    return OpenRouterConfig(api_key=api_key, model=OPENROUTER_TEXT_MODEL)


def generate_image(config: OpenRouterConfig, prompt: str, *, aspect_ratio: str = "1:1") -> bytes:
    """Одна картинка по тексту, PNG-байты. Ошибки провайдера/сети → GenerationError.

    Ретраится только на сетевые сбои и 429/5xx (`_RETRY_STATUS_CODES`) — тот
    же профиль, что `gigachat_client`/`comfyui_client`. 4xx (кроме 429,
    например невалидный prompt/модель) не ретраится — тот же запрос снова
    провалится так же.
    """
    body = {
        "model": config.model,
        "prompt": prompt,
        "aspect_ratio": aspect_ratio,
        "output_format": "png",
    }
    headers = {"Authorization": f"Bearer {config.api_key}"}
    last_exc: Exception | None = None
    for attempt in range(OPENROUTER_MAX_RETRIES + 1):
        if attempt > 0:
            time.sleep(OPENROUTER_RETRY_BACKOFF_SECONDS * attempt)
        try:
            response = httpx.post(
                _IMAGES_URL, headers=headers, json=body, timeout=OPENROUTER_TIMEOUT_SECONDS
            )
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last_exc = exc
            continue
        if response.status_code in _RETRY_STATUS_CODES:
            last_exc = GenerationError(f"OpenRouter: {response.status_code} {response.text[:300]}")
            continue
        try:
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPStatusError as exc:
            raise GenerationError(f"OpenRouter: {exc} — {response.text[:300]}") from exc
        except ValueError as exc:
            raise GenerationError(f"OpenRouter вернул неразбираемый JSON: {exc}") from exc
        data = payload.get("data") if isinstance(payload, dict) else None
        if not data or not isinstance(data, list):
            raise GenerationError(f"OpenRouter не вернул изображение (пустой data): {payload}")
        b64_json = data[0].get("b64_json") if isinstance(data[0], dict) else None
        if not isinstance(b64_json, str) or not b64_json:
            raise GenerationError("OpenRouter: ответ без b64_json")
        try:
            return base64.b64decode(b64_json, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise GenerationError(f"OpenRouter: битый base64 изображения: {exc}") from exc
    raise GenerationError(
        f"OpenRouter: нет ответа от {_IMAGES_URL} за "
        f"{OPENROUTER_MAX_RETRIES + 1} попыток: {last_exc}"
    )


def _chat_completion_once(
    api_key: str, model: str, system_prompt: str, user_prompt: str, temperature: float | None
) -> str:
    """Один вызов `/chat/completions` под одну модель — свой полный retry-бюджет
    (`OPENROUTER_MAX_RETRIES`), исчерпание которого поднимает `GenerationError` (не глотает),
    чтобы `generate_text` знал, что пора переходить к следующей модели в фолбэк-цепочке."""
    body: dict[str, object] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    if temperature is not None:
        body["temperature"] = temperature
    headers = {"Authorization": f"Bearer {api_key}"}
    last_exc: Exception | None = None
    for attempt in range(OPENROUTER_MAX_RETRIES + 1):
        if attempt > 0:
            time.sleep(OPENROUTER_RETRY_BACKOFF_SECONDS * attempt)
        try:
            response = httpx.post(
                _CHAT_COMPLETIONS_URL,
                headers=headers,
                json=body,
                timeout=OPENROUTER_TIMEOUT_SECONDS,
            )
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last_exc = exc
            continue
        if response.status_code in _RETRY_STATUS_CODES:
            last_exc = GenerationError(
                f"OpenRouter [{model}]: {response.status_code} {response.text[:300]}"
            )
            continue
        try:
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPStatusError as exc:
            raise GenerationError(f"OpenRouter [{model}]: {exc} — {response.text[:300]}") from exc
        except ValueError as exc:
            raise GenerationError(f"OpenRouter [{model}] вернул неразбираемый JSON: {exc}") from exc
        choices = payload.get("choices") if isinstance(payload, dict) else None
        message = choices[0].get("message") if isinstance(choices, list) and choices else None
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, str) or not content:
            raise GenerationError(
                f"OpenRouter [{model}] не вернул текст ответа (пустой content): {payload}"
            )
        return content
    raise GenerationError(
        f"OpenRouter [{model}]: нет ответа от {_CHAT_COMPLETIONS_URL} за "
        f"{OPENROUTER_MAX_RETRIES + 1} попыток: {last_exc}"
    )


def generate_text(
    config: OpenRouterConfig,
    system_prompt: str,
    user_prompt: str,
    *,
    temperature: float | None = None,
) -> str:
    """Одна реплика чата (OpenAI-совместимый `/chat/completions`), текст ответа.

    Сигнатура зеркалит `gigachat_client.ask_text` — замена для веток, которые звали GigaChat для
    текстовой генерации (сегодня только openscad), без переписывания вызывающего кода сверх
    самого клиента/конфига.

    Провайдерский фолбэк по моделям (не путать с retry внутри одной модели выше) — бесплатный тир
    одной модели может временно уйти в 429 целиком (`google/gemma-4-31b-it:free`, наблюдалось
    вживую 2026-07-20 при первой сквозной проверке openscad-ветки на dev.3mf.tech). CLAUDE.md зоны
    AI § «OpenRouter — Free cloud models» уже документирует ту же цепочку фолбэков для оператора —
    переиспользуем её, не изобретаем новую. Каждая модель получает свой полный retry-бюджет,
    следующая пробуется только когда текущая исчерпана.
    """
    models = [config.model, *(m for m in OPENROUTER_TEXT_MODEL_FALLBACKS if m != config.model)]
    last_exc: Exception | None = None
    for model in models:
        try:
            return _chat_completion_once(
                config.api_key, model, system_prompt, user_prompt, temperature
            )
        except GenerationError as exc:
            last_exc = exc
            continue
    raise GenerationError(f"OpenRouter: все модели ({', '.join(models)}) не ответили: {last_exc}")
