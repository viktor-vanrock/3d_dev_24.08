"""Склеивает `baseline`+`delta` в один ответ контракта `slicer.ai-delta.v1`
(`schemas.py`) — единая точка входа для `main.py` и для eval/golden-тестов
(`tests/golden/slicer_ai_eval.py`), чтобы обе стороны считали одинаково."""

from __future__ import annotations

import psycopg
from gigachat import GigaChat

from . import db
from .baseline import compute_baseline
from .delta import build_ai_delta
from .matcher_port import ProfileIntent
from .schemas import (
    AiDeltaOut,
    AiDeltaResponse,
    BaseProfileOut,
    CalibrationSignalOut,
    ChangedFieldOut,
)


def compute_ai_delta_response(
    conn: psycopg.Connection,
    client: GigaChat | None,
    printer_id: str,
    filament_id: str,
    intent: ProfileIntent,
) -> AiDeltaResponse:
    context = compute_baseline(conn, printer_id, filament_id, intent)
    base = context.recommendation

    training_signal_available = db.calibration_signal_available(conn)
    calibration_summary = (
        db.fetch_calibration_summary(conn, context.printer.id, context.filament.id)
        if training_signal_available
        else None
    )

    ai_result = build_ai_delta(
        client, base.params, context.printer, context.filament, intent, calibration_summary
    )

    ai_disclaimer = (
        "Дельты этого блока предложены ИИ-слоем поверх детерминированного профиля и "
        "ограничены паспортом принтера тем же клэмпингом, что и базовый профиль; это "
        "вспомогательная подсказка, не гарантия — перед печатью проверьте фактические условия."
        if ai_result.changed_fields
        else "AI-слой не предложил изменений к детерминированному профилю выше."
    )

    return AiDeltaResponse(
        printer_id=printer_id,
        filament_id=filament_id,
        intent=intent,
        training_signal_available=training_signal_available,
        calibration_signal=(
            CalibrationSignalOut(
                sample_count=calibration_summary.sample_count,
                success_count=calibration_summary.success_count,
                defect_count=calibration_summary.defect_count,
                success_rate=calibration_summary.success_rate,
                avg_flow_ratio=calibration_summary.avg_flow_ratio,
                avg_pressure_advance=calibration_summary.avg_pressure_advance,
            )
            if calibration_summary is not None
            else None
        ),
        base=BaseProfileOut(
            params=base.params,
            confidence=base.confidence,
            extrapolated=base.extrapolated,
            base_profile_id=base.origin.base_profile_id,
            base_profile_name=base.origin.base_profile_name,
            slicer=base.origin.slicer,
            source_name=base.origin.source_name,
            source_url=base.origin.source_url,
            source_ref=base.origin.source_ref,
            license=base.origin.license,
            overlay_profile_ids=base.origin.overlay_profile_ids,
            changed_fields=[
                ChangedFieldOut(field=c.field, value=c.value, reason=c.reason)
                for c in base.origin.changed_fields
            ],
            disclaimer=base.disclaimer,
        ),
        ai=AiDeltaOut(
            params=ai_result.params,
            confidence=ai_result.confidence,
            changed_fields=[
                ChangedFieldOut(field=c.field, value=c.value, reason=c.reason)
                for c in ai_result.changed_fields
            ],
            note=ai_result.note,
            disclaimer=ai_disclaimer,
        ),
    )
