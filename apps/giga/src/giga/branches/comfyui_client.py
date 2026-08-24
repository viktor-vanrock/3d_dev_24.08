"""HTTP-клиент к ComfyUI + TRELLIS.2 (слот 3, порт 8188, HYPERPC, `docs/process/
hyperpc.local.llm.md`) — ветка `trellis` (MF-2001).

Паттерн — тот же, что `assistant/hyperpc_client.py`: адрес только из env
(`COMFYUI_URL`), никогда не хардкодим IP/порт в коде; retry различает
таймаут/обрыв сети (retryable) и ответ-но-не-то (не retryable).

Особенность именно этого провайдера — подтверждена живым smoke-test'ом на
100.74.48.83:8188 при подготовке этой ветки (MF-2001), не догадка:
`Trellis2ExportTrimesh` (нода из `ComfyUI-TRELLIS2`, см. исходник на GitHub)
пишет GLB прямо в output-директорию ComfyUI под именем
`{filename_prefix}_{YYYYmmdd_HHMMSS}.{ext}`, где таймстемп — ЛОКАЛЬНОЕ время
машины (`datetime.now()`, не UTC), и НЕ возвращает `ui`-payload — то есть
`/history/{prompt_id}["outputs"]` для этой ноды всегда пуст, путь к файлу
через API узнать нельзя. Единственный способ забрать байты — знать
filename_prefix (мы его генерируем сами) и подобрать таймстемп в окне вокруг
времени выполнения (`_locate_export`). Живой прогон показал машину в MSK
(UTC+3, без DST в России) — пробуем это смещение первым, но не жёстко:
если машину когда-нибудь переведут в другой часовой пояс, откатываемся на
более широкий перебор (`_FALLBACK_OFFSET_HOURS`).
"""

from __future__ import annotations

import logging
import os
import re
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import httpx

logger = logging.getLogger("giga.branches.comfyui_client")

COMFYUI_TIMEOUT_SECONDS = float(os.getenv("COMFYUI_TIMEOUT_SECONDS", "20"))
COMFYUI_MAX_RETRIES = int(os.getenv("COMFYUI_MAX_RETRIES", "2"))
COMFYUI_RETRY_BACKOFF_SECONDS = float(os.getenv("COMFYUI_RETRY_BACKOFF_SECONDS", "0.5"))
COMFYUI_POLL_INTERVAL_SECONDS = float(os.getenv("COMFYUI_POLL_INTERVAL_SECONDS", "3"))
COMFYUI_POLL_TIMEOUT_SECONDS = float(os.getenv("COMFYUI_POLL_TIMEOUT_SECONDS", "300"))
# MF-2067: Z-Image-Turbo и TRELLIS.2 делят один физический GPU (RTX 3090 #2,
# `docs/process/hyperpc.local.llm.md`) — VRAM-исчерпание одного графа, пока
# другой ещё не выгрузил модели, честный transient (карта освободится), не
# структурная ошибка графа. Bounded retry той же submit+wait пары, не
# бесконечный — см. `ComfyUIResourceExhaustedError`/`submit_and_wait_with_retry`.
COMFYUI_OOM_MAX_RETRIES = int(os.getenv("COMFYUI_OOM_MAX_RETRIES", "1"))
COMFYUI_OOM_RETRY_BACKOFF_SECONDS = float(os.getenv("COMFYUI_OOM_RETRY_BACKOFF_SECONDS", "5.0"))
# Смещение часового пояса машины HYPERPC относительно UTC — калиброванное живым
# прогоном (MSK, UTC+3), не хардкод-на-всю-жизнь: переопределяется env, если
# машину переставят в другой часовой пояс, без деплоя кода.
COMFYUI_EXPORT_TZ_OFFSET_HOURS = float(os.getenv("COMFYUI_EXPORT_TZ_OFFSET_HOURS", "3"))

_SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9_]+$")
# Подстроки реальных CUDA/PyTorch OOM-сообщений (`RuntimeError: CUDA out of
# memory`/`torch.cuda.OutOfMemoryError`) — ищем без учёта регистра по всему
# сериализованному `status`, т.к. ComfyUI кладёт текст исключения в разные
# поля (`messages`/`exception_message`) в зависимости от версии ноды.
_OOM_MARKERS = ("out of memory", "outofmemoryerror", "cuda error: out of")
# Более широкий перебор смещений на случай, если калиброванное значение перестало
# совпадать (машину переставили) — все стандартные целые/получасовые пояса.
_FALLBACK_OFFSET_HOURS = [h / 2 for h in range(-24, 29)]
_EXPORT_SEARCH_MARGIN_SECONDS = 8


class ComfyUIError(Exception):
    """Базовая ошибка вызова ComfyUI."""


class ComfyUITimeoutError(ComfyUIError):
    """Сеть недоступна/не успела ответить — retryable (см. `hyperpc_client.py`)."""


class ComfyUIInvalidResponseError(ComfyUIError):
    """ComfyUI ответил (сеть жива), но провалил валидацию/вернул не то — не
    retryable, повтор того же графа с тем же телом не даст другого результата."""


class ComfyUIOutputNotFoundError(ComfyUIError):
    """Job завершился успешно, но файл артефакта не нашёлся в ожидаемом окне —
    см. докстринг модуля про причину (нода не регистрирует вывод в history)."""


class ComfyUIResourceExhaustedError(ComfyUIError):
    """GPU/VRAM исчерпан (OOM) на общей карте (MF-2067, см. константы выше) —
    retryable с паузой на новый submit+wait, тот же граф отработает, когда
    карта освободится; не структурная ошибка графа (в отличие от прочих
    `status_str != "success"`, которые `ComfyUIInvalidResponseError`)."""


@dataclass(frozen=True)
class ComfyUIConfig:
    base_url: str
    timeout_seconds: float
    max_retries: int
    retry_backoff_seconds: float
    poll_interval_seconds: float
    poll_timeout_seconds: float
    export_tz_offset_hours: float
    oom_max_retries: int = COMFYUI_OOM_MAX_RETRIES
    oom_retry_backoff_seconds: float = COMFYUI_OOM_RETRY_BACKOFF_SECONDS


def load_config() -> ComfyUIConfig | None:
    """`None`, если `COMFYUI_URL` не задан — вызывающая ветка деградирует в
    честный `GenerationError`, не крашится (тот же паттерн, что
    `hyperpc_client.load_config`/`gigachat_client.load_client`)."""
    base_url = os.getenv("COMFYUI_URL")
    if not base_url:
        return None
    return ComfyUIConfig(
        base_url=base_url.rstrip("/"),
        timeout_seconds=COMFYUI_TIMEOUT_SECONDS,
        max_retries=COMFYUI_MAX_RETRIES,
        retry_backoff_seconds=COMFYUI_RETRY_BACKOFF_SECONDS,
        poll_interval_seconds=COMFYUI_POLL_INTERVAL_SECONDS,
        poll_timeout_seconds=COMFYUI_POLL_TIMEOUT_SECONDS,
        export_tz_offset_hours=COMFYUI_EXPORT_TZ_OFFSET_HOURS,
        oom_max_retries=COMFYUI_OOM_MAX_RETRIES,
        oom_retry_backoff_seconds=COMFYUI_OOM_RETRY_BACKOFF_SECONDS,
    )


def _require_safe_name(value: str, *, what: str) -> str:
    """Отбрасывает всё, что не голое `[A-Za-z0-9_]+` — filename_prefix и любые
    имена файлов, которые мы шлём в ComfyUI/`/view`, ВСЕГДА генерируем сами
    (job.id-хэш, uuid), никогда не пропускаем клиентский текст напрямую сюда —
    так path traversal/инъекция в имя файла структурно невозможны."""
    if not _SAFE_NAME_RE.fullmatch(value):
        raise ComfyUIError(f"internal: небезопасное имя для {what}: {value!r}")
    return value


