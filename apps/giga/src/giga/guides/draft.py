"""LLM-черновик шагов гайда сборки из текста инструкции/BOM (MF-1007).

Переиспользует существующий сервис `giga` (клиент/промпт-паттерн — как
`giga.catalog.extract`), отдельного AI-контура не заводит. Автор загружает
текст в редакторе (`apps/api` эндпоинт `POST /guides/draft` см. `main.py`),
результат падает в редактор как правимые черновики шагов — сохранение
финального гайда остаётся обычным путём `build_guides`/`build_steps`
(`apps/api/src/db/buildGuide.ts`), этот модуль ничего не пишет в БД.

Строгий `json.loads` ответа (домен-принцип «качество измеряется, не
ощущается» + «вход враждебен»): шаг без непустого `title` отбрасывается
здесь, а не после того, как автор увидит пустую карточку в редакторе.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

from gigachat import GigaChat

from .. import gigachat_client
from ._prompts import load_draft_prompt

_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*\n?(.*?)```", re.DOTALL)
_MAX_INSTRUCTIONS_CHARS = 20_000


class DraftError(Exception):
    """Провайдер GigaChat недоступен или вернул неразбираемый ответ."""


@dataclass(frozen=True)
class DraftStep:
    title: str
    body: str
    parts: list[str]


def draft_build_steps(client: GigaChat, instructions_text: str) -> list[DraftStep]:
    """Просит GigaChat разбить инструкцию на шаги, возвращает провалидированные черновики.

    Пустой результат — штатный исход для текста, не похожего на инструкцию
    по сборке (см. промпт), не ошибка.
    """
    text = instructions_text.strip()[:_MAX_INSTRUCTIONS_CHARS]
    try:
        response = gigachat_client.ask_text(client, load_draft_prompt(), text)
    except Exception as exc:  # noqa: BLE001 — любой сбой провайдера = DraftError
        raise DraftError(f"GigaChat: {exc}") from exc

    payload = _parse_json(response)
    if payload is None:
        raise DraftError(f"GigaChat вернул неразбираемый JSON: {response[:200]!r}")

    raw_steps = payload.get("steps", [])
    if not isinstance(raw_steps, list):
        raise DraftError(f"GigaChat: поле steps не список: {response[:200]!r}")

    return [step for raw_step in raw_steps if (step := _validate_step(raw_step)) is not None]


def _parse_json(response: str) -> dict | None:
    match = _JSON_FENCE_RE.search(response)
    candidate = match.group(1).strip() if match else response.strip()
    try:
        data = json.loads(candidate)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _validate_step(raw: object) -> DraftStep | None:
    if not isinstance(raw, dict):
        return None
    title = str(raw.get("title") or "").strip()
    if not title:
        return None
    body = str(raw.get("body") or "").strip()

    parts_raw = raw.get("parts")
    parts = (
        [str(part).strip() for part in parts_raw if str(part).strip()]
        if isinstance(parts_raw, list)
        else []
    )

    return DraftStep(title=title, body=body, parts=parts)
