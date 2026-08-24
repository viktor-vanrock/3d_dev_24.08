"""HTTP-клиент к локальным LLM-слотам HYPERPC (`docs/process/hyperpc.local.llm.md`,
MF-2002 — Tailscale-периметр).

Ничего не хардкодим: ни URL, ни порт, ни имя модели. Причина не абстрактная —
`docs/process/hyperpc.local.llm.md` в этом самом репо расходился с операторской
памятью по порту слота 1 (:1234 vs :1236, слот переехал на Qwen3.6-35B-A3B, см.
`docs/process/hyperpc.local.llm.md` §"Слот 1 заменена"); единственный источник
истины на рантайме — health/model discovery (`GET /v1/models`) по URL из env.

Две роли слотов, не взаимозаменяемые (см. докстринг метода `chat_structured`/
`chat_fast` и таблицу "4 слота" в доке):
- structured — слот с tool calling (сейчас слот 1) — ЕДИНСТВЕННЫЙ, которому
  `router.py` вправе доверить строгий JSON-контракт маршрутизации.
- fast — слот 2 (gemma), БЕЗ tool calling/JSON-надёжности по тому же доку;
  этот клиент физически не даёт использовать его для structured-вызова
  (`chat_fast` не принимает JSON-контракт, только текст).
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any

import httpx

HYPERPC_TIMEOUT_SECONDS = float(os.getenv("HYPERPC_TIMEOUT_SECONDS", "20"))
HYPERPC_MAX_RETRIES = int(os.getenv("HYPERPC_MAX_RETRIES", "2"))
HYPERPC_RETRY_BACKOFF_SECONDS = float(os.getenv("HYPERPC_RETRY_BACKOFF_SECONDS", "0.5"))


class HyperpcError(Exception):
    """Базовая ошибка вызова HYPERPC."""


class HyperpcTimeoutError(HyperpcError):
    """Сеть недоступна/не успела ответить за бюджет попыток — retryable

    (см. `router.py`: заворачивается в `AssistantError(code="provider_timeout",
    retryable=True)` — стабильный, предсказуемый результат для вызывающей
    стороны, а не голое исключение)."""


class HyperpcInvalidResponseError(HyperpcError):
    """Слот ответил (сеть жива), но не тем, что просили — пустой/битый ответ.
    НЕ retryable сама по себе: повтор того же запроса тому же слоту с тем же
    промптом маловероятно даст другой результат (в отличие от таймаута)."""


@dataclass(frozen=True)
class HyperpcConfig:
    structured_url: str
    fast_url: str | None
    timeout_seconds: float
    max_retries: int
    retry_backoff_seconds: float


def load_config() -> HyperpcConfig | None:
    """Собирает конфиг из env. `None`, если structured-слот не задан —
    `router.py` деградирует в честный no-op (тот же паттерн, что
    `gigachat_client.load_client`/`config.load_s3_config`), не падает."""
    structured_url = os.getenv("HYPERPC_STRUCTURED_URL")
    if not structured_url:
        return None
    fast_url = os.getenv("HYPERPC_FAST_URL")
    return HyperpcConfig(
        structured_url=structured_url.rstrip("/"),
        fast_url=fast_url.rstrip("/") if fast_url else None,
        timeout_seconds=HYPERPC_TIMEOUT_SECONDS,
        max_retries=HYPERPC_MAX_RETRIES,
        retry_backoff_seconds=HYPERPC_RETRY_BACKOFF_SECONDS,
    )


def load_fast_config() -> HyperpcConfig | None:
    """Конфиг только для дешёвых текстовых задач Gemma.

    В отличие от `load_config()` не требует structured-слот: prompt-variants не использует
    tool calling и не должен зависеть от дорогого маршрутизатора. Поле `structured_url`
    заполняется тем же адресом только ради общей dataclass; `chat_fast()` его не читает.
    """
    fast_url = os.getenv("HYPERPC_FAST_URL")
    if not fast_url:
        return None
    normalized = fast_url.rstrip("/")
    return HyperpcConfig(
        structured_url=normalized,
        fast_url=normalized,
        timeout_seconds=HYPERPC_TIMEOUT_SECONDS,
        max_retries=HYPERPC_MAX_RETRIES,
        retry_backoff_seconds=HYPERPC_RETRY_BACKOFF_SECONDS,
    )


def health_check(base_url: str, *, timeout_seconds: float = HYPERPC_TIMEOUT_SECONDS) -> bool:
    """Слоты 1/2 — сырой `llama-server`, без `/health` (только слот 4 его отдаёт
    по доку); "модели видны на `/v1/models`" — рабочий эквивалент здоровья.
    Никогда не бросает — любой сбой сети/статуса это просто `False`."""
    try:
        response = httpx.get(f"{base_url}/v1/models", timeout=timeout_seconds)
        return response.status_code == 200
    except httpx.HTTPError:
        return False


def discover_model(
    base_url: str, *, timeout_seconds: float = HYPERPC_TIMEOUT_SECONDS
) -> str | None:
    """Читает первый `id` из `/v1/models`. Сырой `llama-server` отдаёт модель
    полным Windows-путём до `.gguf` (см. доку) — имя ни в коем случае не
    хардкодим, берём с рантайма на каждый вызов маршрутизации."""
    try:
        response = httpx.get(f"{base_url}/v1/models", timeout=timeout_seconds)
        response.raise_for_status()
        data = response.json()
    except (httpx.HTTPError, ValueError):
        return None
    models = data.get("data") if isinstance(data, dict) else None
    if not isinstance(models, list) or not models:
        return None
    first = models[0]
    model_id = first.get("id") if isinstance(first, dict) else None
    return model_id if isinstance(model_id, str) and model_id else None


def _post_chat(
    base_url: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    *,
    timeout_seconds: float,
    max_retries: int,
    retry_backoff_seconds: float,
    temperature: float,
    max_tokens: int,
    disable_thinking: bool,
) -> str:
    body: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if disable_thinking:
        # Плоское `enable_thinking` верхнего уровня НЕ работает на слоте 1 —
        # задокументированная грабля (docs/process/hyperpc.local.llm.md), модель
        # молча продолжает думать; нужна именно эта вложенная форма.
        body["chat_template_kwargs"] = {"enable_thinking": False}

    last_exc: Exception | None = None
    for attempt in range(max_retries + 1):
        if attempt > 0:
            time.sleep(retry_backoff_seconds * attempt)
        try:
            response = httpx.post(
                f"{base_url}/v1/chat/completions", json=body, timeout=timeout_seconds
            )
        except httpx.TimeoutException as exc:
            last_exc = exc
            continue
        except httpx.TransportError as exc:
            # HYPERPC недоступен по Tailscale (ребут/сеть) — тот же retryable
            # бюджет, что таймаут: с точки зрения вызывающей стороны оба
            # случая означают "провайдер сейчас не отвечает".
            last_exc = exc
            continue
        try:
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPStatusError as exc:
            raise HyperpcInvalidResponseError(f"HYPERPC: {exc}") from exc
        except ValueError as exc:
            raise HyperpcInvalidResponseError(f"HYPERPC вернул неразбираемый JSON: {exc}") from exc
        choices = payload.get("choices") if isinstance(payload, dict) else None
        if not choices:
            raise HyperpcInvalidResponseError("HYPERPC вернул пустой ответ (нет choices)")
        first_choice = choices[0] if isinstance(choices[0], dict) else {}
        content = first_choice.get("message", {}).get("content")
        if not isinstance(content, str) or not content.strip():
            raise HyperpcInvalidResponseError("HYPERPC вернул пустой content")
        return content
    raise HyperpcTimeoutError(
        f"HYPERPC: нет ответа от {base_url} за {max_retries + 1} попыток: {last_exc}"
    )


def chat_structured(
    config: HyperpcConfig,
    system_prompt: str,
    user_prompt: str,
    *,
    max_tokens: int = 1024,
) -> str:
    """Единственный слот, которому `router.py` вправе доверить строгий JSON.
    `temperature=0.0` — детерминизм маршрутизации (CLAUDE.md зоны AI § «Детерминизм
    где возможно»); reasoning выключен — JSON-контракту он не помогает, только
    тратит токен/время-бюджет."""
    model = discover_model(config.structured_url, timeout_seconds=config.timeout_seconds)
    if model is None:
        raise HyperpcInvalidResponseError(
            f"HYPERPC: не удалось определить модель на {config.structured_url}/v1/models"
        )
    return _post_chat(
        config.structured_url,
        model,
        system_prompt,
        user_prompt,
        timeout_seconds=config.timeout_seconds,
        max_retries=config.max_retries,
        retry_backoff_seconds=config.retry_backoff_seconds,
        temperature=0.0,
        max_tokens=max_tokens,
        disable_thinking=True,
    )


def chat_fast(
    config: HyperpcConfig,
    system_prompt: str,
    user_prompt: str,
    *,
    max_tokens: int = 512,
    temperature: float = 0.2,
) -> str:
    """Слот 2 — только текст, без tool calling/JSON-гарантий. `router.py` эту
    функцию не вызывает для маршрутизации (см. докстринг модуля)."""
    if config.fast_url is None:
        raise HyperpcInvalidResponseError("HYPERPC_FAST_URL не сконфигурирован")
    model = discover_model(config.fast_url, timeout_seconds=config.timeout_seconds)
    if model is None:
        raise HyperpcInvalidResponseError(
            f"HYPERPC: не удалось определить модель на {config.fast_url}/v1/models"
        )
    return _post_chat(
        config.fast_url,
        model,
        system_prompt,
        user_prompt,
        timeout_seconds=config.timeout_seconds,
        max_retries=config.max_retries,
        retry_backoff_seconds=config.retry_backoff_seconds,
        temperature=temperature,
        max_tokens=max_tokens,
        disable_thinking=False,
    )
