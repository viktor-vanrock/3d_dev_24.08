"""Агент-парсер Cura process/filament профилей → unified schema (MF-411, шаг 3
фазы 1 эпика MF-34 «Слайсер-профили (AI)»), последняя часть шага 3 — Cura
(Orca — шаг 2, Prusa и RU-филаменты — предыдущие коммиты этого шага).

Cura устроена принципиально иначе, чем Orca/Prusa (container-stack:
definition → variant → material → quality → intent, см. «Открытые вопросы»
slicer.profiles.md), поэтому в отличие от `slicer_print_profiles`/
`slicer_print_profiles_prusa` этот источник читает ДВА независимых
GitHub-репозитория с разными форматами и разными лицензиями:

- **`process`** — `Ultimaker/Cura`, `resources/quality/*.inst.cfg` — ТОЛЬКО
  файлы верхнего уровня (глобальные quality-тиры типа `normal.inst.cfg`,
  `[general] definition = fdmprinter`), не рекурсируем в per-printer
  подпапки (`resources/quality/<printer>/...`, сотни вендоров × нозл ×
  материал × тир — на порядки больше объёма, чем бюджет одного прогона
  этого шага; тот же принцип "ограничено ради бюджета", что и 16 вендоров
  OrcaSlicer в `slicer_profiles.py`). INI-формат (`configparser`), лицензия
  LGPL-3.0 (лицензия Cura).
- **`filament`** — `Ultimaker/fdm_materials` (с некоторого времени материалы
  Cura живут в отдельном репо, не в `Ultimaker/Cura`), корневые
  `*.xml.fdm_material` файлы (Ultimaker fdmmaterial XML, только собственные
  `<properties>`/верхнеуровневые `<settings><setting>`, БЕЗ per-`<machine>`
  переопределений — та же дельта-логика, что "не тащим machine-специфику" у
  Orca/Prusa). Лицензия CC0-1.0 (репозиторий целиком CC0, не LGPL — другая
  лицензия, чем Cura-код, оба поля `source.license` разные внутри одного
  парсера — намеренно, не баг).

  Здесь же органически находятся РЕАЛЬНЫЕ (не экстраполированные) профили
  RU-вендоров, которых сам вендор опубликовал под Cura: `fdplast_*`
  (FDplast) и `bestfilament_*` (Best Filament), PLA/PETG/ABS у обоих — в
  отличие от курируемого seed `slicer_print_profiles_ru.py` (confidence=1.0,
  не extrapolated, вендор — источник истины, как у любого другого прямого
  импорта). REC/PLASTICO Cura-профилей в репозитории нет — остаются только в
  курируемом RU-seed.

Наследование (`inherits_id`) НЕ проставляется этим источником: ни у
Cura quality-тиров (это independent siblings поверх `fdmprinter` дефолтов,
не цепочка друг-от-друга), ни у fdm_material XML (формат не имеет
текстового `inherits` — родство «этот PLA похож на generic PLA» нигде не
закодировано в самом файле) нет декларативного родителя внутри unified-схемы
— задокументированное ограничение, зеркалит открытый вопрос Prusa-ретракта в
`slicer_print_profiles_prusa.py`.
"""

from __future__ import annotations

import configparser
import hashlib
import json
import logging
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Any

import httpx
import psycopg

from .. import db
from .slicer_print_profiles import _int, _num, _set_nested, _text
from .slicer_profiles import _CONCURRENCY, _get

logger = logging.getLogger("scout.sources.slicer_print_profiles_cura")

SOURCE_ID = "cura_print"
SLICER = "cura"

_QUALITY_OWNER_REPO = "Ultimaker/Cura"
_QUALITY_REF = "main"
_QUALITY_PATH = "resources/quality"
_QUALITY_LICENSE = "LGPL-3.0"
_QUALITY_SOURCE_NAME = "ultimaker_cura"

_MATERIAL_OWNER_REPO = "Ultimaker/fdm_materials"
_MATERIAL_REF = "master"
_MATERIAL_LICENSE = "CC0-1.0"
_MATERIAL_SOURCE_NAME = "ultimaker_fdm_materials"


