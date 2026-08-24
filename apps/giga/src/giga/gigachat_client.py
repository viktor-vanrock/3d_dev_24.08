"""Тонкая обёртка над официальным SDK `gigachat` для веток генерации (MF-352).

Один клиент на два режима: обычный чат-ответ (ветка openscad — просим
GigaCode-скрипт) и генерация картинки (ветки kzd/hueforge — GigaChat умеет
рисовать через встроенный Kandinsky: просишь нарисовать, в ответе приходит
`<img src="FILE_ID" .../>`, картинка достаётся отдельным вызовом
`get_image(file_id)`, см. `gigachat.GigaChat.get_image`).

Без `GIGACHAT_CREDENTIALS` — `load_client()` возвращает `None` (тот же
паттерн, что `config.load_s3_config`/`load_worker_config`: сервис не падает,
конкретная генерация уходит в `status=error`, а не роняет воркер).
"""

from __future__ import annotations

import base64
import binascii
import os
import re

from gigachat import GigaChat
from gigachat.exceptions import GigaChatException
from gigachat.models import Chat, Messages, MessagesRole

from .branches.base import GenerationError

# Явные сетевые параметры общего клиента: SDK по умолчанию имеет timeout=30,
# но max_retries=0. Для Embeddings и генеративных веток нужен один и тот же
# ограниченный retry-профиль, иначе временный 5xx/429 превращается в ошибку job.
GIGACHAT_TIMEOUT_SECONDS = 30.0
GIGACHAT_MAX_RETRIES = 3
GIGACHAT_RETRY_BACKOFF_SECONDS = 0.5
GIGACHAT_RETRY_STATUS_CODES = (429, 500, 502, 503, 504)

# GigaChat вставляет сгенерированную картинку тегом вида
# `<img src="a1b2c3d4-..." fuse="true"/>` в текст ответа.
_IMG_TAG_RE = re.compile(r'<img\s+src="([^"]+)"')


def load_client() -> GigaChat | None:
    """Собирает клиент из `GIGACHAT_CREDENTIALS`. `None`, если креды не заданы."""
    if not os.getenv("GIGACHAT_CREDENTIALS"):
        return None
    return GigaChat(
        timeout=GIGACHAT_TIMEOUT_SECONDS,
        max_retries=GIGACHAT_MAX_RETRIES,
        retry_backoff_factor=GIGACHAT_RETRY_BACKOFF_SECONDS,
        retry_on_status_codes=GIGACHAT_RETRY_STATUS_CODES,
        verify_ssl_certs=False,
    )


def ask_text(
    client: GigaChat, system_prompt: str, user_prompt: str, *, temperature: float | None = None
) -> str:
    """Одна реплика чата, возвращает текст ответа. Ошибки провайдера → GenerationError.

    `temperature` — опционально, по умолчанию `None` (поведение SDK/сервера
    не меняется, все существующие вызывающие ветки нетронуты). Слайсер-AI
    (MF-1941) передаёт `0.0` — CLAUDE.md зоны требует детерминизм там, где
    он возможен, для дельт настроек печати это осмысленно (не для
    творческих веток generation/ideas, которые temperature не передают).
    """
    chat = Chat(
        messages=[
            Messages(role=MessagesRole.SYSTEM, content=system_prompt),
            Messages(role=MessagesRole.USER, content=user_prompt),
        ],
        **({"temperature": temperature} if temperature is not None else {}),
    )
    try:
        completion = client.chat(chat)
    except GigaChatException as exc:
        raise GenerationError(f"GigaChat: {exc}") from exc
    if not completion.choices:
        raise GenerationError("GigaChat вернул пустой ответ (нет choices)")
    return completion.choices[0].message.content


def ask_image(client: GigaChat, system_prompt: str, user_prompt: str) -> bytes:
    """Просит GigaChat нарисовать картинку, возвращает PNG-байты.

    GigaChat решает сам, рисовать ли (это не отдельный API, а поведение
    модели на "нарисуй ..."-промпты) — если тега `<img>` в ответе нет,
    считаем это отказом провайдера и падаем в GenerationError, чтобы
    воркер перевёл job в status=error, а не молча вернул текст как картинку.
    """
    content = ask_text(client, system_prompt, user_prompt)
    match = _IMG_TAG_RE.search(content)
    if match is None:
        raise GenerationError(f"GigaChat не вернул изображение: {content[:200]!r}")
    file_id = match.group(1)
    try:
        image = client.get_image(file_id)
    except GigaChatException as exc:
        raise GenerationError(
            f"GigaChat: не удалось получить изображение {file_id}: {exc}"
        ) from exc
    try:
        return base64.b64decode(image.content, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise GenerationError(f"GigaChat: битый base64 изображения {file_id}: {exc}") from exc
