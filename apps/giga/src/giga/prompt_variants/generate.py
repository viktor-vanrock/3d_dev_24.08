"""Варианты промпта для главной (MF-2068): запрос + номер батча + уже показанные темы →
нормализованный intent и 4-6 новых конкретных вариантов промпта для генерации 3D.

Синхронно, без generation queue: один вызов локальной Gemma на fast-слоте HYPERPC.
`apps/api` держит свой таймаут и деградирует на многовариантный heuristic-фоллбэк при
недоступности/просрочке (см. `apps/api/src/assistant/promptVariants.ts`). Платный GigaChat
в этом пути не используется.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

from ..assistant import hyperpc_client
from ._prompts import load_generate_prompt

_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*\n?(.*?)```", re.DOTALL)
_MAX_QUERY_CHARS = 300
_LABEL_MAX_LENGTH = 80
# Держит PROMPT_MAX_LENGTH apps/api/src/generations/contract.ts — дублируется намеренно, giga не
# импортирует TS-код api (тот же приём, что giga.ideas.enrich._TITLE_MAX_LENGTH).
_PROMPT_MAX_LENGTH = 2000
_MAX_BATCH = 10_000
_MAX_EXCLUDE_LABELS = 48
_EXCLUDE_LABEL_MAX_LENGTH = 80


class PromptVariantsError(Exception):
    """Локальная Gemma недоступна или вернула неразбираемый/невалидный ответ."""


@dataclass(frozen=True)
class PromptVariantDraft:
    label: str
    prompt: str
    motif: str | None
    confidence: float


@dataclass(frozen=True)
class PromptVariantsDraft:
    normalized_query: str
    motif: str | None
    variants: list[PromptVariantDraft]


def generate_prompt_variants(
    config: hyperpc_client.HyperpcConfig,
    query: str,
    limit: int,
    batch: int = 0,
    exclude_labels: list[str] | None = None,
) -> PromptVariantsDraft:
    """Просит локальную Gemma разобрать запрос, возвращает провалидированный черновик.

    `limit` режет `variants` СПРАВА (после валидации, не до) — промпт всегда просит 4-6, режем
    под фактически запрошенный лимит, не полагаясь на то, что модель сама уважает произвольное N.
    """
    text = query.strip()[:_MAX_QUERY_CHARS]
    normalized_batch = max(0, min(_MAX_BATCH, batch))
    normalized_excludes = [
        label.strip()[:_EXCLUDE_LABEL_MAX_LENGTH]
        for label in (exclude_labels or [])[-_MAX_EXCLUDE_LABELS:]
        if label.strip()
    ]
    user_payload = json.dumps(
        {
            "query": text,
            "batch": normalized_batch,
            "exclude_labels": normalized_excludes,
        },
        ensure_ascii=False,
    )
    try:
        response = hyperpc_client.chat_fast(
            config,
            load_generate_prompt(),
            user_payload,
            # Gemma токенизирует русский JSON заметно плотнее английского. 1400 токенов
            # обрывали валидный ответ внутри первого же длинного prompt и оставляли весь
            # продукт на degraded fallback, хотя слот был здоров.
            max_tokens=2800,
            temperature=1.0,
        )
    except Exception as exc:  # noqa: BLE001 — любой сбой провайдера = PromptVariantsError
        raise PromptVariantsError(f"Gemma: {exc}") from exc

    payload = _parse_json(response)
    if payload is None:
        raise PromptVariantsError(f"Gemma вернула неразбираемый JSON: {response[:200]!r}")

    return _validate_draft(payload, response, limit)


def _parse_json(response: str) -> dict | None:
    match = _JSON_FENCE_RE.search(response)
    candidate = match.group(1).strip() if match else response.strip()
    try:
        data = json.loads(candidate)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _clean_motif(raw: object) -> str | None:
    return raw.strip() if isinstance(raw, str) and raw.strip() else None


def _validate_draft(payload: dict, raw_response: str, limit: int) -> PromptVariantsDraft:
    normalized_query = str(payload.get("normalized_query") or "").strip()
    if not normalized_query:
        raise PromptVariantsError(f"Gemma: пустой normalized_query: {raw_response[:200]!r}")

    motif = _clean_motif(payload.get("motif"))

    raw_variants = payload.get("variants")
    if not isinstance(raw_variants, list) or not raw_variants:
        raise PromptVariantsError(f"Gemma: пустой/невалидный variants: {raw_response[:200]!r}")

    variants: list[PromptVariantDraft] = []
    for item in raw_variants:
        if len(variants) >= limit:
            break
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "").strip()[:_LABEL_MAX_LENGTH]
        prompt = str(item.get("prompt") or "").strip()[:_PROMPT_MAX_LENGTH]
        if not label or not prompt:
            continue
        confidence_raw = item.get("confidence")
        confidence = float(confidence_raw) if isinstance(confidence_raw, (int, float)) else 0.5
        confidence = max(0.0, min(1.0, confidence))
        item_motif = _clean_motif(item.get("motif")) or motif
        variants.append(
            PromptVariantDraft(label=label, prompt=prompt, motif=item_motif, confidence=confidence)
        )

    if not variants:
        raise PromptVariantsError(
            f"Gemma: ни один вариант не прошёл валидацию: {raw_response[:200]!r}"
        )

    return PromptVariantsDraft(normalized_query=normalized_query, motif=motif, variants=variants)
