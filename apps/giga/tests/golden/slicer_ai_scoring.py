"""Golden-набор + экспертная эвристика правдоподобия для eval MF-1941.

Почему экспертная эвристика, а не реальная метрика на калибровочном сигнале:
карточка MF-1940 (обучающий сигнал — калибровки/исход печати из Make-галереи,
таблица `slicer_profile_calibrations`) на момент этого прогона — `in_progress`,
не `done` (проверено `giga.slicer_ai.db.calibration_signal_available`,
честно `False` на дев-БД). Карточка MF-1941 прямо разрешает и требует в этом
случае: "экспертная оценка на старте, если сигнала ещё нет — зафиксировать
явно, какая метрика использована и почему" — это она и есть.

Пороги ниже — не выдуманные числа, а общеизвестные безопасные диапазоны
настройки FDM-печати (тот же уровень строгости, что курируемый RU-seed
`apps/scout/.../slicer_print_profiles_ru.py` — не гадаем экзотику, только
консервативные общепринятые границы): flow ratio обычно калибруется в
0.85-1.15 от номинала; pressure advance/K-factor у прямого экструдера/
боудена практически всегда в 0-1.2 (Klipper `PRESSURE_ADVANCE`); ретракт
0.2-10мм и 10-80мм/с покрывает и direct drive, и bowden-конфигурации;
z-hop до 1мм — типичный верхний предел для FDM (выше — уже редкий кейс,
не общий дефолт). Это НЕ замена реальной метрики по исходу печати — как
только MF-1940 закроется, следующий шаг — заменить эту функцию на скоринг
по фактическому `outcome` (success/defect) из `slicer_profile_calibrations`
(см. TODO в `giga.slicer_ai.db.calibration_signal_available`), сохранив
формат golden-набора (комбо остаются те же).

`GOLDEN_COMBOS` — фикстуры, СИНТЕТИЧЕСКИЕ (не живой прогон из dev-БД: у
этого агента нет `DATABASE_URL`/сетевого доступа к dev-Postgres в этой
сессии — "живём без ключа"), но представительные для реального корпуса
`slicer_profiles`, задокументированного в `docs/epics/slicer.profiles.md`
(вендор Creality — тот же, что CI-корпус MF-1920 `slicer_ci_corpus.py`,
Generic PLA/PETG/ABS — те же материалы, что базовый Step 2/фаза 1 MF-411
парсер OrcaSlicer уже подтверждённо загрузил на `dev`). Когда у сессии с
доступом к `DATABASE_URL` дойдут руки — следующий шаг честно упомянут в
`docs/epics/slicer.profiles.md` § этой карточки: прогнать тот же скоринг на
реальных id из `slicer_profiles`/`machines`/`materials`.
"""

from __future__ import annotations

from typing import Any

from giga.slicer_ai.matcher_port import BaselineProfile, FilamentInput, PrinterInput

# --- combo 1: точное совпадение, Creality-класс bedslinger + Generic PLA ---

_CREALITY_PRINTER = PrinterInput(
    id="printer-creality-ender3v2",
    nozzle_diameter_mm=0.4,
    kinematics="bedslinger",
    build_volume_mm={"x": 220, "y": 220, "z": 250},
    max_nozzle_temp_c=260,
    max_bed_temp_c=100,
    max_print_speed_mm_s=180,
)
_GENERIC_PLA = FilamentInput(id="filament-generic-pla", material_class="pla", diameter_mm=1.75)
_CREALITY_BASE_PROFILE = BaselineProfile(
    id="profile-creality-ender3v2-020",
    profile_class="process",
    slicer="orcaslicer",
    name="0.20mm Standard @Creality Ender-3 V2",
    machine_id="printer-creality-ender3v2",
    material_id=None,
    params={
        "kinematics": "bedslinger",
        "nozzle_diameter_mm": 0.4,
        "build_volume_mm": {"x": 220, "y": 220, "z": 250},
        "print_speed_mm_s": 150,
        "travel_speed_mm_s": 150,
    },
    source_name="OrcaSlicer",
    source_url=None,
    source_ref="resources/profiles/Creality/process/0.20mm Standard.json",
    license="AGPL-3.0-or-later",
    confidence=1.0,
    extrapolated_from_id=None,
)
_GENERIC_PLA_PROFILE = BaselineProfile(
    id="profile-generic-pla",
    profile_class="filament",
    slicer="orcaslicer",
    name="Generic PLA",
    machine_id=None,
    material_id="filament-generic-pla",
    params={
        "nozzle_temperature_c": {"first_layer": 215, "other": 210},
        "bed_temperature_c": {"first_layer": 60, "other": 55},
        "flow_ratio": 1.0,
        "retraction_length_mm": 0.8,
        "retraction_speed_mm_s": 30,
        "cooling_fan_speed_pct": {"min": 60, "max": 100},
    },
    source_name="OrcaSlicer",
    source_url=None,
    source_ref="resources/profiles/BBL/filament/Generic PLA.json",
    license="AGPL-3.0-or-later",
    confidence=1.0,
    extrapolated_from_id=None,
)

