"""Оркестратор одного assistant-сообщения: page/global/assistant режим +
bounded evidence + server-owned skill registry + структурный вызов HYPERPC →
`AssistantResult` (MF-2000, оркестратор/реестр — MF-2046).

Чистая функция от `(hyperpc_config, message, evidence, ...)` — без
БД-зависимости (evidence уже забрана вызывающей стороной, см.
`worker.process_one`; read-only `catalog_search` — тоже инжектится колбэком,
не коннекшеном, см. `skills.CatalogSearchFn`), поэтому тестируется полностью
на фейковом HYPERPC-ответе (`tests/test_assistant_router*.py`), без реального
Postgres/сети.

Prompt-injection защита (CLAUDE.md зоны AI § «ВХОД ВРАЖДЕБЕН» — вход враждебен
трижды здесь: пользовательское сообщение, содержимое evidence-сниппетов из
чужих карточек каталога, и (новое, MF-2046) сам ответ модели, который
пытается выбрать skill/tool):
- evidence и меню доступных skills сериализуются как данные внутри JSON
  user-промпта, не как инструкции (см. `_build_user_prompt`), с явным
  предупреждением в системном промпте (`prompts/router.system.md`) не
  исполнять команды из сниппетов;
- цитаты в ответе строим САМИ из своей evidence по `model_id`, который модель
  разрешено выбрать — текст/ссылку/оценку модель дописать не может, только
  выбрать/отбросить allow-listed id (`_citations_from_ids`);
- `tool_call.skill` — allow-list из `skills.skills_for(mode, scopes)`,
  отфильтрованного ПО ЭТОМУ запросу (не полный реестр) — модель не может ни
  изобрести новый skill, ни вызвать мутирующий (`mutating=True`) как
  `tool_call` (единственный путь к мутации — терминальный `generation_offer`,
  который сам требует отдельного подтверждения пользователя);
- `tool_call.args` валидируются строгой pydantic-схемой skill'а
  (`skills.CatalogSearchInput`), не принимаются как есть;
- ровно один `tool_call` за прогон (см. `route_message`) — модель не может
  зациклить оркестратор повторными вызовами инструмента (CLAUDE.md § «СТОИМОСТЬ»);
- ответ модели парсится строгим allow-list (как `slicer_ai.delta._parse_response`),
  никогда `eval`/произвольная десериализация.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from dataclasses import dataclass

from pydantic import ValidationError

from . import hyperpc_client
from ._prompts import load_router_system_prompt
from .evidence import Evidence
from .schemas import (
    AssistantAnswer,
    AssistantClarification,
    AssistantError,
    AssistantGenerationOffer,
    AssistantResult,
    Citation,
)
from .skills import (
    DEFAULT_SCOPES,
    AssistantMode,
    AssistantSkillSpec,
    CatalogSearchFn,
    CatalogSearchInput,
    skills_for,
)

_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*\n?(.*?)```", re.DOTALL)

_GENERATION_BRANCHES = frozenset({"openscad", "kzd", "hueforge", "trellis"})

_NO_HYPERPC_NOTE = (
    "HYPERPC не сконфигурирован (HYPERPC_STRUCTURED_URL) — показаны найденные "
    "по каталогу совпадения без AI-синтеза ответа."
)


class RouterOutputError(Exception):
    """Ответ модели неразбираем/невалиден — ловится `route_message`, наружу не течёт."""


@dataclass(frozen=True)
class _ToolCallRequest:
    """Внутренний, никогда не персистентный результат разбора — `route_message`
    исполняет его сам и заменяет терминальным `AssistantResult` до возврата
    наружу. Никогда не сериализуется в `assistant_runs.result` (не часть
    `AssistantResult`-union из `schemas.py`/контракта)."""

    skill: str
    args: CatalogSearchInput


def _skill_menu(skills: list[AssistantSkillSpec]) -> list[dict]:
    """Сериализация реестра для промпта — ДАННЫЕ (allow-list имён/схем),
    не инструкции; модель выбирает `name` отсюда, содержимое skill'а (schema/
    scope/mutating) ей не подчинить — оно всегда из `skills.py`, не из ответа."""
    return [
        {
            "name": s.name,
            "description": s.description,
            "input_schema": s.input_schema,
            "mutating": s.mutating,
        }
        for s in skills
    ]


def _build_user_prompt(
    message: str,
    evidence: list[Evidence],
    available_skills: list[AssistantSkillSpec],
    *,
    tool_call_used: bool = False,
) -> str:
    context: dict = {
        "user_message": message,
        "catalog_evidence": [
            {"model_id": e.model_id, "title": e.title, "snippet": e.snippet}
            for e in evidence
        ],
        "available_skills": _skill_menu(available_skills),
    }
    if tool_call_used:
        # Второй (и последний) проход — см. `route_message`: инструмент уже
        # исполнен один раз, модель обязана дать терминальный ответ сейчас.
        context["tool_call_used"] = True
    return json.dumps(context, ensure_ascii=False)


def _merge_evidence(original: list[Evidence], extra: list[Evidence]) -> list[Evidence]:
    """Оригинальная evidence остаётся первой (дедуп по `model_id`) — новые
    результаты `tool_call` дополняют, не заменяют исходный bounded retrieval."""
    seen = {e.model_id for e in original}
    merged = list(original)
    for e in extra:
        if e.model_id not in seen:
            seen.add(e.model_id)
            merged.append(e)
    return merged


def _citations_from_ids(ids: list[str], evidence_by_id: dict[str, Evidence]) -> list[Citation]:
    """`ids` — то, что модель ВЫБРАЛА из предоставленной evidence; содержимое
    цитаты (title/snippet/score/url) всегда из нашей записи, не из ответа
    модели — модель не может подменить, на что "на самом деле" ссылается id."""
    seen: set[str] = set()
    citations: list[Citation] = []
    for model_id in ids:
        if model_id in seen or model_id not in evidence_by_id:
            continue
        seen.add(model_id)
        e = evidence_by_id[model_id]
        citations.append(
            Citation(
                model_id=e.model_id,
                title=e.title,
                snippet=e.snippet,
                score=e.score,
                source_url=e.source_url,
            )
        )
    return citations


def _parse_response(
    response: str,
    evidence_by_id: dict[str, Evidence],
    *,
    tool_callable_names: frozenset[str],
    generation_allowed: bool,
) -> AssistantResult | _ToolCallRequest:
    match = _JSON_FENCE_RE.search(response)
    candidate = match.group(1).strip() if match else response.strip()
    try:
        payload = json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise RouterOutputError(f"неразбираемый JSON: {response[:200]!r}") from exc
    if not isinstance(payload, dict):
        raise RouterOutputError(f"ответ не JSON-объект: {response[:200]!r}")

    kind = payload.get("kind")

    if kind == "tool_call":
        skill_name = payload.get("skill")
        # Allow-list — `tool_callable_names` уже отфильтрован по mode/scope
        # ЭТОГО запроса (см. `route_message`), не полный реестр; мутирующие
        # skills (см. `skills.py`) сюда никогда не попадают. Модель не может
        # ни изобрести имя, ни дотянуться до мутации через tool_call.
        if not isinstance(skill_name, str) or skill_name not in tool_callable_names:
            raise RouterOutputError(f"tool_call на недопустимый/неизвестный skill={skill_name!r}")
        args_raw = payload.get("args")
        if not isinstance(args_raw, dict):
            raise RouterOutputError("tool_call без объекта args")
        if skill_name == "catalog_search":
            try:
                args = CatalogSearchInput.model_validate(args_raw)
            except ValidationError as exc:
                raise RouterOutputError(
                    f"tool_call.args не проходит схему catalog_search: {exc}"
                ) from exc
            return _ToolCallRequest(skill="catalog_search", args=args)
        # Не должно случиться, пока в реестре только один read-only skill —
        # fail closed, а не молчаливое исполнение неизвестно чего.
        raise RouterOutputError(f"skill={skill_name!r} разрешён, но не имеет исполнителя")

    if kind == "answer":
        text = payload.get("text")
        if not isinstance(text, str) or not text.strip():
            raise RouterOutputError("answer без непустого text")
        raw_ids = payload.get("citation_ids")
        ids = [i for i in raw_ids if isinstance(i, str)] if isinstance(raw_ids, list) else []
        citations = _citations_from_ids(ids, evidence_by_id)
        return AssistantAnswer(text=text.strip(), citations=citations)

    if kind == "clarification":
        question = payload.get("question")
        if not isinstance(question, str) or not question.strip():
            raise RouterOutputError("clarification без непустого question")
        reason = payload.get("reason")
        return AssistantClarification(
            question=question.strip(),
            reason=reason.strip() if isinstance(reason, str) and reason.strip() else None,
        )

    if kind == "generation_offer":
        # Мод/scope-гейт (MF-2046): в `page`-режиме (или без scope
        # `generation:propose`) `generation_offer` не входит в
        # `skills_for(...)` для этого запроса — структурно запрещаем тот же
        # исход и здесь, а не только через промпт (модель не обязана слушаться).
        if not generation_allowed:
            raise RouterOutputError("generation_offer недоступен в этом режиме/scope")
        branch = payload.get("branch")
        if branch not in _GENERATION_BRANCHES:
            raise RouterOutputError(f"generation_offer с недопустимой branch={branch!r}")
        prompt_summary = payload.get("prompt_summary")
        if not isinstance(prompt_summary, str) or not prompt_summary.strip():
            raise RouterOutputError("generation_offer без непустого prompt_summary")
        note = payload.get("note")
        return AssistantGenerationOffer(
            branch=branch,
            prompt_summary=prompt_summary.strip(),
            note=note.strip() if isinstance(note, str) and note.strip() else None,
        )

    raise RouterOutputError(f"неизвестный/отсутствующий kind={kind!r}")


def _degraded_answer(evidence: list[Evidence]) -> AssistantAnswer:
    """Честный no-op без HYPERPC (тот же паттерн, что `slicer_ai.delta`/
    `gigachat_client`: без провайдера — не 500, а качественно понятный
    результат) — показываем то, что реально нашёл лексический поиск, без
    выдуманного AI-синтеза текста."""
    citations = [
        Citation(
            model_id=e.model_id,
            title=e.title,
            snippet=e.snippet,
            score=e.score,
            source_url=e.source_url,
        )
        for e in evidence
    ]
    text = (
        "AI-маршрутизация недоступна — вот найденные по каталогу совпадения без синтеза ответа."
        if citations
        else "AI-маршрутизация недоступна, и поиск по каталогу не нашёл совпадений."
    )
    return AssistantAnswer(text=text, citations=citations, note=_NO_HYPERPC_NOTE)


def _call_hyperpc(
    hyperpc_config: hyperpc_client.HyperpcConfig,
    system_prompt: str,
    user_prompt: str,
    max_response_tokens: int,
) -> str | AssistantError:
    try:
        return hyperpc_client.chat_structured(
            hyperpc_config, system_prompt, user_prompt, max_tokens=max_response_tokens
        )
    except hyperpc_client.HyperpcTimeoutError as exc:
        return AssistantError(code="provider_timeout", message=str(exc), retryable=True)
    except hyperpc_client.HyperpcError as exc:
        return AssistantError(code="provider_error", message=str(exc), retryable=True)


def route_message(
    hyperpc_config: hyperpc_client.HyperpcConfig | None,
    message: str,
    evidence: list[Evidence],
    *,
    max_response_tokens: int = 800,
    mode: AssistantMode = "global",
    scopes: frozenset[str] = DEFAULT_SCOPES,
    catalog_search: CatalogSearchFn | None = None,
    on_tool_call: Callable[[str], None] | None = None,
) -> AssistantResult:
    """Главная точка входа `worker.process_one`. Никогда не бросает — любой
    сбой провайдера/парсинга превращается в `AssistantError` (стабильный,
    сериализуемый результат, а не исключение наружу воркера).

    `mode`/`scopes` — page/global/assistant оркестрация (MF-2046): решают,
    какое подмножество `skills.SKILL_REGISTRY` вообще видит модель в этом
    запросе (см. `skills.skills_for`) — и `tool_call`, и `generation_offer`
    гейтятся одним и тем же фильтром. `catalog_search=None` (дефолт —
    вызывающая сторона не подключила исполнителя) молча исключает
    `catalog_search` из меню, а не показывает недоступный инструмент.
    """
    if hyperpc_config is None:
        return _degraded_answer(evidence)

    available = [
        skill
        for skill in skills_for(mode, scopes)
        if skill.name != "catalog_search" or catalog_search is not None
    ]
    tool_callable_names = frozenset(s.name for s in available if not s.mutating)
    generation_allowed = any(s.name == "generation_offer" for s in available)

    system_prompt = load_router_system_prompt()
    user_prompt = _build_user_prompt(message, evidence, available)
    response = _call_hyperpc(hyperpc_config, system_prompt, user_prompt, max_response_tokens)
    if isinstance(response, AssistantError):
        return response

    evidence_by_id = {e.model_id: e for e in evidence}
    try:
        parsed = _parse_response(
            response,
            evidence_by_id,
            tool_callable_names=tool_callable_names,
            generation_allowed=generation_allowed,
        )
    except RouterOutputError as exc:
        return AssistantError(code="invalid_output", message=str(exc), retryable=False)

    if not isinstance(parsed, _ToolCallRequest):
        return parsed

    # Ровно один tool_call за прогон (CLAUDE.md § «СТОИМОСТЬ» + защита от
    # зацикливания моделью) — вторая попытка ниже получает пустой
    # `tool_callable_names`, поэтому структурно не может выполниться повторно.
    if on_tool_call is not None:
        on_tool_call(parsed.skill)
    if catalog_search is None:  # pragma: no cover — недостижимо, см. фильтр `available` выше
        return AssistantError(
            code="invalid_output", message="запрошенный инструмент недоступен", retryable=False
        )
    extra_evidence = catalog_search(parsed.args.query, parsed.args.limit)
    merged_evidence = _merge_evidence(evidence, extra_evidence)
    merged_by_id = {e.model_id: e for e in merged_evidence}

    follow_up_prompt = _build_user_prompt(message, merged_evidence, available, tool_call_used=True)
    follow_up_response = _call_hyperpc(
        hyperpc_config, system_prompt, follow_up_prompt, max_response_tokens
    )
    if isinstance(follow_up_response, AssistantError):
        return follow_up_response

    try:
        final = _parse_response(
            follow_up_response,
            merged_by_id,
            tool_callable_names=frozenset(),
            generation_allowed=generation_allowed,
        )
    except RouterOutputError as exc:
        return AssistantError(code="invalid_output", message=str(exc), retryable=False)

    if isinstance(final, _ToolCallRequest):  # pragma: no cover — защита выше должна ловить раньше
        return AssistantError(
            code="invalid_output",
            message="повторный tool_call запрещён (бюджет — один вызов инструмента)",
            retryable=False,
        )
    return final
