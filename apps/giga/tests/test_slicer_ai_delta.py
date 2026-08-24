"""Тесты `giga.slicer_ai.delta` — на фейковом GigaChat-клиенте, без сети/кредов
(тот же паттерн, что `tests/test_gigachat_client.py`)."""

from __future__ import annotations

import json

from giga.slicer_ai.db import CalibrationSummary
from giga.slicer_ai.delta import build_ai_delta
from giga.slicer_ai.matcher_port import FilamentInput, PrinterInput

PRINTER = PrinterInput(
    id="printer-1",
    nozzle_diameter_mm=0.4,
    kinematics="corexy",
    build_volume_mm={"x": 256, "y": 256, "z": 256},
    max_nozzle_temp_c=240,
    max_bed_temp_c=90,
    max_print_speed_mm_s=200,
)
FILAMENT = FilamentInput(id="filament-1", material_class="pla", diameter_mm=1.75)
BASE_PARAMS = {
    "nozzle_temperature_c": {"first_layer": 215, "other": 210},
    "bed_temperature_c": {"first_layer": 60, "other": 55},
    "print_speed_mm_s": 150,
    "flow_ratio": 1.0,
}


class _Message:
    def __init__(self, content: str):
        self.content = content


class _Choice:
    def __init__(self, content: str):
        self.message = _Message(content)


class _Completion:
    def __init__(self, content: str):
        self.choices = [_Choice(content)]


class _FakeClient:
    def __init__(self, response: str):
        self._response = response
        self.last_user_prompt: str | None = None

    def chat(self, chat):
        self.last_user_prompt = chat.messages[-1].content
        return _Completion(self._response)


def test_no_client_is_honest_no_op():
    result = build_ai_delta(None, BASE_PARAMS, PRINTER, FILAMENT, "appearance")

    assert result.params == BASE_PARAMS
    assert result.confidence == 0.0
    assert result.changed_fields == []
    assert "GIGACHAT_CREDENTIALS" in result.note


def test_valid_model_response_merges_and_clamps():
    client = _FakeClient(
        """```json
        {
          "deltas": {"flow_ratio": 0.97, "nozzle_temperature_c": {"other": 205}},
          "reasoning": {
            "flow_ratio": "материал печатался горячее среднего",
            "nozzle_temperature_c": "снижение для меньшего сочения"
          },
          "confidence": 0.6
        }
        ```"""
    )

    result = build_ai_delta(client, BASE_PARAMS, PRINTER, FILAMENT, "appearance")

    assert result.params["flow_ratio"] == 0.97
    assert result.params["nozzle_temperature_c"] == {"first_layer": 215, "other": 205}
    assert result.confidence == 0.6
    fields = {c.field for c in result.changed_fields}
    assert fields == {"flow_ratio", "nozzle_temperature_c"}


def test_malformed_json_falls_back_to_honest_no_op():
    client = _FakeClient("извините, не могу помочь с этим запросом")

    result = build_ai_delta(client, BASE_PARAMS, PRINTER, FILAMENT, "appearance")

    assert result.params == BASE_PARAMS
    assert result.confidence == 0.0
    assert result.changed_fields == []
    assert "невалидный ответ" in result.note


def test_unknown_field_is_dropped_not_trusted():
    client = _FakeClient(
        '{"deltas": {"nozzle_temperature_c": {"other": 205}, "gcode_flavor": "marlin"}, '
        '"reasoning": {}, "confidence": 0.5}'
    )

    result = build_ai_delta(client, BASE_PARAMS, PRINTER, FILAMENT, "appearance")

    assert "gcode_flavor" not in result.params
    assert result.params["nozzle_temperature_c"]["other"] == 205


def test_adversarial_response_exceeding_passport_is_still_clamped():
    # Модель "пытается" вылезти за паспорт (270°C при лимите 240°C, 999 мм/с
    # при лимите 200 мм/с) — safety-клэмп должен сработать независимо от
    # confidence и обоснования модели (CLAUDE.md § «ВХОД ВРАЖДЕБЕН»).
    client = _FakeClient(
        """{
          "deltas": {
            "nozzle_temperature_c": {"other": 270},
            "print_speed_mm_s": 999
          },
          "reasoning": {
            "nozzle_temperature_c": "модель настаивает",
            "print_speed_mm_s": "модель настаивает"
          },
          "confidence": 0.99
        }"""
    )

    result = build_ai_delta(client, BASE_PARAMS, PRINTER, FILAMENT, "appearance")

    assert result.params["nozzle_temperature_c"]["other"] == 240
    assert result.params["print_speed_mm_s"] == 200
    reasons = {c.field: c.reason for c in result.changed_fields}
    assert "паспорт" in reasons["nozzle_temperature_c"]
    assert "паспорт" in reasons["print_speed_mm_s"]


def test_empty_deltas_response_is_valid_and_confidence_forced_zero():
    client = _FakeClient('{"deltas": {}, "reasoning": {}, "confidence": 0.8}')

    result = build_ai_delta(client, BASE_PARAMS, PRINTER, FILAMENT, "appearance")

    assert result.params == BASE_PARAMS
    assert result.confidence == 0.0
    assert result.changed_fields == []


def test_calibration_summary_is_forwarded_into_prompt_context():
    client = _FakeClient('{"deltas": {}, "reasoning": {}, "confidence": 0.0}')
    summary = CalibrationSummary(
        sample_count=10,
        success_count=8,
        defect_count=2,
        avg_flow_ratio=0.97,
        avg_pressure_advance=0.045,
    )

    build_ai_delta(client, BASE_PARAMS, PRINTER, FILAMENT, "appearance", summary)

    assert client.last_user_prompt is not None
    sent = json.loads(client.last_user_prompt)
    assert sent["calibration_signal"] == {
        "sample_count": 10,
        "success_rate": 0.8,
        "avg_flow_ratio": 0.97,
        "avg_pressure_advance": 0.045,
    }


def test_no_calibration_summary_sends_null_signal():
    client = _FakeClient('{"deltas": {}, "reasoning": {}, "confidence": 0.0}')

    build_ai_delta(client, BASE_PARAMS, PRINTER, FILAMENT, "appearance")

    sent = json.loads(client.last_user_prompt)
    assert sent["calibration_signal"] is None