@dataclass(frozen=True)
class CuraProfileCandidate:
    profile_class: str  # 'process' | 'filament'
    vendor: str
    name: str
    ref_key: str
    setting_id: str | None
    params: dict[str, Any]
    raw: dict[str, Any]
    source_url: str
    source_name: str
    license: str

    @property
    def external_ref(self) -> str:
        return f"{SLICER}:{self.vendor}:{self.profile_class}:{self.ref_key}"


def content_hash(payload: dict[str, Any]) -> bytes:
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).digest()


def _bool_cura(value: Any) -> bool | None:
    """Cura INI-значения булевых настроек — Python-style `True`/`False`
    текстом (в отличие от Orca `0`/`1`)."""
    text = str(value).strip()
    if text not in ("True", "False"):
        return None
    return text == "True"


# --- Process (quality) -----------------------------------------------------

# (native_key, unified_path, converter) — только ключи из словаря params
# (docs/epics/slicer.profiles.md § «Словарь params»), настоящие ключи
# `fdmprinter.def.json` (проверено против верхнего репозитория). Значения
# вида `=math.ceil(...)` (Cura setting_function, ссылается на другие ключи
# символьно) не парсятся `_num`/`_int` (ValueError → None) — намеренно
# отбрасываются, не гадаем результат формулы вместо честного числа.
_PROCESS_RULES: tuple[tuple[str, str, Any], ...] = (
    ("layer_height", "layer_height_mm", _num),
    ("layer_height_0", "first_layer_height_mm", _num),
    ("speed_print", "print_speed_mm_s", _num),
    ("speed_layer_0", "first_layer_speed_mm_s", _num),
    ("speed_travel", "travel_speed_mm_s", _num),
    ("infill_sparse_density", "infill_density_pct", _num),
    ("infill_pattern", "infill_pattern", _text),
    ("wall_line_count", "wall_loops", _int),
    ("top_layers", "top_shell_layers", _int),
    ("bottom_layers", "bottom_shell_layers", _int),
    ("support_enable", "support_enable", _bool_cura),
    ("support_pattern", "support_type", _text),
    ("skirt_line_count", "skirt_loops", _int),
    ("brim_width", "brim_width_mm", _num),
)


def normalize_process_params(values: dict[str, str]) -> dict[str, Any]:
    params: dict[str, Any] = {}
    for native_key, unified_path, converter in _PROCESS_RULES:
        if native_key not in values:
            continue
        value = converter(values[native_key])
        _set_nested(params, unified_path, value)
    return params


def parse_quality_cfg(ini_text: str) -> configparser.RawConfigParser:
    """Cura `.inst.cfg` — `[general]`/`[metadata]`/`[values]`. `RawConfigParser`
    без интерполяции — `[values]` содержит `%`-подобные Cura setting_function
    выражения, которые `%`-интерполяция ConfigParser сломает (тот же довод,
    что у `parse_prusa_bundle`)."""
    parser = configparser.RawConfigParser(strict=False)
    parser.optionxform = str  # type: ignore[assignment]
    parser.read_string(ini_text)
    return parser


def build_quality_candidate(
    stem: str, parser: configparser.RawConfigParser, source_url: str
) -> CuraProfileCandidate | None:
    if not parser.has_section("general") or not parser.has_section("values"):
        return None
    general = dict(parser.items("general"))
    # Только истинно глобальные тиры (`definition = fdmprinter`) — файлы вида
    # `tank_m_base_global_*.inst.cfg` формально лежат в корне `resources/quality/`,
    # но `definition` у них — конкретный принтер, не общий дефолт; пропускаем,
    # чтобы не смешать per-printer оверрайд с честным generic-профилем.
    if general.get("definition") != "fdmprinter":
        return None
    values = dict(parser.items("values"))
    name = general.get("name", stem)
    return CuraProfileCandidate(
        profile_class="process",
        vendor="fdmprinter",
        name=name,
        ref_key=stem,
        setting_id=None,
        params=normalize_process_params(values),
        raw=values,
        source_url=source_url,
        source_name=_QUALITY_SOURCE_NAME,
        license=_QUALITY_LICENSE,
    )


