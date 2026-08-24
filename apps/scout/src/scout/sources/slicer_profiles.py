"""Источник кандидатов `machine_candidates`: открытые профили принтеров
слайсеров OrcaSlicer/PrusaSlicer (`source='slicer_profile'`) + курируемый RU-seed
(`source='ru_machine_spec'`).

MF-627 (бутстрап ≥300 моделей, фаза 1 `apps/scout`, docs/epics/backend.foundation.md § 3):
- OrcaSlicer (`SoftFever/OrcaSlicer`, `resources/profiles/`) — JSON-профили по вендорам,
  покрывает большинство сторонних вендоров (Creality/Anycubic/Elegoo/BBL/...).
- PrusaSlicer (`prusa3d/PrusaSlicer-settings`, `live/PrusaResearch`) — INI-бандл
  настроек самого Prusa (FFF MK-серия/XL/Mini). `PrusaResearchSLA` в этом репо —
  заглушка (`config_update_url` на files.prusa3d.com, машин нет), не источник.

Все три стороны идемпотентны: `external_ref` детерминирован от вендора/модели,
`content_hash` — от нормализованного JSON, upsert в `machine_candidates`
(`unique(source, external_ref)`) не плодит дубли при повторном прогоне.

MF-1803 (хвост RU-специфики MF-34/MF-411 — RU-принтеры): проверено вручную (contents-API
OrcaSlicer/PrusaSlicer-settings + `resources/definitions` Cura, 2026-07-17) — ни у одного из
трёх открытых репозиториев профилей нет вендоров PICASO 3D/Total Z (Cura содержит
`stereotech_*` — тот RU-вендор уже покрыт `cura-definitions` (owner=catalog), сюда не
дублируется). Курируемый seed `RU_PRINTERS` — паспортные характеристики ТОЛЬКО с официальных
страниц вендора (`source_url` на каждую запись), без вендор-специфики, которую сайт не
публикует (см. `incomplete_fields` на каждой записи) — тот же принцип "не гадать", что и у
`slicer_print_profiles_ru.py` (RU-филаменты, MF-411), но без экстраполяции: значения не
взяты у родственной модели, а честно неполны там, где вендор их не публикует.
"""

from __future__ import annotations

import configparser
import hashlib
import json
import logging
import os
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Any

import httpx
import psycopg

from .. import db

logger = logging.getLogger("scout.sources.slicer_profiles")

SOURCE_ID = "slicer_profile"
RU_SOURCE_ID = "ru_machine_spec"

_ORCA_OWNER_REPO = "SoftFever/OrcaSlicer"
_ORCA_REF = "main"
_ORCA_PROFILES_PATH = "resources/profiles"

_PRUSA_OWNER_REPO = "prusa3d/PrusaSlicer-settings"
_PRUSA_REF = "master"
_PRUSA_VENDOR_DIRS = ("PrusaResearch",)

_USER_AGENT = "portal.ru-scout/0.1 (+https://3mf.tech)"
_HTTP_TIMEOUT = 20.0
_MAX_RETRIES = 3
_CONCURRENCY = 12


@dataclass(frozen=True)
class Candidate:
    external_ref: str
    raw: dict[str, Any]
    source_url: str | None


def content_hash(raw: dict[str, Any]) -> bytes:
    canonical = json.dumps(raw, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).digest()


