"""Идемпотентный seed канона `slicer_profiles` для Snapmaker U1 (MF-1989).

`snapmaker_u1_profile.resolve_snapmaker_u1_profile` (MF-1974) уже резолвит
машина/процесс/филамент тройку из ТОГО ЖЕ распакованного бандла Orca
(`MESH_ORCA_PROFILES_DIR`), который использует `portal.mesh-slice-worker-dev.service`
— этот модуль пишет ровно эту тройку в канон `slicer_profiles`, а не полагается
на отдельный источник (`apps/scout/.../slicer_print_profiles.py` тянет вендорские
JSON живьём с GitHub `main` — тот же setting_id обычно стабилен между релизами
вендора, но это совпадение, не гарантия версии; этот seed гарантирует байт-в-байт
привязку к развёрнутому бандлу структурно, не по счастливой случайности).

## Идемпотентность

Конфликт-таргет — `(slicer, setting_id)` (тот же уникальный индекс, что использует
`apps/scout/src/scout/db.py::upsert_slicer_profile`): все три листовых профиля
Snapmaker U1 (`instantiation: true`) несут собственный `setting_id` у вендора,
повторный прогон с тем же содержимым переписывает ту же строку (`on conflict do
update`), не плодит дублей. Второй якорь идемпотентности — `content_hash`
(`slicer_profiles_content_hash_uidx`): бандл не поменялся → апдейт no-op по факту
(то же имя/params/hash), поменялся (например, апгрейд `SOURCE_VERSION`) → та же
строка (по `setting_id`) получает новые `params`/`content_hash`.

## Область

Только каталог `slicer_profiles` (класс machine/process/filament, `slicer=
'orcaslicer'`) — не трогает `machines`/`vendors` (тот канон — Data,
`apps/scout`), не трогает `apps/api` (эндпоинт `/slicer-profiles` — Back, шов
между сервисами, не территория Mesh, см. `docs/architecture/service.map.md` §1
«Три золотых правила швов»).

Запуск (на VDS, окружение `~/portal.mesh-dev.env`/`~/portal.mesh.env` — нужны
`DATABASE_URL` + `MESH_ORCA_PROFILES_DIR`):
    uv run mesh-seed-snapmaker-u1
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
from pathlib import Path
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from .config import load_worker_config
from .snapmaker_u1_profile import (
    SOURCE_LICENSE,
    SOURCE_NAME,
    SnapmakerU1Profile,
    load_orca_profiles_dir,
    resolve_snapmaker_u1_profile,
)

logger = logging.getLogger("mesh.snapmaker_u1_profile_seed")

SLICER = "orcaslicer"


# --- Нормализация в unified-словарь params ---------------------------------
# Тот же словарь ключей, что `apps/api/src/db/schemas/slicer-profile.schema.json`
# и `apps/scout/src/scout/sources/slicer_print_profiles.py::_PROCESS_RULES/
# _FILAMENT_RULES` (не импортируется напрямую — `apps/scout` чужая папка, см.
# докстринг модуля выше); подмножество ключей, которые реально несёт вендорский
# JSON Snapmaker U1.


def _as_scalar(value: Any) -> Any:
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

_MACHINE_RULES: tuple[tuple[str, str, Any], ...] = (
    ("nozzle_diameter", "nozzle_diameter_mm", _num),
    ("gcode_flavor", "gcode_flavor", _text),
)


def _normalize_process_or_filament_params(
    profile_class: str, doc: dict[str, Any]
) -> dict[str, Any]:
    rules = _PROCESS_RULES if profile_class == "process" else _FILAMENT_RULES
    params: dict[str, Any] = {}
    for native_key, unified_path, converter in rules:
        if native_key not in doc:
            continue
        _set_nested(params, unified_path, converter(doc[native_key]))
    return params


def _normalize_machine_params(profile: SnapmakerU1Profile) -> dict[str, Any]:
    params: dict[str, Any] = {"build_volume_mm": dict(profile.build_volume_mm)}
    for native_key, unified_path, converter in _MACHINE_RULES:
        if native_key not in profile.printer:
            continue
        _set_nested(params, unified_path, converter(profile.printer[native_key]))
    return params


def _content_hash(profile_class: str, name: str, params: dict[str, Any]) -> bytes:
    payload = {"profile_class": profile_class, "slicer": SLICER, "name": name, "params": params}
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).digest()


def _upsert_slicer_profile(
    conn: psycopg.Connection,
    *,
    profile_class: str,
    setting_id: str,
    name: str,
    params: dict[str, Any],
    source_url: str | None,
    source_ref: str,
) -> str:
    """Тот же конфликт-таргет `(slicer, setting_id)`, что `apps/scout/src/
    scout/db.py::upsert_slicer_profile` — все три листовых профиля Snapmaker U1
    инстанцируемы (`instantiation: true`) и несут вендорский `setting_id`."""
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into slicer_profiles
                (profile_class, slicer, setting_id, name, params, source_name,
                 source_url, source_ref, license, confidence, content_hash)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, 1.0, %s)
            on conflict (slicer, setting_id) where setting_id is not null do update
               set name = excluded.name,
                   params = excluded.params,
                   source_url = excluded.source_url,
                   source_ref = excluded.source_ref,
                   content_hash = excluded.content_hash,
                   updated_at = now()
            returning id
            """,
            (
                profile_class,
                SLICER,
                setting_id,
                name,
                Jsonb(params),
                SOURCE_NAME,
                source_url,
                source_ref,
                SOURCE_LICENSE,
                _content_hash(profile_class, name, params),
            ),
        )
        row = cur.fetchone()
    conn.commit()
    return str(row[0])


