"""HTTP-клиент RuDALL-E Coordinator для ветки текст → 3D-модель.

Coordinator асинхронный: сначала принимает запрос на ``/v3/client/generate``,
затем состояние запрашивается через ``/v3/client/get_result``. Адрес сервиса
внутренний и использует сертификат, не доступный публичному trust store, поэтому
запросы намеренно идут с ``verify=False``.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

from .branches.base import GenerationError

RUDALLE_API_URL = os.getenv("RUDALLE_API_URL", "https://rudalle-coordinator.sberdevices.ru/api/")
RUDALLE_API_TOKEN = os.getenv("RUDALLE_API_TOKEN")
RUDALLE_TIMEOUT_SECONDS = float(os.getenv("RUDALLE_TIMEOUT_SECONDS", "300"))
RUDALLE_MAX_RETRIES = int(os.getenv("RUDALLE_MAX_RETRIES", "2"))
RUDALLE_RETRY_BACKOFF_SECONDS = float(os.getenv("RUDALLE_RETRY_BACKOFF_SECONDS", "5.0"))
RUDALLE_POLL_INTERVAL_SECONDS = float(os.getenv("RUDALLE_POLL_INTERVAL_SECONDS", "10"))
RUDALLE_NUM_TARGET_FACES = int(os.getenv("RUDALLE_NUM_TARGET_FACES", "50000"))
RETRY_STATUS_CODES = (429, 500, 502, 503, 504)


@dataclass(frozen=True)
class RudalleConfig:
    api_url: str
    api_token: str
    timeout_seconds: float
    max_retries: int
    retry_backoff_seconds: float
    poll_interval_seconds: float
    num_target_faces: int


def load_config() -> RudalleConfig | None:
    """Возвращает ``None``, когда токен не задан: ветка завершается fail-closed."""
    if not RUDALLE_API_TOKEN:
        return None
    return RudalleConfig(
        api_url=RUDALLE_API_URL.rstrip("/") + "/",
        api_token=RUDALLE_API_TOKEN,
        timeout_seconds=RUDALLE_TIMEOUT_SECONDS,
        max_retries=RUDALLE_MAX_RETRIES,
        retry_backoff_seconds=RUDALLE_RETRY_BACKOFF_SECONDS,
        poll_interval_seconds=RUDALLE_POLL_INTERVAL_SECONDS,
        num_target_faces=RUDALLE_NUM_TARGET_FACES,
    )


def _headers(config: RudalleConfig) -> dict[str, str]:
    return {"Authorization": f"Bearer {config.api_token}", "Content-Type": "application/json"}


def _post_json(config: RudalleConfig, path: str, body: dict[str, object]) -> dict[str, object]:
    """POST с bounded retry только для временных ошибок сети и HTTP."""
    last_error: Exception | None = None
    for attempt in range(config.max_retries + 1):
        if attempt > 0:
            time.sleep(config.retry_backoff_seconds * attempt)
        try:
            with httpx.Client(verify=False, timeout=config.timeout_seconds) as client:
                response = client.post(
                    f"{config.api_url}{path}",
                    headers=_headers(config),
                    json=body,
                )
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last_error = exc
            continue
        if response.status_code in RETRY_STATUS_CODES:
            last_error = GenerationError(f"RuDALL-E: {response.status_code} {response.text[:300]}")
            continue
        try:
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPStatusError as exc:
            raise GenerationError(f"RuDALL-E: {exc} — {response.text[:300]}") from exc
        except ValueError as exc:
            raise GenerationError(f"RuDALL-E вернул неразбираемый JSON: {exc}") from exc
        if not isinstance(payload, dict):
            raise GenerationError("RuDALL-E вернул JSON не в формате объекта")
        return payload
    raise GenerationError(
        f"RuDALL-E: нет ответа от {config.api_url}{path} за "
        f"{config.max_retries + 1} попыток: {last_error}"
    )


def _result_url(payload: dict[str, object]) -> str:
    results = payload.get("results")
    if not isinstance(results, list):
        raise GenerationError("RuDALL-E: готовый ответ не содержит results")
    candidates: list[tuple[str, str]] = []
    for result in results:
        if not isinstance(result, dict) or result.get("type") != "model_3d":
            continue
        url = result.get("url")
        if isinstance(url, str) and url:
            candidates.append((url, urlparse(url).path.lower()))
    for extension in (".glb", ".obj"):
        found = next((url for url, path in candidates if path.endswith(extension)), None)
        if found is not None:
            return found
    raise GenerationError("RuDALL-E: в results нет model_3d в формате GLB или OBJ")


def _download(url: str) -> bytes:
    last_error: Exception | None = None
    for attempt in range(RUDALLE_MAX_RETRIES + 1):
        if attempt > 0:
            time.sleep(RUDALLE_RETRY_BACKOFF_SECONDS * attempt)
        try:
            with httpx.Client(verify=False, timeout=RUDALLE_TIMEOUT_SECONDS) as client:
                response = client.get(url)
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last_error = exc
            continue
        if response.status_code in RETRY_STATUS_CODES:
            last_error = GenerationError(
                f"RuDALL-E model download: {response.status_code} "
                f"{response.text[:300]}"
            )
            continue
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise GenerationError(
                f"RuDALL-E не отдал 3D-файл: {exc} — {response.text[:300]}"
            ) from exc
        if not response.content:
            raise GenerationError("RuDALL-E вернул пустой 3D-файл")
        return response.content
    raise GenerationError(
        f"RuDALL-E: не удалось скачать 3D-файл за {RUDALLE_MAX_RETRIES + 1} попыток: {last_error}"
    )


def generate_3d(config: RudalleConfig, prompt: str, trace_id: str) -> bytes:
    """Создаёт 3D-задачу, ожидает результат и скачивает GLB либо OBJ fallback."""
    submitted = _post_json(
        config,
        "v3/client/generate",
        {
            "trace_id": trace_id,
            "mode": "xr:3d",
            "query": prompt,
            "model_params": {
                "no_texture": False,
                "do_quadrification": False,
                "create_lod": 0,
                "num_target_faces": config.num_target_faces,
            },
        },
    )
    query_id = submitted.get("query_id")
    if not isinstance(query_id, str) or not query_id:
        raise GenerationError("RuDALL-E: generate не вернул query_id")

    deadline = time.monotonic() + config.timeout_seconds
    while True:
        if time.monotonic() >= deadline:
            raise GenerationError(f"RuDALL-E: генерация {query_id} не уложилась в timeout")
        result = _post_json(config, "v3/client/get_result", {"query_id": query_id})
        status = result.get("status")
        if status == "ready":
            return _download(_result_url(result))
        if status == "cancelled":
            reason = result.get("cancel_reason")
            raise GenerationError(
                f"RuDALL-E отменил генерацию {query_id}: {reason or 'без причины'}"
            )
        if status != "pending":
            raise GenerationError(f"RuDALL-E вернул неизвестный статус для {query_id}: {status!r}")
        time.sleep(min(config.poll_interval_seconds, max(deadline - time.monotonic(), 0)))