def _headers() -> dict[str, str]:
    headers = {"User-Agent": _USER_AGENT}
    token = os.getenv("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _get(client: httpx.Client, url: str) -> httpx.Response | None:
    """GET с ретраями; None на итоговой неудаче (источник продолжает без этой записи,
    не роняет весь прогон — единичный 404/таймаут на GitHub CDN не редкость)."""
    last_exc: Exception | None = None
    for attempt in range(_MAX_RETRIES):
        try:
            resp = client.get(
                url, headers=_headers(), timeout=_HTTP_TIMEOUT, follow_redirects=True
            )
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp
        except httpx.HTTPError as exc:
            last_exc = exc
            time.sleep(0.5 * (attempt + 1))
    logger.warning("GET %s failed after %d retries: %s", url, _MAX_RETRIES, last_exc)
    return None


def _get_json(client: httpx.Client, url: str) -> dict[str, Any] | None:
    resp = _get(client, url)
    return resp.json() if resp is not None else None


def _orca_raw_url(*parts: str) -> str:
    quoted = "/".join(urllib.parse.quote(p) for p in parts)
    return f"https://raw.githubusercontent.com/{_ORCA_OWNER_REPO}/{_ORCA_REF}/{_ORCA_PROFILES_PATH}/{quoted}"


def list_orca_vendors(client: httpx.Client) -> list[str]:
    """Список вендоров — единственный вызов contents-API (rate-limited 60/ч без
    токена), дальше только `raw.githubusercontent.com` (без общего API-лимита)."""
    url = f"https://api.github.com/repos/{_ORCA_OWNER_REPO}/contents/{_ORCA_PROFILES_PATH}?ref={_ORCA_REF}"
    resp = _get(client, url)
    if resp is None:
        return []
    entries = resp.json()
    return [e["name"][:-5] for e in entries if e["type"] == "file" and e["name"].endswith(".json")]


def build_orca_candidate(
    vendor: str,
    model_entry: dict[str, Any],
    model_json: dict[str, Any],
    variant_json: dict[str, Any] | None,
) -> Candidate:
    """Собирает кандидата из тройки (вендор-индекс, machine_model, вариант-нозл).

    `variant_json` может отсутствовать (не нашли файл варианта под ожидаемым
    именем) — тогда специфика по объёму печати просто не заполняется, кандидат
    всё равно валиден (резолвер увидит меньше полей, не reject).
    """
    model_id = model_json.get("model_id") or model_entry["name"]
    nozzles = _split_semicolon(model_json.get("nozzle_diameter", ""))
    raw: dict[str, Any] = {
        "vendor": vendor,
        "model": model_entry["name"],
        "model_id": model_id,
        "machine_tech": model_json.get("machine_tech"),
        "family": model_json.get("family"),
        "nozzle_diameter_mm": nozzles,
        "default_materials": _split_semicolon(model_json.get("default_materials", "")),
    }
    if variant_json is not None:
        raw["printable_area"] = variant_json.get("printable_area")
        raw["printable_height"] = variant_json.get("printable_height")
        raw["kinematics_profile"] = variant_json.get("inherits")
    external_ref = f"orca:{vendor}:{model_id}"
    source_url = _orca_raw_url(vendor, model_entry["sub_path"])
    return Candidate(external_ref=external_ref, raw=raw, source_url=source_url)


def _split_semicolon(value: str | None) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in str(value).split(";") if part.strip()]


def _fetch_orca_model(
    client: httpx.Client, vendor: str, model_entry: dict[str, Any]
) -> Candidate | None:
    model_json = _get_json(client, _orca_raw_url(vendor, model_entry["sub_path"]))
    if model_json is None or model_json.get("type") != "machine_model":
        return None

    variant_json = None
    nozzles = _split_semicolon(model_json.get("nozzle_diameter", ""))
    for nozzle in nozzles or ["0.4"]:
        variant_path = f"machine/{model_entry['name']} {nozzle} nozzle.json"
        variant_json = _get_json(client, _orca_raw_url(vendor, variant_path))
        if variant_json is not None:
            break

    return build_orca_candidate(vendor, model_entry, model_json, variant_json)


def fetch_orca_candidates(client: httpx.Client) -> list[Candidate]:
    vendors = list_orca_vendors(client)
    logger.info("orca: %d vendors", len(vendors))

    jobs: list[tuple[str, dict[str, Any]]] = []
    with ThreadPoolExecutor(max_workers=_CONCURRENCY) as pool:
        fetched = pool.map(lambda v: _get_json(client, _orca_raw_url(f"{v}.json")), vendors)
        vendor_indexes = dict(zip(vendors, fetched, strict=True))
    for vendor, index in vendor_indexes.items():
        if not index:
            continue
        for model_entry in index.get("machine_model_list", []):
            jobs.append((vendor, model_entry))
    logger.info("orca: %d candidate models to fetch", len(jobs))

    candidates: list[Candidate] = []
    with ThreadPoolExecutor(max_workers=_CONCURRENCY) as pool:
        futures = [pool.submit(_fetch_orca_model, client, vendor, entry) for vendor, entry in jobs]
        for future in as_completed(futures):
            result = future.result()
            if result is not None:
                candidates.append(result)
    return candidates


# --- PrusaSlicer ---------------------------------------------------------

_PRERELEASE_MARKERS = ("alpha", "beta", "rc")


def _pick_latest_bundle_version(filenames: list[str]) -> str | None:
    """Из списка `<version>.ini` берёт самую свежую релизную (без alpha/beta/rc)."""

    def parse(name: str) -> tuple[int, ...] | None:
        stem = name[:-4] if name.endswith(".ini") else name
        if any(marker in stem.lower() for marker in _PRERELEASE_MARKERS):
            return None
        try:
            return tuple(int(p) for p in stem.split("."))
        except ValueError:
            return None

    versions = [(parse(n), n) for n in filenames]
    versions = [(v, n) for v, n in versions if v is not None]
    if not versions:
        return None
    versions.sort(key=lambda pair: pair[0])
    return versions[-1][1]


