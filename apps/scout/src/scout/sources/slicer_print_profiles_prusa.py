"""Агент-парсер PrusaSlicer process/filament профилей → unified schema (MF-411,
шаг 3 фазы 1 эпика MF-34 «Слайсер-профили (AI)»), первая часть — Prusa. Cura и
RU-специфика (филаменты FDplast/Bestfilament/REC/PLASTICO) остаются отдельным
следующим шагом (см. docs/epics/slicer.profiles.md § «Не сделано»).

Тот же паттерн, что `slicer_print_profiles` (OrcaSlicer, шаг 2): тащит
process/filament классы (не machine — тот уже покрыт `slicer_profiles.py`,
MF-627, для `machine_candidates`) и пишет в `slicer_profile_candidates`/
`slicer_profiles` (unified schema).

PrusaSlicer-бандл — INI, не JSON: наследование `inherits = A; B` (Slic3r-
конвенция, `;`-разделитель, поддерживает несколько родителей-миксинов).
Схема `slicer_profiles.inherits_id` — self-FK, только ОДИН родитель, поэтому
здесь линкуется первый parent из списка (primary); дополнительные миксины
теряются как структурная связь, но их поля всё равно попадут в родительскую
цепочку при слиянии на чтении, если совпадают со значениями конкретной ветки
— задокументированное ограничение (см. модуль-докстринг ниже «Открытые
вопросы» в slicer.profiles.md).

Секции вида `[print:*NAME*]`/`[filament:*NAME*]` (обёрнутые в `*`) — абстрактные
базовые/миксин-профили (аналог `fdm_process_common` у Orca), не выбираемые
пользователем напрямую; PrusaSlicer не даёт им `setting_id`, у нас это тоже
`setting_id=None` + `instantiable=False`.

Ретракт (retract_length/retract_speed и т.п.) у PrusaSlicer живёт в секции
`[printer:...]`, НЕ в `[filament:...]` (в отличие от Orca, где ретракт — часть
filament-профиля) — вне словаря `params` этого шага (machine-класс не тронут),
задокументировано как открытый вопрос семантики в slicer.profiles.md.
"""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

import httpx
import psycopg

from .. import db
from .slicer_print_profiles import _bool01, _int, _num, _set_nested, _text
from .slicer_profiles import (
    _PRUSA_OWNER_REPO,
    _PRUSA_REF,
    _PRUSA_VENDOR_DIRS,
    _get,
    _list_prusa_bundle_versions,
    _pick_latest_bundle_version,
    _split_semicolon,
    parse_prusa_bundle,
)

logger = logging.getLogger("scout.sources.slicer_print_profiles_prusa")

SOURCE_ID = "prusaslicer_print"
SLICER = "prusaslicer"
_LICENSE = "AGPL-3.0"
_SOURCE_NAME = "prusa3d_prusaslicer_settings"


def content_hash(payload: dict[str, Any]) -> bytes:
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).digest()


def _is_abstract(name: str) -> bool:
    """`[print:*common*]`/`[filament:*PLA*]` — миксин/базовый профиль, не
    выбираемый напрямую в UI слайсера (та же роль, что `instantiation=false`
    у Orca)."""
    return name.startswith("*") and name.endswith("*") and len(name) > 2


def _primary_parent(inherits_raw: str | None) -> str | None:
    parents = _split_semicolon(inherits_raw)
    return parents[0] if parents else None


# (native_key, unified_path, converter) — только ключи из словаря params
# (docs/epics/slicer.profiles.md § «Словарь params»); неизвестные Slic3r-ключи
# (gcode-шаблоны, compatible_printers_condition и т.п.) намеренно не
# прокидываются, тот же принцип, что у OrcaSlicer-парсера.
_PROCESS_RULES: tuple[tuple[str, str, Any], ...] = (
    ("layer_height", "layer_height_mm", _num),
    ("first_layer_height", "first_layer_height_mm", _num),
    ("external_perimeter_speed", "print_speed_mm_s", _num),
    ("first_layer_speed", "first_layer_speed_mm_s", _num),
    ("travel_speed", "travel_speed_mm_s", _num),
    ("fill_density", "infill_density_pct", _num),
    ("fill_pattern", "infill_pattern", _text),
    ("perimeters", "wall_loops", _int),
    ("top_solid_layers", "top_shell_layers", _int),
    ("bottom_solid_layers", "bottom_shell_layers", _int),
    ("support_material", "support_enable", _bool01),
    ("support_material_pattern", "support_type", _text),
    ("skirts", "skirt_loops", _int),
    ("brim_width", "brim_width_mm", _num),
)

_FILAMENT_RULES: tuple[tuple[str, str, Any], ...] = (
    ("temperature", "nozzle_temperature_c.other", _num),
    ("first_layer_temperature", "nozzle_temperature_c.first_layer", _num),
    ("bed_temperature", "bed_temperature_c.other", _num),
    ("first_layer_bed_temperature", "bed_temperature_c.first_layer", _num),
    ("filament_max_volumetric_speed", "max_volumetric_speed_mm3_s", _num),
    ("extrusion_multiplier", "flow_ratio", _num),
    ("filament_density", "density_g_cm3", _num),
    ("filament_diameter", "diameter_mm", _num),
    ("filament_cost", "cost_per_kg", _num),
)

_RULES_BY_CLASS = {"print": _PROCESS_RULES, "filament": _FILAMENT_RULES}
_CLASS_UNIFIED = {"print": "process", "filament": "filament"}