def seed_snapmaker_u1_slicer_profiles(
    conn: psycopg.Connection, profiles_dir: Path
) -> dict[str, str]:
    """Резолвит тройку из бандла (`resolve_snapmaker_u1_profile` — та же
    геометрическая проверка паспорта U1, что startup health-check воркера) и
    идемпотентно upsert'ит три канонические строки `slicer_profiles`.
    Возвращает `{"machine": id, "process": id, "filament": id}`."""
    profile = resolve_snapmaker_u1_profile(profiles_dir)
    # `profile.source_ref` — "machine_path; process_path; filament_path" (см.
    # `resolve_snapmaker_u1_profile`), тот же порядок трёх классов.
    source_ref_parts = profile.source_ref.split("; ")

    ids: dict[str, str] = {}
    ids["machine"] = _upsert_slicer_profile(
        conn,
        profile_class="machine",
        setting_id=str(profile.printer["setting_id"]),
        name=str(profile.printer["name"]),
        params=_normalize_machine_params(profile),
        source_url=None,
        source_ref=source_ref_parts[0],
    )
    ids["process"] = _upsert_slicer_profile(
        conn,
        profile_class="process",
        setting_id=str(profile.process["setting_id"]),
        name=str(profile.process["name"]),
        params=_normalize_process_or_filament_params("process", profile.process),
        source_url=None,
        source_ref=source_ref_parts[1],
    )
    ids["filament"] = _upsert_slicer_profile(
        conn,
        profile_class="filament",
        setting_id=str(profile.filament["setting_id"]),
        name=str(profile.filament["name"]),
        params=_normalize_process_or_filament_params("filament", profile.filament),
        source_url=None,
        source_ref=source_ref_parts[2],
    )
    logger.info(
        "snapmaker_u1_profile_seed: machine=%s process=%s filament=%s content_hash=%s",
        ids["machine"],
        ids["process"],
        ids["filament"],
        profile.content_hash,
    )
    return ids


def main() -> int:
    logging.basicConfig(level=logging.INFO)
    argparse.ArgumentParser(
        description="Идемпотентный seed slicer_profiles для Snapmaker U1"
    ).parse_args()

    worker_config = load_worker_config()
    if worker_config is None:
        logger.error("нет DATABASE_URL — не сконфигурирован")
        return 2

    profiles_dir = load_orca_profiles_dir()
    if profiles_dir is None:
        logger.error("нет MESH_ORCA_PROFILES_DIR — не сконфигурирован")
        return 2

    with psycopg.connect(worker_config.database_url) as conn:
        seed_snapmaker_u1_slicer_profiles(conn, profiles_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