# --- combo 2: точное совпадение, CoreXY-класс + Generic PETG ---

_COREXY_PRINTER = PrinterInput(
    id="printer-corexy-generic",
    nozzle_diameter_mm=0.4,
    kinematics="corexy",
    build_volume_mm={"x": 256, "y": 256, "z": 256},
    max_nozzle_temp_c=300,
    max_bed_temp_c=110,
    max_print_speed_mm_s=400,
)
_GENERIC_PETG = FilamentInput(id="filament-generic-petg", material_class="petg", diameter_mm=1.75)
_COREXY_BASE_PROFILE = BaselineProfile(
    id="profile-corexy-020",
    profile_class="process",
    slicer="orcaslicer",
    name="0.20mm Standard @CoreXY 0.4 nozzle",
    machine_id="printer-corexy-generic",
    material_id=None,
    params={
        "kinematics": "corexy",
        "nozzle_diameter_mm": 0.4,
        "build_volume_mm": {"x": 256, "y": 256, "z": 256},
        "print_speed_mm_s": 220,
        "travel_speed_mm_s": 250,
    },
    source_name="OrcaSlicer",
    source_url=None,
    source_ref="resources/profiles/Voron/process/0.20mm Standard.json",
    license="AGPL-3.0-or-later",
    confidence=1.0,
    extrapolated_from_id=None,
)
_GENERIC_PETG_PROFILE = BaselineProfile(
    id="profile-generic-petg",
    profile_class="filament",
    slicer="orcaslicer",
    name="Generic PETG",
    machine_id=None,
    material_id="filament-generic-petg",
    params={
        "nozzle_temperature_c": {"first_layer": 235, "other": 230},
        "bed_temperature_c": {"first_layer": 80, "other": 75},
        "flow_ratio": 0.95,
        "retraction_length_mm": 0.6,
        "retraction_speed_mm_s": 25,
        "cooling_fan_speed_pct": {"min": 30, "max": 60},
    },
    source_name="OrcaSlicer",
    source_url=None,
    source_ref="resources/profiles/BBL/filament/Generic PETG.json",
    license="AGPL-3.0-or-later",
    confidence=1.0,
    extrapolated_from_id=None,
)

# --- combo 3: нет точной базы (RU-принтер) + RU-экстраполированный ABS ---
# Тот же дух, что курируемый RU-seed slicer_print_profiles_ru.py: честная
# экстраполяция confidence<1, не выдуманные вендор-специфичные числа.

_RU_PRINTER = PrinterInput(
    id="printer-picaso-designer-x",
    nozzle_diameter_mm=0.4,
    kinematics="bedslinger",
    build_volume_mm={"x": 201, "y": 201, "z": 210},
    max_nozzle_temp_c=280,
    max_bed_temp_c=110,
    max_print_speed_mm_s=150,
)
_RU_ABS_FILAMENT = FilamentInput(id="filament-fdplast-abs", material_class="abs", diameter_mm=1.75)
_NEAREST_BASE_PROFILE = BaselineProfile(
    id="profile-generic-bedslinger-020",
    profile_class="process",
    slicer="orcaslicer",
    name="0.20mm Standard @Generic bedslinger 0.4 nozzle",
    machine_id="printer-other-bedslinger",  # не совпадает с RU-принтером -> экстраполяция
    material_id=None,
    params={
        "kinematics": "bedslinger",
        "nozzle_diameter_mm": 0.4,
        "print_speed_mm_s": 120,
    },
    source_name="OrcaSlicer",
    source_url=None,
    source_ref="resources/profiles/Creality/process/0.20mm Standard.json",
    license="AGPL-3.0-or-later",
    confidence=0.9,
    extrapolated_from_id=None,
)
_RU_ABS_PROFILE = BaselineProfile(
    id="profile-fdplast-abs",
    profile_class="filament",
    slicer="orcaslicer",
    name="FDplast ABS",
    machine_id=None,
    material_id="filament-fdplast-abs",
    params={
        "nozzle_temperature_c": {"first_layer": 250, "other": 245},
        "bed_temperature_c": {"first_layer": 100, "other": 95},
        "flow_ratio": 1.0,
    },
    source_name="FDplast (экстраполяция от Generic ABS)",
    source_url=None,
    source_ref=None,
    license="AGPL-3.0-or-later",
    confidence=0.40,
    extrapolated_from_id="profile-generic-abs",
)


