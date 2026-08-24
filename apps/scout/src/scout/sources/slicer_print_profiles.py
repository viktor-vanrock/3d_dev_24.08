"""Агент-парсер OrcaSlicer process/filament профилей → unified schema (MF-411,
шаг 2 фазы 1 эпика MF-34 «Слайсер-профили (AI)»).

В отличие от `slicer_profiles.py` (MF-627 — вытаскивает только machine-класс,
бутстрап `machine_candidates` для каталога станков), этот источник вытаскивает
process/filament классы (температуры/скорости/охлаждение/ретракт — собственно
настройки печати) и пишет в `slicer_profile_candidates`/`slicer_profiles`
(unified schema, docs/epics/slicer.profiles.md), другую пару таблиц.

Наследование хранится КАК ДЕЛЬТА (принцип схемы, зеркалит сам OrcaSlicer
`inherits`): нормализуется только то, что профиль переопределяет сам (собственные
ключи JSON-файла источника), не смёрдженные с родителем значения — резолвер
(MF-16, вне территории этой карточки) мёржит цепочку `inherits_id` на чтении.

Каждый вендор в `resources/profiles/<vendor>/` несёт СВОЮ копию всей цепочки
наследования (включая общие `fdm_process_common`/`fdm_filament_common`), поэтому
resolution `inherits` полностью self-contained внутри одного вендора — не нужно
искать родителя в чужом вендор-неймспейсе.
"""

from __future__ import annotations

import hashlib
import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Any

import httpx
import psycopg

from .. import db
from .slicer_profiles import _CONCURRENCY, _get_json, _orca_raw_url, list_orca_vendors

logger = logging.getLogger("scout.sources.slicer_print_profiles")

SOURCE_ID = "orcaslicer_print"
SLICER = "orcaslicer"
_LICENSE = "AGPL-3.0"
_SOURCE_NAME = "softfever_orcaslicer"


@dataclass(frozen=True)
class PrintProfileCandidate:
    profile_class: str  # 'process' | 'filament'
    vendor: str
    name: str
    setting_id: str | None
    inherits: str | None
    instantiable: bool
    params: dict[str, Any]
    raw: dict[str, Any]
    source_url: str

    @property
    def external_ref(self) -> str:
        return f"{SLICER}:{self.vendor}:{self.profile_class}:{self.name}"


def content_hash(payload: dict[str, Any]) -> bytes:
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).digest()


# --- Нормализация значений ------------------------------------------------


def _as_scalar(value: Any) -> Any:
    """Часть настроек OrcaSlicer хранит как `[per_extruder, ...]` (multi-extruder
    массив) — берём первый элемент. Точность на несколько экструдеров не нужна
    этому шагу (резолвер MF-16 работает с одним значением на профиль)."""
    if isinstance(value, list):
        return value[0] if value else None
    return value


def _num(value: Any) -> float | None:
    raw = _as_scalar(value)
    if raw is None or raw == "nil":
        return None
    text = str(raw).strip().rstrip("%")
    try:
        return float(text)
    except ValueError:
        return None


def _int(value: Any) -> int | None:
    num = _num(value)
    return int(num) if num is not None else None


def _bool01(value: Any) -> bool | None:
    raw = _as_scalar(value)
    if raw is None:
        return None
    text = str(raw).strip()
    if text not in ("0", "1"):
        return None
    return text == "1"


def _text(value: Any) -> str | None:
    raw = _as_scalar(value)
    if raw is None or raw == "nil" or raw == "":
        return None
    return str(raw)


def _set_nested(params: dict[str, Any], path: str, value: Any) -> None:
    if value is None:
        return
    parts = path.split(".")
    node = params
    for part in parts[:-1]:
        node = node.setdefault(part, {})
    node[parts[-1]] = value


# (native_key, unified_path, converter) — только ключи из словаря params
# (docs/epics/slicer.profiles.md § «Словарь params»). Неизвестные Orca-ключи
# намеренно не прокидываются (gcode-шаблоны/список совместимых принтеров и
# т.п. — не часть unified-словаря печатных настроек этого шага).
_PROCESS_RULES: tuple[tuple[str, str, Any], ...] = (
    ("layer_height", "layer_height_mm", _num),
    ("initial_layer_print_height", "first_layer_height_mm", _num),
    ("outer_wall_speed", "print_speed_mm_s", _num),
    ("initial_layer_speed", "first_layer_speed_mm_s", _num),
    ("travel_speed", "travel_speed_mm_s", _num),
    ("sparse_infill_density", "infill_density_pct", _num),
    ("sparse_infill_pattern", "infill_pattern", _text),
    ("wall_loops", "wall_loops", _int),
    ("top_shell_layers", "top_shell_layers", _int),
    ("bottom_shell_layers", "bottom_shell_layers", _int),
    ("enable_support", "support_enable", _bool01),
    ("support_type", "support_type", _text),
    ("skirt_loops", "skirt_loops", _int),
    ("brim_width", "brim_width_mm", _num),
)

