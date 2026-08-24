"""Документированный Python-порт `apps/api/src/slicerProfiles/matcher.ts` (MF-412).

Зачем порт, а не импорт: `apps/api` (TypeScript/Node) и `apps/giga` (Python)
интегрируются только через общий `DATABASE_URL` — общего рантайма/HTTP-моста
между сервисами нет (см. `apps/giga/src/giga/catalog/__init__.py` докстринг —
тот же принцип, применённый к машинам каталога). Карточка MF-1941 прямо
требует "не изобретать заново" клэмпинг по паспорту принтера — литеральный
шаринг кода между языками невозможен, поэтому это осознанный, поддерживаемый
порт: имена полей/формулы/пороги 1:1 повторяют TS-оригинал, а
`tests/test_slicer_ai_matcher_port.py` — тот же набор сценариев, что
`apps/api/src/slicerProfiles/matcher.test.ts`, чтобы порт не разъехался с
оригиналом молча. AI-слой (`delta.py`) обязан клэмпить свои дельты ЭТОЙ ЖЕ
функцией `clamp_to_passport`, не собственной копией — единственный источник
safety-правил внутри `apps/giga`.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from functools import reduce
from typing import Any, Literal

ProfileClass = Literal["machine", "process", "filament"]
SlicerName = Literal["orcaslicer", "prusaslicer", "cura"]
ProfileIntent = Literal["strength", "speed", "appearance", "miniatures"]

INTENT_NAMES: dict[str, str] = {
    "strength": "прочность",
    "speed": "скорость",
    "appearance": "вид",
    "miniatures": "миниатюры",
}

_PASSPORT_REASON = "ограничено паспортом принтера для безопасности"


class NoMatchingProfileError(Exception):
    """Нет ни одного `machine`/`process` профиля-кандидата под связку (matcher.ts)."""


@dataclass(frozen=True)
class PrinterInput:
    id: str
    nozzle_diameter_mm: float | None
    kinematics: str | None
    build_volume_mm: dict[str, float | None]
    max_nozzle_temp_c: float | None
    max_bed_temp_c: float | None
    max_print_speed_mm_s: float | None


@dataclass(frozen=True)
class FilamentInput:
    id: str
    material_class: str
    diameter_mm: float | None


@dataclass(frozen=True)
class BaselineProfile:
    id: str
    profile_class: ProfileClass
    slicer: SlicerName
    name: str
    machine_id: str | None
    material_id: str | None
    params: dict[str, Any]
    source_name: str
    source_url: str | None
    source_ref: str | None
    license: str
    confidence: float
    extrapolated_from_id: str | None
    inherits_id: str | None = None


@dataclass
class ChangedField:
    field: str
    value: Any
    reason: str


@dataclass
class RecommendationOrigin:
    base_profile_id: str
    base_profile_name: str
    slicer: SlicerName
    source_name: str
    source_url: str | None
    source_ref: str | None
    license: str
    overlay_profile_ids: list[str]
    changed_fields: list[ChangedField]


@dataclass
class Recommendation:
    params: dict[str, Any]
    confidence: float
    extrapolated: bool
    disclaimer: str
    origin: RecommendationOrigin


def _is_record(value: Any) -> bool:
    return isinstance(value, dict)


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def clone(value: Any) -> Any:
    if isinstance(value, list):
        return [clone(item) for item in value]
    if _is_record(value):
        return {key: clone(item) for key, item in value.items()}
    return value


def merge(base: dict[str, Any], delta: dict[str, Any]) -> dict[str, Any]:
    result = clone(base)
    for key, value in delta.items():
        existing = result.get(key)
        if _is_record(existing) and _is_record(value):
            result[key] = merge(existing, value)
        else:
            result[key] = clone(value)
    return result


def number_at(value: Any, path: list[str]) -> float | None:
    current = value
    for segment in path:
        if not _is_record(current):
            return None
        current = current.get(segment)
    return current if _is_number(current) else None


def distance(actual: float | None, expected: float | None, scale: float = 1) -> float:
    if actual is None or expected is None:
        return 0
    return abs(actual - expected) / scale


def profile_key_distance(profile: BaselineProfile, printer: PrinterInput) -> float:
    params = profile.params
    if profile.machine_id == printer.id:
        score = 0.0
    elif profile.machine_id is None:
        score = 0.5
    else:
        score = 25.0
    profile_kinematics = params.get("kinematics")
    profile_kinematics = profile_kinematics.lower() if isinstance(profile_kinematics, str) else None
    printer_kinematics = printer.kinematics.lower() if printer.kinematics else None
    if profile_kinematics and printer_kinematics and profile_kinematics != printer_kinematics:
        score += 10
    score += distance(number_at(params, ["nozzle_diameter_mm"]), printer.nozzle_diameter_mm, 0.1)
    for axis in ("x", "y", "z"):
        score += distance(
            number_at(params, ["build_volume_mm", axis]), printer.build_volume_mm.get(axis), 100
        )
    score += distance(number_at(params, ["max_nozzle_temp_c"]), printer.max_nozzle_temp_c, 50)
    score += distance(number_at(params, ["max_bed_temp_c"]), printer.max_bed_temp_c, 30)
    return score


def is_exact_base(profile: BaselineProfile, printer: PrinterInput) -> bool:
    if profile.extrapolated_from_id is not None:
        return False
    if profile.machine_id is not None and profile.machine_id != printer.id:
        return False
    return profile_key_distance(profile, printer) == 0


def select_base(
    profiles: list[BaselineProfile], printer: PrinterInput
) -> tuple[BaselineProfile, bool] | None:
    candidates = [p for p in profiles if p.profile_class in ("process", "machine")]
    if not candidates:
        return None
    def _sort_key(p: BaselineProfile) -> tuple[int, float, str]:
        return (0 if p.profile_class == "process" else 1, profile_key_distance(p, printer), p.id)

    sorted_candidates = sorted(candidates, key=_sort_key)
    profile = sorted_candidates[0]
    return profile, is_exact_base(profile, printer)


def select_overlay(
    profiles: list[BaselineProfile], filament: FilamentInput, nozzle_diameter_mm: float | None
) -> BaselineProfile | None:
    def matches(profile: BaselineProfile) -> bool:
        if profile.material_id == filament.id:
            return True
        material_class = (
            profile.params.get("material_class")
            or profile.params.get("material_type")
            or profile.params.get("material_family")
        )
        if not isinstance(material_class, str):
            return False
        return material_class.lower() == filament.material_class.lower()

    candidates = [p for p in profiles if p.profile_class == "filament" and matches(p)]
    if not candidates:
        return None
    sorted_candidates = sorted(
        candidates,
        key=lambda p: (
            0 if p.material_id == filament.id else 1,
            distance(number_at(p.params, ["nozzle_diameter_mm"]), nozzle_diameter_mm, 0.1),
            p.id,
        ),
    )
    return sorted_candidates[0]


def add_changed(changed: list[ChangedField], field_name: str, value: Any, reason: str) -> None:
    for existing in changed:
        if existing.field == field_name:
            existing.value = clone(value)
            existing.reason = f"{existing.reason}; {reason}"
            return
    changed.append(ChangedField(field=field_name, value=clone(value), reason=reason))


def top_level_delta_keys(before: dict[str, Any], after: dict[str, Any]) -> list[str]:
    return [key for key in after if after[key] != before.get(key)]


def apply_intent(
    params: dict[str, Any], intent: str, changed: list[ChangedField]
) -> dict[str, Any]:
    overrides = params.get("intent_overrides")
    intent_override = overrides.get(intent) if _is_record(overrides) else None
    configured = intent_override if _is_record(intent_override) else {}
    without_overrides = {key: value for key, value in params.items() if key != "intent_overrides"}
    result = merge(without_overrides, configured)
    reason = f"настройка intent «{INTENT_NAMES[intent]}»"
    for field_name in top_level_delta_keys(without_overrides, result):
        add_changed(changed, field_name, result[field_name], reason)
    return result


def clamp_value(
    params: dict[str, Any],
    changed: list[ChangedField],
    key: str,
    max_value: float | None,
    reason: str,
) -> None:
    if max_value is None:
        return
    value = params.get(key)
    if _is_number(value) and value > max_value:
        params[key] = max_value
        add_changed(changed, key, max_value, reason)
        return
    if not _is_record(value):
        return
    next_value = clone(value)
    did_clamp = False
    for nested_key, nested_value in next_value.items():
        if _is_number(nested_value) and nested_value > max_value:
            next_value[nested_key] = max_value
            did_clamp = True
    if did_clamp:
        params[key] = next_value
        add_changed(changed, key, next_value, reason)


def clamp_to_passport(
    params: dict[str, Any], printer: PrinterInput, changed: list[ChangedField]
) -> None:
    """Единственная safety-граница `apps/giga` — мутирует `params` на месте,
    как и TS-оригинал `matcher.ts::clampToPassport`. Вызывается и на
    детерминированном профиле, и на AI-дельтах (`delta.py`) — см. докстринг
    модуля."""
    max_nozzle = printer.max_nozzle_temp_c
    max_bed = printer.max_bed_temp_c
    clamp_value(params, changed, "nozzle_temperature_c", max_nozzle, _PASSPORT_REASON)
    clamp_value(params, changed, "nozzle_temp_c", max_nozzle, _PASSPORT_REASON)
    clamp_value(params, changed, "bed_temperature_c", max_bed, _PASSPORT_REASON)
    clamp_value(params, changed, "bed_temp_c", max_bed, _PASSPORT_REASON)
    if printer.max_print_speed_mm_s is not None:
        for key in list(params.keys()):
            if (
                key in ("print_speed_mm_s", "first_layer_speed_mm_s", "travel_speed_mm_s")
                or key.endswith("wall_speed_mm_s")
            ):
                clamp_value(params, changed, key, printer.max_print_speed_mm_s, _PASSPORT_REASON)


def resolve_inheritance(
    profile: BaselineProfile, profiles: list[BaselineProfile]
) -> tuple[dict[str, Any], list[str]]:
    by_id = {p.id: p for p in profiles}
    chain: list[BaselineProfile] = []
    seen: set[str] = set()
    current: BaselineProfile | None = profile
    while current is not None and current.id not in seen:
        seen.add(current.id)
        chain.insert(0, current)
        parent_id = current.inherits_id
        current = by_id.get(parent_id) if parent_id else None
    params = reduce(lambda result, item: merge(result, item.params), chain, {})
    return params, [item.id for item in chain]


def _round2(value: float) -> float:
    # Math.round JS — округление к ближайшему с half-up (не banker's rounding
    # Python `round()`); все входные значения здесь неотрицательны (confidence).
    return math.floor(value * 100 + 0.5) / 100


def recommend_profile(
    printer: PrinterInput,
    filament: FilamentInput,
    base_profiles: list[BaselineProfile],
    filament_profiles: list[BaselineProfile],
    intent: str = "appearance",
) -> Recommendation:
    base_selection = select_base(base_profiles, printer)
    if base_selection is None:
        raise NoMatchingProfileError()
    base, exact = base_selection
    resolved_params, _ids = resolve_inheritance(base, [*base_profiles, *filament_profiles])
    changed: list[ChangedField] = []
    overlay = select_overlay(filament_profiles, filament, printer.nozzle_diameter_mm)
    params = resolved_params
    overlay_ids: list[str] = []
    if overlay is not None:
        before = params
        params = merge(params, overlay.params)
        for field_name in top_level_delta_keys(before, params):
            if field_name != "intent_overrides":
                add_changed(
                    changed,
                    field_name,
                    params[field_name],
                    f"дельта материала класса «{filament.material_class}»",
                )
        overlay_ids.append(overlay.id)
    params = apply_intent(params, intent, changed)
    clamp_to_passport(params, printer, changed)

    extrapolated = not exact
    overlay_confidence = overlay.confidence if overlay else 1.0
    extrapolation_penalty = 0.75 if extrapolated else 1.0
    confidence = _round2(
        max(0.0, min(1.0, base.confidence * overlay_confidence * extrapolation_penalty))
    )
    disclaimer = (
        "Профиль экстраполирован из ближайшего базового класса; перед печатью проверьте "
        "температуры и скорости по паспорту принтера."
        if extrapolated
        else "Профиль подобран детерминированно и ограничен паспортом принтера; перед печатью "
        "проверьте фактические условия."
    )
    return Recommendation(
        params=params,
        confidence=confidence,
        extrapolated=extrapolated,
        disclaimer=disclaimer,
        origin=RecommendationOrigin(
            base_profile_id=base.id,
            base_profile_name=base.name,
            slicer=base.slicer,
            source_name=base.source_name,
            source_url=base.source_url,
            source_ref=base.source_ref,
            license=base.license,
            overlay_profile_ids=overlay_ids,
            changed_fields=changed,
        ),
    )