GOLDEN_COMBOS: list[dict[str, Any]] = [
    {
        "name": "creality-ender3v2-pla-exact",
        "printer": _CREALITY_PRINTER,
        "filament": _GENERIC_PLA,
        "base_profiles": [_CREALITY_BASE_PROFILE],
        "filament_profiles": [_GENERIC_PLA_PROFILE],
        "intent": "appearance",
    },
    {
        "name": "corexy-petg-exact-speed-intent",
        "printer": _COREXY_PRINTER,
        "filament": _GENERIC_PETG,
        "base_profiles": [_COREXY_BASE_PROFILE],
        "filament_profiles": [_GENERIC_PETG_PROFILE],
        "intent": "speed",
    },
    {
        "name": "ru-picaso-abs-extrapolated",
        "printer": _RU_PRINTER,
        "filament": _RU_ABS_FILAMENT,
        "base_profiles": [_NEAREST_BASE_PROFILE],
        "filament_profiles": [_RU_ABS_PROFILE],
        "intent": "strength",
    },
]

# Экспертные диапазоны правдоподобия (см. докстринг модуля) — применяются
# ТОЛЬКО к полям, которые AI-слой реально изменил (`changed_fields`), не ко
# всем полям базового профиля.
_PLAUSIBLE_RANGES: dict[str, tuple[float, float]] = {
    "flow_ratio": (0.85, 1.15),
    "pressure_advance_k": (0.0, 1.2),
    "retraction_length_mm": (0.2, 10.0),
    "retraction_speed_mm_s": (10.0, 80.0),
    "z_hop_mm": (0.0, 1.0),
}


def _scalar_in_range(field: str, value: Any) -> bool | None:
    bounds = _PLAUSIBLE_RANGES.get(field)
    if bounds is None or not isinstance(value, (int, float)):
        return None
    low, high = bounds
    return low <= value <= high


def score_plausibility(changed_fields: list, params: dict[str, Any]) -> tuple[float, list[str]]:
    """Доля изменённых AI-слоем полей, укладывающихся в экспертный диапазон.

    Возвращает `(score, notes)` — `score=1.0`, если AI ничего не поменял
    (безопасный no-op) или все изменения правдоподобны; `notes` — человекочитаемые
    причины для полей вне диапазона (для лога eval-прогона).
    """
    if not changed_fields:
        return 1.0, ["AI не предложил изменений — безопасный no-op, оценка максимальна"]

    checks: list[bool] = []
    notes: list[str] = []
    for change in changed_fields:
        field = change.field
        value = params.get(field)
        if field in _PLAUSIBLE_RANGES:
            ok = _scalar_in_range(field, value)
            if ok is not None:
                checks.append(ok)
                if not ok:
                    bounds = _PLAUSIBLE_RANGES[field]
                    notes.append(f"{field}={value} вне экспертного диапазона {bounds}")
        elif isinstance(value, dict):
            for nested_key, nested_value in value.items():
                if field == "cooling_fan_speed_pct":
                    ok = isinstance(nested_value, (int, float)) and 0 <= nested_value <= 100
                    checks.append(ok)
                    if not ok:
                        notes.append(f"{field}.{nested_key}={nested_value} вне 0..100%")
                # nozzle/bed temperature — уже гарантированно в пределах
                # паспорта (clamp_to_passport), отдельного экспертного
                # диапазона для них не заводим, чтобы не дублировать
                # safety-проверку под видом "качества".

    if not checks:
        return 1.0, ["изменённые поля вне словаря экспертных диапазонов — не проверено, не штраф"]
    return sum(1 for c in checks if c) / len(checks), notes
