"""AI-дельты поверх детерминированного профиля (MF-1941, стадия 4/эпик MF-34 v2).

Поток: `baseline.compute_baseline` даёт MF-412-эквивалентный профиль
(`matcher_port.Recommendation`, уже клэмпнутый по паспорту принтера).
`build_ai_delta` просит GigaChat предложить тонкие дельты поверх него
(словарь `_ALLOWED_FIELDS`, ограничен `docs/epics/slicer.profiles.md` §
«Словарь params») и по-русски объяснить каждую. Результат ВСЕГДА повторно
проходит `matcher_port.clamp_to_passport` — тот же safety-предохранитель, что
у детерминированного движка, независимо от того, что вернула модель (CLAUDE.md
§ «ВХОД ВРАЖДЕБЕН»: выводы модели не исполняются и не доверяются без проверки).

Без `GIGACHAT_CREDENTIALS` (или при неразбираемом/невалидном ответе модели) —
ЧЕСТНЫЙ no-op: пустые дельты, `confidence=0`, причина явно объясняет, что AI
не участвовал (тот же паттерн "живём без ключа", что `gigachat_client.
load_client`/`config.load_s3_config`). Мы НЕ подставляем выдуманную
эвристическую дельту вместо реального AI-предложения — это было бы ровно тем,
что запрещает принцип зоны "не выдавать экстраполяцию за проверенный факт".
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from gigachat import GigaChat

from .. import gigachat_client
from ._prompts import load_delta_system_prompt
from .db import CalibrationSummary
from .matcher_port import (
    ChangedField,
    FilamentInput,
    PrinterInput,
    ProfileIntent,
    clamp_to_passport,
    clone,
    merge,
)

_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*\n?(.*?)```", re.DOTALL)

# Словарь совпадает с docs/epics/slicer.profiles.md § «Словарь params (v1)» —
# только поля, для которых зона AI имеет право предлагать дельту; остальные
# ключи ответа модели отбрасываются (allow-list, не deny-list — новый
# незнакомый ключ не проходит по умолчанию, "не гадать").
_SCALAR_FIELDS = frozenset(
    {
        "flow_ratio",
        "retraction_length_mm",
        "retraction_speed_mm_s",
        "z_hop_mm",
        "pressure_advance_k",
        "print_speed_mm_s",
        "travel_speed_mm_s",
    }
)
_NESTED_FIELDS: dict[str, frozenset[str]] = {
    "nozzle_temperature_c": frozenset({"first_layer", "other"}),
    "bed_temperature_c": frozenset({"first_layer", "other"}),
    "cooling_fan_speed_pct": frozenset({"min", "max"}),
}

_NO_CREDENTIALS_REASON = (
    "GigaChat не сконфигурирован (GIGACHAT_CREDENTIALS) — AI-дельты не "
    "предложены, отдан детерминированный базовый профиль без изменений."
)


class AiDeltaError(Exception):
    """Ответ модели неразбираем/невалиден — ловится `build_ai_delta`, не эндпоинтом."""


@dataclass
class AiDeltaProposal:
    deltas: dict[str, Any] = field(default_factory=dict)
    reasoning: dict[str, str] = field(default_factory=dict)
    confidence: float = 0.0
    note: str | None = None


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _sanitize_deltas(raw: Any) -> dict[str, Any]:
    """Отбрасывает всё, что не входит в allow-list полей/типов — не доверяем
    модели структуру ответа, только допустимое подмножество проходит дальше."""
    if not isinstance(raw, dict):
        return {}
    clean: dict[str, Any] = {}
    for key, value in raw.items():
        if key in _SCALAR_FIELDS and _is_number(value):
            clean[key] = float(value)
        elif key in _NESTED_FIELDS and isinstance(value, dict):
            allowed_nested = _NESTED_FIELDS[key]
            nested_clean = {
                k: float(v) for k, v in value.items() if k in allowed_nested and _is_number(v)
            }
            if nested_clean:
                clean[key] = nested_clean
    return clean


def _parse_response(response: str) -> AiDeltaProposal:
    match = _JSON_FENCE_RE.search(response)
    candidate = match.group(1).strip() if match else response.strip()
    try:
        payload = json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise AiDeltaError(f"GigaChat вернул неразбираемый JSON: {response[:200]!r}") from exc
    if not isinstance(payload, dict):
        raise AiDeltaError(f"GigaChat вернул не JSON-объект: {response[:200]!r}")

    deltas = _sanitize_deltas(payload.get("deltas"))
    raw_reasoning = payload.get("reasoning")
    reasoning = (
        {k: str(v) for k, v in raw_reasoning.items() if k in deltas and isinstance(v, str)}
        if isinstance(raw_reasoning, dict)
        else {}
    )
    confidence = payload.get("confidence")
    confidence = float(confidence) if _is_number(confidence) else 0.0
    confidence = max(0.0, min(1.0, confidence))
    if not deltas:
        confidence = 0.0
    return AiDeltaProposal(deltas=deltas, reasoning=reasoning, confidence=confidence)


def _build_user_prompt(
    base_params: dict[str, Any],
    printer: PrinterInput,
    filament: FilamentInput,
    intent: ProfileIntent,
    calibration_summary: CalibrationSummary | None,
) -> str:
    context = {
        "base_params": base_params,
        "printer_passport": {
            "max_nozzle_temp_c": printer.max_nozzle_temp_c,
            "max_bed_temp_c": printer.max_bed_temp_c,
            "max_print_speed_mm_s": printer.max_print_speed_mm_s,
            "nozzle_diameter_mm": printer.nozzle_diameter_mm,
            "kinematics": printer.kinematics,
        },
        "filament_material_class": filament.material_class,
        "intent": intent,
        "calibration_signal": (
            {
                "sample_count": calibration_summary.sample_count,
                "success_rate": round(calibration_summary.success_rate, 3),
                "avg_flow_ratio": calibration_summary.avg_flow_ratio,
                "avg_pressure_advance": calibration_summary.avg_pressure_advance,
            }
            if calibration_summary is not None
            else None
        ),
    }
    return json.dumps(context, ensure_ascii=False)


def request_ai_delta_proposal(
    client: GigaChat,
    base_params: dict[str, Any],
    printer: PrinterInput,
    filament: FilamentInput,
    intent: ProfileIntent,
    calibration_summary: CalibrationSummary | None = None,
) -> AiDeltaProposal:
    """Один вызов GigaChat. Поднимает `AiDeltaError` на неразбираемый/невалидный
    ответ — вызывающая сторона (`build_ai_delta`) решает, деградировать в no-op
    или пробросить ошибку выше."""
    user_prompt = _build_user_prompt(base_params, printer, filament, intent, calibration_summary)
    try:
        response = gigachat_client.ask_text(
            client, load_delta_system_prompt(), user_prompt, temperature=0.0
        )
    except Exception as exc:  # noqa: BLE001 — любой сбой провайдера = AiDeltaError
        raise AiDeltaError(f"GigaChat: {exc}") from exc
    return _parse_response(response)


@dataclass
class AiDeltaResult:
    params: dict[str, Any]
    confidence: float
    changed_fields: list[ChangedField]
    note: str | None


def build_ai_delta(
    client: GigaChat | None,
    base_params: dict[str, Any],
    printer: PrinterInput,
    filament: FilamentInput,
    intent: ProfileIntent,
    calibration_summary: CalibrationSummary | None = None,
) -> AiDeltaResult:
    """Главная точка входа: пустой no-op без кредов/на ошибке модели, иначе —
    предложение GigaChat, всегда смёрдженное на `base_params` и повторно
    клэмпнутое `matcher_port.clamp_to_passport` (см. докстринг модуля).

    `calibration_summary` — реальный обучающий сигнал MF-1940
    (`db.fetch_calibration_summary`), если у связки printer×filament уже
    есть калибровочные записи; `None` — штатно (на `dev` сразу после
    MF-1940 записей 0), модель тогда опирается только на общие принципы
    FDM (см. system-промпт)."""
    if client is None:
        proposal = AiDeltaProposal(note=_NO_CREDENTIALS_REASON)
    else:
        try:
            proposal = request_ai_delta_proposal(
                client, base_params, printer, filament, intent, calibration_summary
            )
        except AiDeltaError as exc:
            proposal = AiDeltaProposal(note=f"AI-дельты отклонены (невалидный ответ модели): {exc}")

    params = merge(base_params, proposal.deltas) if proposal.deltas else clone(base_params)
    changed: list[ChangedField] = []
    for field_name in proposal.deltas:
        if params.get(field_name) != base_params.get(field_name):
            reason = proposal.reasoning.get(field_name, "предложено AI-слоем")
            value = clone(params[field_name])
            changed.append(ChangedField(field=field_name, value=value, reason=reason))

    clamp_to_passport(params, printer, changed)

    return AiDeltaResult(
        params=params,
        confidence=proposal.confidence,
        changed_fields=changed,
        note=proposal.note,
    )