def parse_prusa_bundle(ini_text: str) -> configparser.RawConfigParser:
    """Slic3r/PrusaSlicer vendor-бандл: множество секций `[printer_model:X]` /
    `[printer:Name]` в одном INI. `RawConfigParser` без интерполяции — значения
    содержат `%`/`{...}`-шаблоны g-code, `%`-интерполяция ConfigParser их сломает.
    `strict=False` — бандлы иногда повторяют секцию (разные релизы модели)."""
    parser = configparser.RawConfigParser(strict=False)
    parser.optionxform = str  # type: ignore[assignment]
    parser.read_string(ini_text)
    return parser


def _find_prusa_printer_section(
    parser: configparser.RawConfigParser, model_section: dict[str, str], model_key: str
) -> str | None:
    """Находит секцию `[printer:...]`, отвечающую за физику модели (bed_shape/
    max_print_height), по её `printer_model:` секции.

    Два усложнения реального бандла:
    - `name=` эскейпит одиночный `&` как `&&` (wx-конвенция меню), а заголовок
      секции `[printer:...]` — нет: "MK3S && MK3S+" (name) vs
      "[printer:...MK3S & MK3S+]" (section).
    - У части моделей (MK4/MK3.9/MK3.5/XL и новее) нет базовой секции без
      нозла — есть только `<name> <nozzle> nozzle` варианты; берём первый
      nozzle из `variants` как дефолт.
    """
    name = model_section.get("name", model_key).replace("&&", "&")
    bare = f"printer:{name}"
    if parser.has_section(bare):
        return bare
    for nozzle in _split_semicolon(model_section.get("variants", "")):
        candidate = f"printer:{name} {nozzle} nozzle"
        if parser.has_section(candidate):
            return candidate
    return None


def _resolve_prusa_printer(
    parser: configparser.RawConfigParser, section: str, _seen: set[str] | None = None
) -> dict[str, str]:
    """Мёрджит цепочку `inherits` (родитель → потомок, потомок перекрывает)."""
    if not parser.has_section(section):
        return {}
    seen = _seen if _seen is not None else set()
    if section in seen:
        return {}
    seen.add(section)

    own = dict(parser.items(section))
    merged: dict[str, str] = {}
    for parent in _split_semicolon(own.get("inherits", "")):
        merged.update(_resolve_prusa_printer(parser, f"printer:{parent}", seen))
    merged.update({k: v for k, v in own.items() if k != "inherits"})
    return merged


def build_prusa_candidate(
    vendor_dir: str,
    model_key: str,
    model_section: dict[str, str],
    merged_printer: dict[str, str],
    bundle_version: str,
) -> Candidate:
    name = model_section.get("name", model_key).replace("&&", "&")
    raw: dict[str, Any] = {
        "vendor": "Prusa Research",
        "vendor_dir": vendor_dir,
        "model": name,
        "model_id": model_key,
        "machine_tech": model_section.get("technology"),
        "family": model_section.get("family"),
        "nozzle_diameter_mm": _split_semicolon(model_section.get("variants", "")),
        "default_materials": _split_semicolon(model_section.get("default_materials", "")),
        "bed_shape": merged_printer.get("bed_shape"),
        "max_print_height": merged_printer.get("max_print_height"),
        "bundle_version": bundle_version,
    }
    external_ref = f"prusa:{vendor_dir}:{model_key}"
    source_url = (
        f"https://raw.githubusercontent.com/{_PRUSA_OWNER_REPO}/{_PRUSA_REF}/"
        f"live/{vendor_dir}/{bundle_version}"
    )
    return Candidate(external_ref=external_ref, raw=raw, source_url=source_url)


def _list_prusa_bundle_versions(client: httpx.Client, vendor_dir: str) -> list[str]:
    url = f"https://api.github.com/repos/{_PRUSA_OWNER_REPO}/contents/live/{vendor_dir}?ref={_PRUSA_REF}"
    resp = _get(client, url)
    if resp is None:
        return []
    entries = resp.json()
    return [e["name"] for e in entries if e["type"] == "file" and e["name"].endswith(".ini")]


