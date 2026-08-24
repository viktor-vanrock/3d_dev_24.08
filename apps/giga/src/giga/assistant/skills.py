"""Server-owned versioned реестр skills для assistant-оркестратора (MF-2046).

Единственный источник правды о том, какие инструменты вообще существуют,
какой у каждого input-schema, какой scope его открывает и режется ли он
только для чтения или мутирует состояние (`mutating`). `router.py` показывает
модели ТОЛЬКО то, что вернул `skills_for(mode, scopes)` — модель не может
определить свой собственный tool/schema/scope, только выбрать имя из уже
описанного здесь (see `router._parse_tool_call`, allow-list, не blocklist,
тот же принцип, что allow-listed `citation_ids` в `router.py`).

Approval flow структурно, не по соглашению: `mutating=True` — жёсткий сигнал
для `router.py` никогда не исполнять этот skill как `tool_call` (т.е. молча,
без подтверждения пользователя) — мутирующие возможности достижимы только
через отдельный терминальный `kind` (`generation_offer`), который сам по себе
уже требует явного подтверждения пользователя отдельным запросом
(`ConfirmAssistantGenerationRequest`, packages/contracts/http/assistant.ts).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Literal

from pydantic import BaseModel, Field

from .evidence import Evidence

ASSISTANT_SKILLS_CONTRACT_VERSION = "giga.assistant-skills.v1"

# page — узкий контекст текущей страницы (напр. карточка модели/принтера);
# global — общий приватный центр чатов (docs/design/search.assistant.workspace.md §3);
# assistant — тред 3D-мастерской (там же §4). Модель никогда не выбирает
# режим сама — его передаёт вызывающая сторона (`lifecycle_worker.py`/API-слой,
# см. `router.route_message`).
AssistantMode = Literal["page", "global", "assistant"]
ASSISTANT_MODES: tuple[AssistantMode, ...] = ("page", "global", "assistant")

# Грубые permission-теги — allow-list разрешённых вызывающей стороной scope'ов
# (аккаунт/роль), не блок-лист. Реальное подключение к правам пользователя —
# решение Back (см. `docs/design/search.assistant.workspace.md` §5.2 "владельца
# на сервере"); до тех пор `DEFAULT_SCOPES` сохраняет сегодняшнее поведение
# (полный доступ), тот же приём деградации, что `schemas.py` про MF-1999.
SCOPE_CATALOG_READ = "catalog:read"
SCOPE_GENERATION_PROPOSE = "generation:propose"

DEFAULT_SCOPES: frozenset[str] = frozenset({SCOPE_CATALOG_READ, SCOPE_GENERATION_PROPOSE})


class CatalogSearchInput(BaseModel):
    """Аргументы уточняющего повторного каталожного поиска — единственный
    `tool_call`, который оркестратор вправе исполнить сам (read-only, без
    побочных эффектов). `limit` ограничен так же жёстко, как
    `AssistantRunRequest.evidence_limit` в `schemas.py` — модель не может
    запросить "весь каталог" одним вызовом."""

    query: str = Field(min_length=1, max_length=200)
    limit: int = Field(default=6, ge=1, le=10)


class AssistantSkillSpec(BaseModel):
    """Одна запись реестра. `input_schema` — JSON Schema (не Python-тип) —
    то, что реально уходит модели в промпте и чем `router.py` валидирует
    `tool_call.args`."""

    model_config = {"frozen": True}

    name: str
    description: str
    input_schema: dict
    required_scope: str
    mutating: bool
    modes: frozenset[AssistantMode]


_CATALOG_SEARCH = AssistantSkillSpec(
    name="catalog_search",
    description=(
        "Повторный поиск по каталогу моделей с уточнённым запросом — используй, "
        "если предоставленный <catalog_evidence> не отвечает на вопрос напрямую."
    ),
    input_schema=CatalogSearchInput.model_json_schema(),
    required_scope=SCOPE_CATALOG_READ,
    mutating=False,
    modes=frozenset({"page", "global", "assistant"}),
)

_GENERATION_OFFER = AssistantSkillSpec(
    name="generation_offer",
    description=(
        "Предложить пользователю запустить генерацию 3D-модели по одной из веток "
        "(openscad/kzd/hueforge/trellis). Только предложение — job не запускается "
        "отсюда, нужно отдельное подтверждение пользователя. Никогда не вызывается "
        "как tool_call — только как терминальный kind=generation_offer."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "branch": {"type": "string", "enum": ["openscad", "kzd", "hueforge", "trellis"]},
            "prompt_summary": {"type": "string", "minLength": 1},
            "note": {"type": "string"},
        },
        "required": ["branch", "prompt_summary"],
    },
    required_scope=SCOPE_GENERATION_PROPOSE,
    mutating=True,
    modes=frozenset({"global", "assistant"}),
)

# Порядок — стабильный порядок показа модели (не влияет на логику).
SKILL_REGISTRY: dict[str, AssistantSkillSpec] = {
    _CATALOG_SEARCH.name: _CATALOG_SEARCH,
    _GENERATION_OFFER.name: _GENERATION_OFFER,
}


def skills_for(mode: AssistantMode, scopes: frozenset[str]) -> list[AssistantSkillSpec]:
    """Реестр, отфильтрованный по режиму страницы и разрешённым scope'ам
    вызывающей стороны — то, что оркестратор МОЖЕТ показать модели в ЭТОМ
    запросе, не полный список всех существующих серверных возможностей."""
    return [
        skill
        for skill in SKILL_REGISTRY.values()
        if mode in skill.modes and skill.required_scope in scopes
    ]


# Сигнатура исполнителя read-only skill'а `catalog_search` — та же форма, что
# `evidence.EvidenceProvider`, без `conn`: `router.py` остаётся чистой функцией
# (см. докстринг `router.py`), DB-зависимость инжектит только lifecycle worker.
CatalogSearchFn = Callable[[str, int], list[Evidence]]