def normalize_params(ini_class: str, own: dict[str, str]) -> dict[str, Any]:
    """Дельта: только ключи, которые ЕСТЬ в собственной секции источника (не
    смёрдженные с родителем — принцип наследования unified-схемы, тот же, что
    у OrcaSlicer-парсера)."""
    params: dict[str, Any] = {}
    for native_key, unified_path, converter in _RULES_BY_CLASS[ini_class]:
        if native_key not in own:
            continue
        value = converter(own[native_key])
        _set_nested(params, unified_path, value)
    return params


class PrintProfileCandidate:
    __slots__ = (
        "profile_class",
        "vendor",
        "name",
        "inherits",
        "instantiable",
        "params",
        "raw",
        "source_url",
    )

    def __init__(
        self,
        profile_class: str,
        vendor: str,
        name: str,
        inherits: str | None,
        instantiable: bool,
        params: dict[str, Any],
        raw: dict[str, str],
        source_url: str,
    ) -> None:
        self.profile_class = profile_class
        self.vendor = vendor
        self.name = name
        self.inherits = inherits
        self.instantiable = instantiable
        self.params = params
        self.raw = raw
        self.source_url = source_url

    @property
    def external_ref(self) -> str:
        return f"{SLICER}:{self.vendor}:{self.profile_class}:{self.name}"


def build_candidate(
    ini_class: str, vendor: str, section_name: str, own: dict[str, str], source_url: str
) -> PrintProfileCandidate:
    inherits_raw = own.get("inherits")
    return PrintProfileCandidate(
        profile_class=_CLASS_UNIFIED[ini_class],
        vendor=vendor,
        name=section_name,
        inherits=_primary_parent(inherits_raw),
        instantiable=not _is_abstract(section_name),
        params=normalize_params(ini_class, own),
        raw=own,
        source_url=source_url,
    )


# --- Фетч --------------------------------------------------------------------


def fetch_vendor_candidates(client: httpx.Client, vendor_dir: str) -> list[PrintProfileCandidate]:
    versions = _list_prusa_bundle_versions(client, vendor_dir)
    bundle_version = _pick_latest_bundle_version(versions)
    if bundle_version is None:
        logger.warning("prusa print profiles: no release bundle found for %s", vendor_dir)
        return []

    source_url = (
        f"https://raw.githubusercontent.com/{_PRUSA_OWNER_REPO}/{_PRUSA_REF}/"
        f"live/{vendor_dir}/{bundle_version}"
    )
    resp = _get(client, source_url)
    if resp is None:
        return []
    parser = parse_prusa_bundle(resp.text)

    candidates: list[PrintProfileCandidate] = []
    for section in parser.sections():
        for ini_class in ("print", "filament"):
            prefix = f"{ini_class}:"
            if not section.startswith(prefix):
                continue
            section_name = section[len(prefix) :]
            own = dict(parser.items(section))
            candidates.append(build_candidate(ini_class, vendor_dir, section_name, own, source_url))
    return candidates


def fetch_all_candidates(
    client: httpx.Client, vendors: list[str] | None = None
) -> list[PrintProfileCandidate]:
    vendor_dirs = vendors if vendors is not None else list(_PRUSA_VENDOR_DIRS)
    logger.info("prusaslicer print profiles: %d vendors", len(vendor_dirs))
    all_candidates: list[PrintProfileCandidate] = []
    for vendor_dir in vendor_dirs:
        vendor_candidates = fetch_vendor_candidates(client, vendor_dir)
        logger.info(
            "prusaslicer print profiles: %s -> %d entries", vendor_dir, len(vendor_candidates)
        )
        all_candidates += vendor_candidates
    return all_candidates


# --- Ingest --------------------------------------------------------------------


def ingest(
    conn: psycopg.Connection, client: httpx.Client, vendors: list[str] | None = None
) -> dict[str, int]:
    candidates = fetch_all_candidates(client, vendors)
    counters = {"found": len(candidates), "candidates": 0, "promoted": 0}

    occurrences: list[tuple[PrintProfileCandidate, str]] = []
    for candidate in candidates:
        raw_hash = content_hash(candidate.raw)
        db.upsert_slicer_profile_candidate(
            conn,
            source=SOURCE_ID,
            source_url=candidate.source_url,
            external_ref=candidate.external_ref,
            raw=candidate.raw,
            content_hash=raw_hash,
        )
        counters["candidates"] += 1

        profile_hash = content_hash(
            {
                "profile_class": candidate.profile_class,
                "slicer": SLICER,
                "name": candidate.name,
                "params": candidate.params,
            }
        )
        profile_id = db.upsert_slicer_profile(
            conn,
            profile_class=candidate.profile_class,
            slicer=SLICER,
            setting_id=None,
            name=candidate.name,
            params=candidate.params,
            source_name=_SOURCE_NAME,
            source_url=candidate.source_url,
            source_ref=candidate.source_url,
            license=_LICENSE,
            confidence=1.0,
            content_hash=profile_hash,
        )
        db.mark_slicer_profile_candidate_merged(
            conn, source=SOURCE_ID, external_ref=candidate.external_ref, profile_id=profile_id
        )
        counters["promoted"] += 1
        occurrences.append((candidate, profile_id))

    linked = db.link_slicer_profile_inherits(
        conn,
        [
            (
                profile_id,
                SLICER,
                candidate.vendor,
                candidate.profile_class,
                candidate.name,
                candidate.inherits,
            )
            for candidate, profile_id in occurrences
        ],
    )
    counters["inherits_linked"] = linked
    return counters