_FILAMENT_RULES: tuple[tuple[str, str, Any], ...] = (
    ("nozzle_temperature", "nozzle_temperature_c.other", _num),
    ("nozzle_temperature_initial_layer", "nozzle_temperature_c.first_layer", _num),
    # `hot_plate_temp*` — температура стола для самого распространённого типа
    # поверхности (PEI); Orca также хранит cool/eng/textured-варианты, которые
    # этот словарь не различает (unified-схема держит один bed_temperature_c).
    ("hot_plate_temp", "bed_temperature_c.other", _num),
    ("hot_plate_temp_initial_layer", "bed_temperature_c.first_layer", _num),
    ("filament_max_volumetric_speed", "max_volumetric_speed_mm3_s", _num),
    ("filament_flow_ratio", "flow_ratio", _num),
    ("filament_retraction_length", "retraction_length_mm", _num),
    ("filament_retraction_speed", "retraction_speed_mm_s", _num),
    ("filament_z_hop", "z_hop_mm", _num),
    ("filament_density", "density_g_cm3", _num),
    ("filament_diameter", "diameter_mm", _num),
    ("filament_cost", "cost_per_kg", _num),
    ("fan_min_speed", "cooling_fan_speed_pct.min", _num),
    ("fan_max_speed", "cooling_fan_speed_pct.max", _num),
)

_RULES_BY_CLASS = {"process": _PROCESS_RULES, "filament": _FILAMENT_RULES}


def normalize_params(profile_class: str, doc: dict[str, Any]) -> dict[str, Any]:
    """Дельта: только ключи, которые ЕСТЬ в собственном JSON-файле источника
    (не смёрдженные с родителем — принцип наследования unified-схемы)."""
    params: dict[str, Any] = {}
    for native_key, unified_path, converter in _RULES_BY_CLASS[profile_class]:
        if native_key not in doc:
            continue
        value = converter(doc[native_key])
        _set_nested(params, unified_path, value)
    return params


def build_candidate(
    profile_class: str, vendor: str, entry_name: str, doc: dict[str, Any], source_url: str
) -> PrintProfileCandidate:
    name = doc.get("name", entry_name)
    return PrintProfileCandidate(
        profile_class=profile_class,
        vendor=vendor,
        name=name,
        setting_id=_text(doc.get("setting_id")),
        inherits=_text(doc.get("inherits")),
        instantiable=_text(doc.get("instantiation")) == "true",
        params=normalize_params(profile_class, doc),
        raw=doc,
        source_url=source_url,
    )


# --- Фетч ------------------------------------------------------------------


def _fetch_class(
    client: httpx.Client, vendor: str, profile_class: str, entries: list[dict[str, Any]]
) -> list[PrintProfileCandidate]:
    def fetch_one(entry: dict[str, Any]) -> PrintProfileCandidate | None:
        doc = _get_json(client, _orca_raw_url(vendor, entry["sub_path"]))
        if doc is None or doc.get("type") != profile_class:
            return None
        return build_candidate(
            profile_class, vendor, entry["name"], doc, _orca_raw_url(vendor, entry["sub_path"])
        )

    candidates: list[PrintProfileCandidate] = []
    with ThreadPoolExecutor(max_workers=_CONCURRENCY) as pool:
        futures = [pool.submit(fetch_one, entry) for entry in entries]
        for future in as_completed(futures):
            result = future.result()
            if result is not None:
                candidates.append(result)
    return candidates


def fetch_vendor_candidates(client: httpx.Client, vendor: str) -> list[PrintProfileCandidate]:
    index = _get_json(client, _orca_raw_url(f"{vendor}.json"))
    if not index:
        return []
    candidates: list[PrintProfileCandidate] = []
    candidates += _fetch_class(client, vendor, "process", index.get("process_list", []))
    candidates += _fetch_class(client, vendor, "filament", index.get("filament_list", []))
    return candidates


def fetch_all_candidates(
    client: httpx.Client, vendors: list[str] | None = None
) -> list[PrintProfileCandidate]:
    vendor_names = vendors if vendors is not None else list_orca_vendors(client)
    logger.info("orcaslicer print profiles: %d vendors", len(vendor_names))
    all_candidates: list[PrintProfileCandidate] = []
    for vendor in vendor_names:
        vendor_candidates = fetch_vendor_candidates(client, vendor)
        logger.info("orcaslicer print profiles: %s -> %d entries", vendor, len(vendor_candidates))
        all_candidates += vendor_candidates
    return all_candidates


# --- Ingest ------------------------------------------------------------------


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
            setting_id=candidate.setting_id,
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