def _quality_raw_url(filename: str) -> str:
    return (
        f"https://raw.githubusercontent.com/{_QUALITY_OWNER_REPO}/{_QUALITY_REF}/"
        f"{_QUALITY_PATH}/{filename}"
    )


def list_quality_files(client: httpx.Client) -> list[str]:
    url = (
        f"https://api.github.com/repos/{_QUALITY_OWNER_REPO}/contents/"
        f"{_QUALITY_PATH}?ref={_QUALITY_REF}"
    )
    resp = _get(client, url)
    if resp is None:
        return []
    entries = resp.json()
    return [e["name"] for e in entries if e["type"] == "file" and e["name"].endswith(".inst.cfg")]


def fetch_quality_candidates(client: httpx.Client) -> list[CuraProfileCandidate]:
    filenames = list_quality_files(client)
    logger.info("cura quality: %d top-level files", len(filenames))

    def fetch_one(filename: str) -> CuraProfileCandidate | None:
        source_url = _quality_raw_url(filename)
        resp = _get(client, source_url)
        if resp is None:
            return None
        stem = filename[: -len(".inst.cfg")]
        try:
            parser = parse_quality_cfg(resp.text)
        except configparser.Error:
            logger.warning("cura quality: failed to parse %s", filename)
            return None
        return build_quality_candidate(stem, parser, source_url)

    candidates: list[CuraProfileCandidate] = []
    with ThreadPoolExecutor(max_workers=_CONCURRENCY) as pool:
        futures = [pool.submit(fetch_one, name) for name in filenames]
        for future in as_completed(futures):
            result = future.result()
            if result is not None:
                candidates.append(result)
    return candidates


# --- Filament (material) -----------------------------------------------------

# Ultimaker `XmlMaterialProfile.__material_settings_setting_map`/
# `__material_properties_setting_map` — единственные ключи, у которых Cura
# сама признаёт устойчивое соответствие material-настройке (остальные —
# per-`<machine>`/per-`<hotend>` оверрайды, вне словаря этого шага, тот же
# принцип, что и у Orca/Prusa-парсеров).
_FILAMENT_RULES: tuple[tuple[str, str, Any], ...] = (
    ("print temperature", "nozzle_temperature_c.other", _num),
    ("heated bed temperature", "bed_temperature_c.other", _num),
    ("density", "density_g_cm3", _num),
    ("diameter", "diameter_mm", _num),
)


def normalize_filament_params(own: dict[str, str]) -> dict[str, Any]:
    params: dict[str, Any] = {}
    for native_key, unified_path, converter in _FILAMENT_RULES:
        if native_key not in own:
            continue
        value = converter(own[native_key])
        _set_nested(params, unified_path, value)
    return params


