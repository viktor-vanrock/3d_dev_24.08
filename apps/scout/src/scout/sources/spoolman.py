"""Источник кандидатов `material_candidates` (source='spoolman'): открытая
база профилей филамента SpoolmanDB (`Donkie/SpoolmanDB`).

MF-721 (фаза 1 источников филамента, `docs/epics/backend.foundation.md` § 3,
workstream MF-587). Один файл на производителя в `filaments/*.json`
(`{"manufacturer": ..., "filaments": [...]}`), каждая запись — продуктовая
линейка (материал+рецептура) с массивами `diameters`/`colors`/`weights`;
проект сам публикует `filaments.json` — плоский компилированный кросс-продукт
(диаметр×цвет), но только через кастомный домен `donkie.github.io`, не через
`raw.githubusercontent.com`/`api.github.com` (единственные внешние хосты, на
которые уже опирается `apps/scout`, см. `slicer_profiles.py`) — здесь вместо
этого сам разворачиваем кросс-продукт из исходных per-vendor файлов, тот же
паттерн, что уже применён к OrcaSlicer/PrusaSlicer.

`external_ref` собран из (производитель, материал, шаблон имени, диаметр,
цвет) — детерминирован при неизменных исходниках, `content_hash` — от
нормализованного `raw`, upsert в `material_candidates`
(`unique(source, external_ref)`) идемпотентен при повторном прогоне.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Any

import httpx
import psycopg

from .. import db

logger = logging.getLogger("scout.sources.spoolman")

SOURCE_ID = "spoolman"

_OWNER_REPO = "Donkie/SpoolmanDB"
_REF = "main"
_FILAMENTS_PATH = "filaments"

_USER_AGENT = "portal.ru-scout/0.1 (+https://3mf.tech)"
_HTTP_TIMEOUT = 20.0
_MAX_RETRIES = 3
_CONCURRENCY = 12

_COLOR_OVERRIDE_FIELDS = ("finish", "translucent", "glow", "pattern", "multi_color_direction")
_SLUG_RE = re.compile(r"[^a-z0-9]+")


@dataclass(frozen=True)
class Candidate:
    external_ref: str
    raw: dict[str, Any]
    source_url: str | None


def content_hash(raw: dict[str, Any]) -> bytes:
    canonical = json.dumps(raw, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).digest()


def _slugify(text: str) -> str:
    slug = _SLUG_RE.sub("-", text.strip().lower()).strip("-")
    return slug or "x"


def _format_diameter(diameter: float) -> str:
    return f"{diameter:.2f}"


def _headers() -> dict[str, str]:
    headers = {"User-Agent": _USER_AGENT}
    token = os.getenv("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _get(client: httpx.Client, url: str) -> httpx.Response | None:
    """GET с ретраями; None на итоговой неудаче (источник продолжает без этого
    производителя, не роняет весь прогон — тот же принцип, что
    `slicer_profiles._get`)."""
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


def _raw_url(filename: str) -> str:
    return f"https://raw.githubusercontent.com/{_OWNER_REPO}/{_REF}/{_FILAMENTS_PATH}/{filename}"


def list_manufacturer_files(client: httpx.Client) -> list[str]:
    """Список файлов `filaments/*.json` — единственный вызов contents-API
    (rate-limited 60/ч без токена), дальше только `raw.githubusercontent.com`
    (тот же trade-off, что `slicer_profiles.list_orca_vendors`)."""
    url = f"https://api.github.com/repos/{_OWNER_REPO}/contents/{_FILAMENTS_PATH}?ref={_REF}"
    resp = _get(client, url)
    if resp is None:
        return []
    entries = resp.json()
    return [e["name"] for e in entries if e["type"] == "file" and e["name"].endswith(".json")]


def _resolve_name(template: str, color_name: str | None) -> str:
    if not color_name:
        return template
    return template.replace("{color_name}", color_name)


def _color_field(block: dict[str, Any], color: dict[str, Any], field: str) -> Any:
    """Поля finish/translucent/glow/pattern/multi_color_direction можно
    переопределить на уровне конкретного цвета — берём цвет, иначе блок
    (README SpoolmanDB § filament_library)."""
    return color[field] if field in color else block.get(field)


def build_candidates_for_block(
    manufacturer_slug: str, manufacturer_name: str, block: dict[str, Any]
) -> list[Candidate]:
    """Кросс-продукт (диаметр×цвет) одной продуктовой линейки — та же
    экспансия, что делает официальная сборка `filaments.json`, только на
    исходных per-vendor файлах, не на скомпилированном артефакте."""
    material = block.get("material")
    name_template = block.get("name", "{color_name}")
    diameters = block.get("diameters", [])
    weights = block.get("weights", [])
    source_url = _raw_url(f"{manufacturer_slug}.json")

    candidates: list[Candidate] = []
    for diameter in diameters:
        for color in block.get("colors", []):
            color_name = color.get("name")
            raw: dict[str, Any] = {
                "manufacturer": manufacturer_name,
                "manufacturer_slug": manufacturer_slug,
                "material": material,
                "name": _resolve_name(name_template, color_name),
                "name_template": name_template,
                "density": block.get("density"),
                "diameter_mm": diameter,
                "color_name": color_name,
                "color_hex": color.get("hex"),
                "color_hexes": color.get("hexes"),
                "weights": weights,
                "extruder_temp": block.get("extruder_temp"),
                "bed_temp": block.get("bed_temp"),
                "extruder_temp_range": block.get("extruder_temp_range"),
                "bed_temp_range": block.get("bed_temp_range"),
                "finish": _color_field(block, color, "finish"),
                "translucent": _color_field(block, color, "translucent"),
                "glow": _color_field(block, color, "glow"),
                "pattern": _color_field(block, color, "pattern"),
                "multi_color_direction": _color_field(block, color, "multi_color_direction"),
            }
            external_ref = "spoolman:{}:{}:{}:{}:{}".format(
                manufacturer_slug,
                _slugify(material or "unknown"),
                _slugify(name_template),
                _format_diameter(diameter),
                _slugify(color_name or "unknown"),
            )
            candidates.append(Candidate(external_ref=external_ref, raw=raw, source_url=source_url))
    return candidates


def build_manufacturer_candidates(manufacturer_slug: str, data: dict[str, Any]) -> list[Candidate]:
    manufacturer_name = data.get("manufacturer", manufacturer_slug)
    candidates: list[Candidate] = []
    for block in data.get("filaments", []):
        candidates.extend(build_candidates_for_block(manufacturer_slug, manufacturer_name, block))
    return candidates


def fetch_candidates(client: httpx.Client) -> list[Candidate]:
    filenames = list_manufacturer_files(client)
    logger.info("spoolman: %d manufacturer files", len(filenames))

    candidates: list[Candidate] = []
    with ThreadPoolExecutor(max_workers=_CONCURRENCY) as pool:
        futures = {
            pool.submit(_get_json, client, _raw_url(filename)): filename for filename in filenames
        }
        for future in as_completed(futures):
            filename = futures[future]
            data = future.result()
            if data is None:
                continue
            manufacturer_slug = _slugify(filename[:-5])
            candidates.extend(build_manufacturer_candidates(manufacturer_slug, data))
    return candidates


# --- Ingest ---------------------------------------------------------------


def _write_candidates(conn: psycopg.Connection, candidates: list[Candidate]) -> dict[str, int]:
    counters = {"found": len(candidates), "inserted": 0, "updated": 0, "unchanged": 0}
    for candidate in candidates:
        outcome = db.upsert_material_candidate(
            conn,
            source=SOURCE_ID,
            source_url=candidate.source_url,
            external_ref=candidate.external_ref,
            raw=candidate.raw,
            content_hash=content_hash(candidate.raw),
        )
        counters[outcome] += 1
    return counters


def ingest(conn: psycopg.Connection, client: httpx.Client) -> dict[str, int]:
    return _write_candidates(conn, fetch_candidates(client))
