"""Контракт RAG/clarification runner'а (MF-2000): `giga.assistant-run.v1`.

Каноническая TS-форма опубликована в
`packages/contracts/http/assistant.ts::AssistantRunResult`; эта Pydantic-схема
типизирует тот же discriminated union на стороне Giga runtime.

Дискриминатор `kind` — тот же приём, что различает результат на четыре формы
без отдельных эндпоинтов: LLM решает только между `answer`/`clarification`/
`generation_offer` (не может выбрать `error` — это код-уровня результат,
LLM никогда не значит "у меня ошибка", `error` строится только `router.py`
на таймаут/невалидный ответ провайдера, а не как выбор модели).
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field

ASSISTANT_RUN_CONTRACT_VERSION = "giga.assistant-run.v1"

# Тот же словарь веток, что `generations.branch` (MF-351/apps/api/db baseline) —
# generation_offer предлагает конкретную ветку генерации, не абстрактную "да".
GenerationBranch = Literal["openscad", "kzd", "hueforge", "trellis"]

ErrorCode = Literal["provider_timeout", "provider_error", "invalid_output"]


class Citation(BaseModel):
    """Собирается ИСКЛЮЧИТЕЛЬНО из наших же `evidence.Evidence` по `model_id`,
    который LLM разрешено выбрать — текст сниппета/название/ссылка берутся из
    нашей evidence-записи, не из того, что дописала модель в ответе (модель
    не может подменить контент цитаты, только выбрать/отбросить id — см.
    `router._citations_from_ids`)."""

    model_id: str
    title: str
    snippet: str
    score: float
    source_url: str | None = None


class AssistantAnswer(BaseModel):
    kind: Literal["answer"] = "answer"
    text: str
    citations: list[Citation] = Field(default_factory=list)
    note: str | None = None


class AssistantClarification(BaseModel):
    """Одно поле `question` — не список: схема сама структурно не даёт LLM
    задать больше одного уточнения за раз (MF-2000 «Готово когда»: обычно не
    более одного полезного уточнения)."""

    kind: Literal["clarification"] = "clarification"
    question: str
    reason: str | None = None


class AssistantGenerationOffer(BaseModel):
    """Только предложение — сама генерация НЕ запускается отсюда. Side effect
    (реальный `generations`-job) создаёт `POST /assistant/threads/:id/generations`
    (MF-1997, Back) отдельным явным подтверждением пользователя, эта форма —
    просто описание, что можно было бы сгенерировать."""

    kind: Literal["generation_offer"] = "generation_offer"
    branch: GenerationBranch
    prompt_summary: str
    note: str | None = None


class AssistantError(BaseModel):
    kind: Literal["error"] = "error"
    code: ErrorCode
    message: str
    retryable: bool


AssistantResult = Annotated[
    AssistantAnswer | AssistantClarification | AssistantGenerationOffer | AssistantError,
    Field(discriminator="kind"),
]


class AssistantRunRequest(BaseModel):
    thread_id: str = Field(min_length=1)
    message: str = Field(min_length=1, max_length=4000)
    evidence_limit: int = Field(default=6, ge=0, le=20)


class AssistantRunResponse(BaseModel):
    contract_version: str = ASSISTANT_RUN_CONTRACT_VERSION
    thread_id: str
    result: AssistantResult