def _local_tag(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def _child(elem: ET.Element, name: str) -> ET.Element | None:
    for c in elem:
        if _local_tag(c.tag) == name:
            return c
    return None


def _direct_children(elem: ET.Element, name: str) -> list[ET.Element]:
    return [c for c in elem if _local_tag(c.tag) == name]


def _elem_text(elem: ET.Element | None) -> str | None:
    if elem is None or elem.text is None:
        return None
    text = elem.text.strip()
    return text or None


def parse_fdm_material(xml_text: str) -> tuple[dict[str, str], dict[str, str]] | None:
    """Возвращает `(identity, own)` — идентичность профиля (brand/material/
    color/label/guid) и дельта-настройки (properties + верхнеуровневые
    `<settings><setting>`, БЕЗ вложенных `<machine>`-оверрайдов — `for c in
    elem` у ElementTree обходит только прямых детей, `<setting>` внутри
    `<machine>` сюда не попадают). `None` — битый/непонятный XML, источник
    честно пропускает запись, не падает на одном плохом файле (тот же
    принцип воркера "враждебный вход", что у apps/mesh)."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return None

    metadata = _child(root, "metadata")
    if metadata is None:
        return None
    name_el = _child(metadata, "name")
    guid = _elem_text(_child(metadata, "GUID"))
    if name_el is None or not guid:
        return None

    identity = {
        "guid": guid,
        "brand": _elem_text(_child(name_el, "brand")) or "Generic",
        "material": _elem_text(_child(name_el, "material")) or "",
        "color": _elem_text(_child(name_el, "color")) or "",
        "label": _elem_text(_child(name_el, "label")) or "",
    }

    own: dict[str, str] = {}
    properties = _child(root, "properties")
    if properties is not None:
        for key in ("density", "diameter"):
            value = _elem_text(_child(properties, key))
            if value is not None:
                own[key] = value

    settings = _child(root, "settings")
    if settings is not None:
        for setting_el in _direct_children(settings, "setting"):
            key = setting_el.get("key")
            value = _elem_text(setting_el)
            if key and value is not None:
                own[key] = value

    return identity, own


def build_material_candidate(
    identity: dict[str, str], own: dict[str, str], source_url: str
) -> CuraProfileCandidate:
    name = identity["label"] or " ".join(
        part for part in (identity["brand"], identity["material"], identity["color"]) if part
    )
    return CuraProfileCandidate(
        profile_class="filament",
        vendor=identity["brand"],
        name=name,
        ref_key=identity["guid"],
        setting_id=identity["guid"],
        params=normalize_filament_params(own),
        raw={**identity, **own},
        source_url=source_url,
        source_name=_MATERIAL_SOURCE_NAME,
        license=_MATERIAL_LICENSE,
    )


def _material_raw_url(filename: str) -> str:
    return f"https://raw.githubusercontent.com/{_MATERIAL_OWNER_REPO}/{_MATERIAL_REF}/{filename}"


def list_material_files(client: httpx.Client) -> list[str]:
    url = f"https://api.github.com/repos/{_MATERIAL_OWNER_REPO}/contents?ref={_MATERIAL_REF}"
    resp = _get(client, url)
    if resp is None:
        return []
    entries = resp.json()
    return [
        e["name"]
        for e in entries
        if e["type"] == "file" and e["name"].endswith(".xml.fdm_material")
    ]


def fetch_material_candidates(client: httpx.Client) -> list[CuraProfileCandidate]:
    filenames = list_material_files(client)
    logger.info("cura material: %d files", len(filenames))

    def fetch_one(filename: str) -> CuraProfileCandidate | None:
        source_url = _material_raw_url(filename)
        resp = _get(client, source_url)
        if resp is None:
            return None
        parsed = parse_fdm_material(resp.text)
        if parsed is None:
            logger.warning("cura material: failed to parse %s", filename)
            return None
        identity, own = parsed
        return build_material_candidate(identity, own, source_url)

    candidates: list[CuraProfileCandidate] = []
    with ThreadPoolExecutor(max_workers=_CONCURRENCY) as pool:
        futures = [pool.submit(fetch_one, name) for name in filenames]
        for future in as_completed(futures):
            result = future.result()
            if result is not None:
                candidates.append(result)
    return candidates


# --- Ingest --------------------------------------------------------------------


def fetch_all_candidates(
    client: httpx.Client, *, quality: bool = True, materials: bool = True
) -> list[CuraProfileCandidate]:
    candidates: list[CuraProfileCandidate] = []
    if quality:
        candidates += fetch_quality_candidates(client)
    if materials:
        candidates += fetch_material_candidates(client)
    return candidates


def ingest(
    conn: psycopg.Connection,
    client: httpx.Client,
    *,
    quality: bool = True,
    materials: bool = True,
) -> dict[str, int]:
    candidates = fetch_all_candidates(client, quality=quality, materials=materials)
    counters = {"found": len(candidates), "candidates": 0, "promoted": 0}

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
                "setting_id": candidate.setting_id,
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
            source_name=candidate.source_name,
            source_url=candidate.source_url,
            source_ref=candidate.source_url,
            license=candidate.license,
            confidence=1.0,
            content_hash=profile_hash,
        )
        db.mark_slicer_profile_candidate_merged(
            conn, source=SOURCE_ID, external_ref=candidate.external_ref, profile_id=profile_id
        )
        counters["promoted"] += 1

    return counters