def _post_json(config: ComfyUIConfig, path: str, body: dict) -> dict:
    last_exc: Exception | None = None
    for attempt in range(config.max_retries + 1):
        if attempt > 0:
            time.sleep(config.retry_backoff_seconds * attempt)
        try:
            response = httpx.post(
                f"{config.base_url}{path}", json=body, timeout=config.timeout_seconds
            )
        except httpx.TimeoutException as exc:
            last_exc = exc
            continue
        except httpx.TransportError as exc:
            last_exc = exc
            continue
        if response.status_code == 400:
            # Провал валидации графа (несовместимые типы нод, значение вне
            # диапазона) — ComfyUI отвечает сразу, до постановки в очередь GPU;
            # не retryable, тот же граф снова провалится так же.
            raise ComfyUIInvalidResponseError(f"ComfyUI отклонил граф: {response.text[:500]}")
        try:
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as exc:
            raise ComfyUIInvalidResponseError(f"ComfyUI: {exc}") from exc
        except ValueError as exc:
            raise ComfyUIInvalidResponseError(f"ComfyUI вернул неразбираемый JSON: {exc}") from exc
    raise ComfyUITimeoutError(
        f"ComfyUI: нет ответа от {config.base_url}{path} за "
        f"{config.max_retries + 1} попыток: {last_exc}"
    )


def upload_image(config: ComfyUIConfig, content: bytes, content_type: str) -> str:
    """Заливает байты в `input/` ComfyUI и возвращает имя файла, под которым
    ComfyUI его сохранил. Имя генерируем сами (uuid4) — байты и content_type
    клиентские (сгенерированы GigaChat), но ИМЯ файла никогда не приходит от
    вызывающей стороны, так что путь к файлу на диске ComfyUI не подделать."""
    ext = "png" if "png" in content_type else "jpg"
    upload_name = f"giga_{uuid.uuid4().hex}.{ext}"
    last_exc: Exception | None = None
    for attempt in range(config.max_retries + 1):
        if attempt > 0:
            time.sleep(config.retry_backoff_seconds * attempt)
        try:
            response = httpx.post(
                f"{config.base_url}/upload/image",
                files={"image": (upload_name, content, content_type)},
                data={"overwrite": "false"},
                timeout=config.timeout_seconds,
            )
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last_exc = exc
            continue
        try:
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPStatusError as exc:
            raise ComfyUIInvalidResponseError(f"ComfyUI upload: {exc}") from exc
        except ValueError as exc:
            raise ComfyUIInvalidResponseError(f"ComfyUI upload вернул не JSON: {exc}") from exc
        name = payload.get("name") if isinstance(payload, dict) else None
        if not isinstance(name, str) or not name:
            raise ComfyUIInvalidResponseError("ComfyUI upload не вернул имя файла")
        subfolder = payload.get("subfolder") if isinstance(payload, dict) else None
        return f"{subfolder}/{name}" if subfolder else name
    raise ComfyUITimeoutError(
        f"ComfyUI: upload/image не ответил за {config.max_retries + 1} попыток: {last_exc}"
    )


def submit_prompt(config: ComfyUIConfig, workflow: dict) -> str:
    """POST /prompt — ставит граф в очередь, возвращает `prompt_id`."""
    body = {"prompt": workflow, "client_id": uuid.uuid4().hex}
    payload = _post_json(config, "/prompt", body)
    prompt_id = payload.get("prompt_id") if isinstance(payload, dict) else None
    node_errors = payload.get("node_errors") if isinstance(payload, dict) else None
    if node_errors:
        raise ComfyUIInvalidResponseError(f"ComfyUI: ошибки нод графа: {node_errors}")
    if not isinstance(prompt_id, str) or not prompt_id:
        raise ComfyUIInvalidResponseError(f"ComfyUI /prompt не вернул prompt_id: {payload}")
    return prompt_id


def _is_oom_status(status: dict) -> bool:
    text = str(status).lower()
    return any(marker in text for marker in _OOM_MARKERS)


