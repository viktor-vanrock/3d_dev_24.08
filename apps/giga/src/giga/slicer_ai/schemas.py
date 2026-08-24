"""Pydantic-контракт `/slicer-profiles/ai-delta` (MF-1941, `slicer.ai-delta.v1`
— см. `docs/contracts/slicer.ai-delta.v1.md`).

Форма `base` — та же, что `explanation`/`profile` контракта MF-412
(`docs/contracts/slicer.profile-recommendation.v1.md`), чтобы `apps/api`,
принимая ответ giga, не переучивался на другую форму происхождения профиля;
`ai` — новый слой поверх."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

AI_DELTA_CONTRACT_VERSION = "slicer.ai-delta.v1"

ProfileIntent = Literal["strength", "speed", "appearance", "miniatures"]


class AiDeltaRequest(BaseModel):
    printer_id: str = Field(min_length=1)
    filament_id: str = Field(min_length=1)
    intent: ProfileIntent = "appearance"


class ChangedFieldOut(BaseModel):
    field: str
    value: Any
    reason: str


class BaseProfileOut(BaseModel):
    params: dict[str, Any]
    confidence: float
    extrapolated: bool
    base_profile_id: str
    base_profile_name: str
    slicer: str
    source_name: str
    source_url: str | None
    source_ref: str | None
    license: str
    overlay_profile_ids: list[str]
    changed_fields: list[ChangedFieldOut]
    disclaimer: str


class AiDeltaOut(BaseModel):
    params: dict[str, Any]
    confidence: float
    changed_fields: list[ChangedFieldOut]
    note: str | None
    disclaimer: str


class CalibrationSignalOut(BaseModel):
    """Реальный обучающий сигнал MF-1940 (`slicer_profile_calibrations`) для
    этой связки printer×filament, если уже накоплен хоть один прогон."""

    sample_count: int
    success_count: int
    defect_count: int
    success_rate: float
    avg_flow_ratio: float | None
    avg_pressure_advance: float | None


class AiDeltaResponse(BaseModel):
    contract_version: str = AI_DELTA_CONTRACT_VERSION
    printer_id: str
    filament_id: str
    intent: ProfileIntent
    training_signal_available: bool
    calibration_signal: CalibrationSignalOut | None
    base: BaseProfileOut
    ai: AiDeltaOut