def fetch_prusa_candidates(client: httpx.Client) -> list[Candidate]:
    candidates: list[Candidate] = []
    for vendor_dir in _PRUSA_VENDOR_DIRS:
        versions = _list_prusa_bundle_versions(client, vendor_dir)
        bundle_version = _pick_latest_bundle_version(versions)
        if bundle_version is None:
            logger.warning("prusa: no release bundle found for %s", vendor_dir)
            continue

        url = (
            f"https://raw.githubusercontent.com/{_PRUSA_OWNER_REPO}/{_PRUSA_REF}/"
            f"live/{vendor_dir}/{bundle_version}"
        )
        resp = _get(client, url)
        if resp is None:
            continue
        parser = parse_prusa_bundle(resp.text)

        for section in parser.sections():
            if not section.startswith("printer_model:"):
                continue
            model_key = section.split(":", 1)[1]
            model_section = dict(parser.items(section))
            printer_section = _find_prusa_printer_section(parser, model_section, model_key)
            merged_printer = (
                _resolve_prusa_printer(parser, printer_section) if printer_section else {}
            )
            candidates.append(
                build_prusa_candidate(
                    vendor_dir, model_key, model_section, merged_printer, bundle_version
                )
            )
        logger.info("prusa: %s@%s -> %d models", vendor_dir, bundle_version, len(candidates))
    return candidates


# --- RU printers (curated seed, MF-1803) -----------------------------------


@dataclass(frozen=True)
class RuPrinterSpec:
    """Одна запись курируемого RU-seed'а — паспортные данные вручную сверены с
    официальной страницей вендора (`source_url`), поля, которых страница не
    публикует, перечислены в `incomplete_fields`, а не додуманы."""

    vendor: str
    vendor_slug: str
    model: str
    model_slug: str
    machine_tech: str
    build_volume_mm: tuple[float, float, float]  # (x, y, z), как указано вендором
    nozzle_count: int
    source_url: str
    incomplete_fields: tuple[str, ...]
    filament_diameter_mm: tuple[float, ...] = ()
    bed_temp_max_c: float | None = None
    nozzle_temp_max_c: float | None = None
    chamber_temp_max_c: float | None = None


# Оф. страницы проверены вручную 2026-07-17. Ни PICASO 3D, ни Total Z не
# фигурируют вендорами в OrcaSlicer/PrusaSlicer-settings/Cura `resources/definitions`
# (contents-API трёх репозиториев, см. докстринг модуля) — это ровно та RU-специфика
# "ров", которую эпик MF-34 просит закрыть отдельно от западных профилей.
RU_PRINTERS: tuple[RuPrinterSpec, ...] = (
    RuPrinterSpec(
        vendor="PICASO 3D",
        vendor_slug="picaso-3d",
        model="Designer X",
        model_slug="designer-x",
        machine_tech="FFF",
        build_volume_mm=(201.0, 201.0, 210.0),
        nozzle_count=1,
        bed_temp_max_c=150,
        nozzle_temp_max_c=500,
        chamber_temp_max_c=80,
        source_url="https://picaso-3d.ru/ru/products/printers/xseries2/",
        incomplete_fields=("nozzle_diameter_mm", "kinematics"),
    ),
    RuPrinterSpec(
        vendor="PICASO 3D",
        vendor_slug="picaso-3d",
        model="Designer X PRO",
        model_slug="designer-x-pro",
        machine_tech="FFF",
        build_volume_mm=(201.0, 201.0, 210.0),
        nozzle_count=2,  # JetSwitch — два сопла, переключаемых клапаном, не одновременно
        bed_temp_max_c=150,
        nozzle_temp_max_c=500,
        chamber_temp_max_c=80,
        source_url="https://picaso-3d.ru/ru/products/printers/xseries2/",
        incomplete_fields=("nozzle_diameter_mm", "kinematics"),
    ),
    RuPrinterSpec(
        vendor="PICASO 3D",
        vendor_slug="picaso-3d",
        model="Designer XL",
        model_slug="designer-xl",
        machine_tech="FFF",
        build_volume_mm=(360.0, 360.0, 610.0),
        nozzle_count=1,
        bed_temp_max_c=150,
        nozzle_temp_max_c=500,
        chamber_temp_max_c=80,
        source_url="https://picaso-3d.ru/ru/products/printers/xseries2/",
        incomplete_fields=("nozzle_diameter_mm", "kinematics"),
    ),
    RuPrinterSpec(
        vendor="PICASO 3D",
        vendor_slug="picaso-3d",
        model="Designer XL PRO",
        model_slug="designer-xl-pro",
        machine_tech="FFF",
        build_volume_mm=(360.0, 360.0, 610.0),
        nozzle_count=2,
        bed_temp_max_c=150,
        nozzle_temp_max_c=500,
        chamber_temp_max_c=80,
        source_url="https://picaso-3d.ru/ru/products/printers/xseries2/",
        incomplete_fields=("nozzle_diameter_mm", "kinematics"),
    ),
    RuPrinterSpec(
        vendor="Total Z",
        vendor_slug="total-z",
        model="AnyForm 450-PRO",
        model_slug="anyform-450-pro",
        machine_tech="FFF",
        build_volume_mm=(450.0, 450.0, 450.0),
        nozzle_count=1,  # сменная головка FDM/FGF, не мультиэкструдер
        filament_diameter_mm=(1.75, 2.85),
        source_url="https://totalz.ru/produktsiya/3d-printer-anyform-450-pro/",
        incomplete_fields=("nozzle_diameter_mm", "kinematics", "nozzle_temp_max_c"),
    ),
    RuPrinterSpec(
        vendor="Total Z",
        vendor_slug="total-z",
        model="AnyForm 950-PRO",
        model_slug="anyform-950-pro",
        machine_tech="FFF",
        build_volume_mm=(950.0, 650.0, 950.0),  # как указано на оф. странице, XYZ дословно
        nozzle_count=1,
        filament_diameter_mm=(1.75, 2.85),
        nozzle_temp_max_c=350,  # базовая версия; HOT+ (до 500) — не отдельная модель
        source_url="https://totalz.ru/en/total-z-equipment/buy-3d-printer-anyform-950-pro/",
        incomplete_fields=("nozzle_diameter_mm", "kinematics"),
    ),
)