def wait_for_completion(
    config: ComfyUIConfig,
    prompt_id: str,
    *,
    on_tick: Callable[[float], None] | None = None,
) -> dict:
    """Поллинг `/history/{prompt_id}` до `status.completed` или общего
    таймаута `poll_timeout_seconds` (весь бюджет одной генерации).

    `on_tick(elapsed_seconds)` — опциональный колбэк на каждый тик (MF-2001,
    прогресс для api). Честная оговорка: `/history/{id}` у ЭТОГО ComfyUI
    пуст, пока job не завершится целиком (проверено живым смоук-тестом —
    поллинг во время выполнения возвращал пустой ответ) — какая именно нода
    исполняется прямо сейчас, по HTTP-поллингу не узнать без вебсокета
    (`/ws`, не реализован). `on_tick` поэтому даёт только elapsed — вызывающая
    сторона (trellis.py) строит грубую time-based оценку phase/progress/eta,
    не honest per-node прогресс. Точный прогресс — отдельная карточка при
    первом реальном запросе на точность."""
    deadline = time.monotonic() + config.poll_timeout_seconds
    started_at = time.monotonic()
    while True:
        try:
            response = httpx.get(
                f"{config.base_url}/history/{prompt_id}", timeout=config.timeout_seconds
            )
            response.raise_for_status()
            history = response.json()
        except (httpx.HTTPError, ValueError):
            history = None
        entry = history.get(prompt_id) if isinstance(history, dict) else None
        if entry is not None:
            status = entry.get("status", {})
            if status.get("completed"):
                if status.get("status_str") != "success":
                    if _is_oom_status(status):
                        raise ComfyUIResourceExhaustedError(
                            f"ComfyUI: OOM на общей карте: {status}"
                        )
                    raise ComfyUIInvalidResponseError(
                        f"ComfyUI: генерация завершилась ошибкой: {status}"
                    )
                return entry
        if on_tick is not None:
            on_tick(time.monotonic() - started_at)
        if time.monotonic() >= deadline:
            raise ComfyUITimeoutError(
                f"ComfyUI: job {prompt_id} не завершился за {config.poll_timeout_seconds:.0f}с"
            )
        time.sleep(config.poll_interval_seconds)


def fetch_view(
    config: ComfyUIConfig, filename: str, *, file_type: str = "output", subfolder: str = ""
) -> bytes | None:
    """GET /view — None на 404 (файла ещё/уже нет), бросает на прочих ошибках."""
    params = {"filename": filename, "type": file_type}
    if subfolder:
        params["subfolder"] = subfolder
    try:
        response = httpx.get(
            f"{config.base_url}/view",
            params=params,
            timeout=config.timeout_seconds,
        )
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        raise ComfyUITimeoutError(f"ComfyUI /view: {exc}") from exc
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return response.content


def extract_saved_images(history_entry: dict, node_id: str) -> list[tuple[str, str]]:
    """`(filename, subfolder)` для каждого файла, который обычный `SaveImage`
    зарегистрировал в `history[prompt_id]["outputs"][node_id]["images"]` — в
    отличие от `Trellis2ExportTrimesh` (см. `locate_export`), стандартные
    ноды ComfyUI честно кладут `filename`/`subfolder`/`type` в history,
    поэтому угадывать таймстемп на диске не нужно."""
    outputs = history_entry.get("outputs") if isinstance(history_entry, dict) else None
    node_output = outputs.get(node_id) if isinstance(outputs, dict) else None
    images = node_output.get("images") if isinstance(node_output, dict) else None
    if not isinstance(images, list):
        return []
    results: list[tuple[str, str]] = []
    for image in images:
        if not isinstance(image, dict):
            continue
        filename = image.get("filename")
        if not isinstance(filename, str) or not filename:
            continue
        subfolder = image.get("subfolder")
        results.append((filename, subfolder if isinstance(subfolder, str) else ""))
    return results


