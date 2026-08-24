"""AI-обогащение подачи идеи (MF-565, docs/epics/ideas.page.md § «2.1»):
свободный текст пользователя → черновик title/body/category.

Синхронно, без generation queue (тот же выбор, что `giga.guides.draft`):
текст короткий, один вызов GigaChat, автор ждёт результат прямо в форме
подачи — обязательная деградация на стороне `apps/api` держит таймаут 5с,
здесь нет собственного бюджета времени сверх `gigachat_client` (30с/3 ретрая).

`category` — СТРОГО одно из `_CATEGORIES` (контракт `apps/api/src/ideas/
contract.ts::IDEA_CATEGORIES`, зеркалируется здесь вручную: giga не импортирует
TS-код api, а значения — часть публичного контракта, меняются редко и вместе
с этим модулем). Невалидная категория — как и пустой/слишком длинный
`title` — это `EnrichError`, а не тихая починка: молчаливая подстановка
дефолта спрятала бы от `apps/api` разницу между "giga ошиблась" и "giga
осознанно вернула other".
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

from gigachat import GigaChat

from .. import gigachat_client
from ._prompts import load_enrich_prompt

_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*\n?(.*?)```", re.DOTALL)
_MAX_FREE_TEXT_CHARS = 4_000
_TITLE_MAX_LENGTH = 120

_CATEGORIES = frozenset({"catalog", "projects", "forum", "account", "other"})


class EnrichError(Exception):
    """Провайдер GigaChat недоступен или вернул неразбираемый/невалидный ответ."""


@dataclass(frozen=True)
class IdeaDraft:
    title: str
    body: str
    category: str


def enrich_idea_draft(client: GigaChat, free_text: str) -> IdeaDraft:
    """Просит GigaChat оформить идею, возвращает провалидированный черновик.

    Пустой `title` в ответе (текст не похож на идею, см. промпт) — штатный
    исход, не ошибка: вызывающая сторона (apps/api) решает, как показать это
    автору (обычно — как отказ обогащения с предложением написать вручную).
    """
    text = free_text.strip()[:_MAX_FREE_TEXT_CHARS]
    try:
        response = gigachat_client.ask_text(client, load_enrich_prompt(), text)
    except Exception as exc:  # noqa: BLE001 — любой сбой провайдера = EnrichError
        raise EnrichError(f"GigaChat: {exc}") from exc

    payload = _parse_json(response)
    if payload is None:
        raise EnrichError(f"GigaChat вернул неразбираемый JSON: {response[:200]!r}")

    return _validate_draft(payload, response)


def _parse_json(response: str) -> dict | None:
    match = _JSON_FENCE_RE.search(response)
    candidate = match.group(1).strip() if match else response.strip()
    try:
        data = json.loads(candidate)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _validate_draft(payload: dict, raw_response: str) -> IdeaDraft:
    title = str(payload.get("title") or "").strip()
    if len(title) > _TITLE_MAX_LENGTH:
        raise EnrichError(f"GigaChat: заголовок длиннее {_TITLE_MAX_LENGTH} символов: {title!r}")

    body = str(payload.get("body") or "").strip()

    category = payload.get("category")
    if category not in _CATEGORIES:
        raise EnrichError(f"GigaChat: неизвестная категория {category!r}: {raw_response[:200]!r}")

    return IdeaDraft(title=title, body=body, category=category)