def build_ru_printer_candidate(spec: RuPrinterSpec) -> Candidate:
    x, y, z = spec.build_volume_mm
    raw: dict[str, Any] = {
        "vendor": spec.vendor,
        "model": spec.model,
        "model_id": f"{spec.vendor_slug}:{spec.model_slug}",
        "machine_tech": spec.machine_tech,
        "specs": {
            "build_volume": {"x": x, "y": y, "z": z, "shape": "rectangular"},
        },
        "nozzle_count": spec.nozzle_count,
        "incomplete_fields": list(spec.incomplete_fields),
        "provenance_note": (
            "паспортные данные с официальной страницы вендора вручную сверены "
            "2026-07-17; в OrcaSlicer/PrusaSlicer-settings/Cura profiles этого "
            "вендора нет (RU-принтер вне западных баз, MF-34 § «RU-специфика»); "
            "поля из incomplete_fields вендор не публикует — не додуманы."
        ),
    }
    if spec.filament_diameter_mm:
        raw["filament_diameter_mm"] = list(spec.filament_diameter_mm)
    if spec.bed_temp_max_c is not None:
        raw["bed_temp_max_c"] = spec.bed_temp_max_c
    if spec.nozzle_temp_max_c is not None:
        raw["nozzle_temp_max_c"] = spec.nozzle_temp_max_c
    if spec.chamber_temp_max_c is not None:
        raw["chamber_temp_max_c"] = spec.chamber_temp_max_c

    external_ref = f"ru:{spec.vendor_slug}:{spec.model_slug}"
    return Candidate(external_ref=external_ref, raw=raw, source_url=spec.source_url)


def fetch_ru_printer_candidates() -> list[Candidate]:
    """Синхронный список — курируемые данные, сети не требуют (в отличие от
    Orca/Prusa) — единственный источник правды уже в `RU_PRINTERS`."""
    return [build_ru_printer_candidate(spec) for spec in RU_PRINTERS]


# --- Ingest ---------------------------------------------------------------


def _write_candidates(
    conn: psycopg.Connection, candidates: list[Candidate], *, source: str = SOURCE_ID
) -> dict[str, int]:
    counters = {"found": len(candidates), "inserted": 0, "updated": 0, "unchanged": 0}
    for candidate in candidates:
        outcome = db.upsert_machine_candidate(
            conn,
            source=source,
            source_url=candidate.source_url,
            external_ref=candidate.external_ref,
            raw=candidate.raw,
            content_hash=content_hash(candidate.raw),
        )
        counters[outcome] += 1
    return counters


def ingest_orca(conn: psycopg.Connection, client: httpx.Client) -> dict[str, int]:
    return _write_candidates(conn, fetch_orca_candidates(client))


def ingest_prusa(conn: psycopg.Connection, client: httpx.Client) -> dict[str, int]:
    return _write_candidates(conn, fetch_prusa_candidates(client))


def ingest_ru_printers(conn: psycopg.Connection) -> dict[str, int]:
    return _write_candidates(conn, fetch_ru_printer_candidates(), source=RU_SOURCE_ID)