def _candidate_filenames(
    prefix: str, file_format: str, submitted_at: float, completed_at: float, offset_hours: float
) -> list[str]:
    start = datetime.fromtimestamp(
        submitted_at - _EXPORT_SEARCH_MARGIN_SECONDS, tz=UTC
    ) + timedelta(hours=offset_hours)
    end = datetime.fromtimestamp(completed_at + _EXPORT_SEARCH_MARGIN_SECONDS, tz=UTC) + timedelta(
        hours=offset_hours
    )
    names = []
    cursor = start
    while cursor <= end:
        names.append(f"{prefix}_{cursor.strftime('%Y%m%d_%H%M%S')}.{file_format}")
        cursor += timedelta(seconds=1)
    return names


def locate_export(
    config: ComfyUIConfig,
    *,
    filename_prefix: str,
    file_format: str,
    submitted_at: float,
    completed_at: float,
) -> bytes:
    """Находит и скачивает файл, который `Trellis2ExportTrimesh` записал на
    диск (см. докстринг модуля — история/`ui` его не регистрируют). Сначала
    пробуем калиброванное смещение (`export_tz_offset_hours`, по умолчанию
    MSK), затем — при промахе — более широкий перебор часовых поясов."""
    _require_safe_name(filename_prefix, what="filename_prefix")
    for names in (
        _candidate_filenames(
            filename_prefix, file_format, submitted_at, completed_at, config.export_tz_offset_hours
        ),
        [
            name
            for offset in _FALLBACK_OFFSET_HOURS
            if offset != config.export_tz_offset_hours
            for name in _candidate_filenames(
                filename_prefix, file_format, submitted_at, completed_at, offset
            )
        ],
    ):
        for name in names:
            content = fetch_view(config, name, file_type="output")
            if content is not None:
                return content
    raise ComfyUIOutputNotFoundError(
        f"ComfyUI: не нашли выходной файл для префикса {filename_prefix!r} "
        f"(ExportTrimesh не регистрирует вывод в history — см. докстринг модуля)"
    )


def submit_and_wait_with_retry(
    config: ComfyUIConfig,
    workflow: dict,
    *,
    on_tick: Callable[[float], None] | None = None,
    max_oom_retries: int | None = None,
    retry_backoff_seconds: float | None = None,
) -> dict:
    """`submit_prompt` + `wait_for_completion` с bounded retry ТОЛЬКО на OOM
    (MF-2067: «bounded retry и queued/429 вместо OOM» — Z-Image-Turbo и
    TRELLIS.2 делят одну карту, временная нехватка VRAM — не структурная
    ошибка графа). Каждая попытка — новый `submit_prompt` (новый `prompt_id`),
    не повторный поллинг того же job'а. Прочие ошибки (валидация графа,
    таймаут, сеть) здесь не ретраятся — у них уже свои профили retry
    (`_post_json`/`submit_prompt`), повтор того же запроса не даст другого
    результата.

    Лимит/пауза retry — из `config` по умолчанию (`oom_max_retries`/
    `oom_retry_backoff_seconds`, тот же приём, что остальные тайминги этого
    клиента), явные kwargs — только для точечного переопределения (тесты)."""
    retries = config.oom_max_retries if max_oom_retries is None else max_oom_retries
    backoff = (
        config.oom_retry_backoff_seconds if retry_backoff_seconds is None else retry_backoff_seconds
    )
    last_exc: ComfyUIResourceExhaustedError | None = None
    for attempt in range(retries + 1):
        if attempt > 0:
            logger.warning(
                "ComfyUI: OOM на попытке %d/%d, жду %.1fс перед повтором: %s",
                attempt,
                retries,
                backoff,
                last_exc,
            )
            time.sleep(backoff)
        prompt_id = submit_prompt(config, workflow)
        try:
            return wait_for_completion(config, prompt_id, on_tick=on_tick)
        except ComfyUIResourceExhaustedError as exc:
            last_exc = exc
            continue
    assert last_exc is not None  # цикл всегда либо возвращает, либо здесь после ≥1 попытки
    raise last_exc
