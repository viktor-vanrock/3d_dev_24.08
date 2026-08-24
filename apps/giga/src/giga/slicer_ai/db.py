"""Postgres-доступ к `machines`/`materials`/`slicer_profiles` (владелец схемы
`api`, `giga` читает через тот же `DATABASE_URL` — тот же паттерн, что
`giga.calendar.db.find_machine_id`, не HTTP-мост, см. докстринг
`matcher_port.py`).

Мэппинг строк в типы `matcher_port` — документированный порт `toPrinter`/
`toProfile`/`numberAt`/`stringAt` из `apps/api/src/slicerProfiles/
recommendation.ts`, те же пути полей/фоллбэки.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import psycopg

from .matcher_port import BaselineProfile, FilamentInput, PrinterInput


def _is_record(value: Any) -> bool:
    return isinstance(value, dict)


def _number_at(value: Any, paths: list[list[str]]) -> float | None:
    for path in paths:
        current = value
        for segment in path:
            if not _is_record(current):
                current = None
                break
            current = current.get(segment)
        is_number = isinstance(current, (int, float)) and not isinstance(current, bool)
        if is_number and math.isfinite(current):
            return current
    return None


def _string_at(value: Any, paths: list[list[str]]) -> str | None:
    for path in paths:
        current = value
        for segment in path:
            if not _is_record(current):
                current = None
                break
            current = current.get(segment)
        if isinstance(current, str) and current.strip():
            return current.strip()
    return None


def _volume_at(specs: Any) -> dict[str, float | None]:
    def axis_paths(axis: str) -> list[list[str]]:
        return [["build_volume_mm", axis], ["build_volume", axis], [f"build_volume_{axis}_mm"]]

    return {axis: _number_at(specs, axis_paths(axis)) for axis in ("x", "y", "z")}


_FETCH_PRINTER_SQL = "select id, specs from machines where id = %s and status = 'active'"


def fetch_printer(conn: psycopg.Connection, printer_id: str) -> PrinterInput | None:
    with conn.cursor() as cur:
        cur.execute(_FETCH_PRINTER_SQL, (printer_id,))
        row = cur.fetchone()
    if row is None:
        return None
    machine_id, specs = row
    specs = specs if _is_record(specs) else {}
    return PrinterInput(
        id=str(machine_id),
        nozzle_diameter_mm=_number_at(specs, [["nozzle_diameter_mm"], ["filament_dia_mm"]]),
        kinematics=_string_at(specs, [["kinematics"]]),
        build_volume_mm=_volume_at(specs),
        max_nozzle_temp_c=_number_at(
            specs, [["max_nozzle_temp_c"], ["max_hotend_temp_c"], ["hotend", "max_temp_c"]]
        ),
        max_bed_temp_c=_number_at(specs, [["max_bed_temp_c"], ["bed", "max_temp_c"]]),
        max_print_speed_mm_s=_number_at(
            specs, [["max_print_speed_mm_s"], ["max_speed_mm_s"], ["speed", "max_mm_s"]]
        ),
    )


def fetch_filament(conn: psycopg.Connection, filament_id: str) -> FilamentInput | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            select m.id, mt.slug as material_class, m.specs
              from materials m join material_types mt on mt.id = m.material_type_id
             where m.id = %s and m.kind = 'filament'
            """,
            (filament_id,),
        )
        row = cur.fetchone()
    if row is None:
        return None
    material_id, material_class, specs = row
    specs = specs if _is_record(specs) else {}
    return FilamentInput(
        id=str(material_id),
        material_class=_string_at(specs, [["material_class"], ["material_type"]]) or material_class,
        diameter_mm=_number_at(specs, [["diameter_mm"], ["filament_diameter_mm"]]),
    )


def fetch_active_profiles(conn: psycopg.Connection) -> list[BaselineProfile]:
    with conn.cursor() as cur:
        cur.execute(
            """
            select id, profile_class, slicer, name, inherits_id, machine_id, material_id, params,
                   source_name, source_url, source_ref, license, confidence, extrapolated_from_id
              from slicer_profiles
             where status = 'active' and profile_class in ('machine', 'process', 'filament')
             order by id
            """
        )
        rows = cur.fetchall()
    profiles = []
    for row in rows:
        (
            profile_id,
            profile_class,
            slicer,
            name,
            inherits_id,
            machine_id,
            material_id,
            params,
            source_name,
            source_url,
            source_ref,
            license_,
            confidence,
            extrapolated_from_id,
        ) = row
        profiles.append(
            BaselineProfile(
                id=str(profile_id),
                profile_class=profile_class,
                slicer=slicer,
                name=name,
                inherits_id=str(inherits_id) if inherits_id else None,
                machine_id=str(machine_id) if machine_id else None,
                material_id=str(material_id) if material_id else None,
                params=params if _is_record(params) else {},
                source_name=source_name,
                source_url=source_url,
                source_ref=source_ref,
                license=license_,
                confidence=float(confidence),
                extrapolated_from_id=str(extrapolated_from_id) if extrapolated_from_id else None,
            )
        )
    return profiles


def calibration_signal_available(conn: psycopg.Connection) -> bool:
    """`True`, если таблица `slicer_profile_calibrations` (MF-1940, обучающий
    сигнал v2, `apps/api/db/migrations/20260718230000_slicer_profile_
    calibrations.sql`) создана на этой БД.

    Проверка существования (`to_regclass`, не падает на отсутствующей
    таблице), а не просто попытка `select` — на БД, где миграция MF-1940 ещё
    не прогнана (например, локальный docker без последних миграций), это
    честный `False`, а не 500. `fetch_calibration_summary` ниже уже читает
    реальные колонки — вызывать его имеет смысл только когда эта функция
    вернула `True` (см. `service.compute_ai_delta_response`).
    """
    with conn.cursor() as cur:
        cur.execute("select to_regclass('public.slicer_profile_calibrations') is not null")
        (exists,) = cur.fetchone()
    return bool(exists)


@dataclass(frozen=True)
class CalibrationSummary:
    """Агрегат `slicer_profile_calibrations` по связке printer×filament
    (MF-1940 явно оставил агрегацию "консюмеру поверх новой таблицы" —
    этой карточке, MF-1941, см. `docs/epics/slicer.profiles.md` § v2)."""

    sample_count: int
    success_count: int
    defect_count: int
    avg_flow_ratio: float | None
    avg_pressure_advance: float | None

    @property
    def success_rate(self) -> float:
        return self.success_count / self.sample_count if self.sample_count else 0.0


def fetch_calibration_summary(
    conn: psycopg.Connection, machine_id: str, material_id: str
) -> CalibrationSummary | None:
    """Реальный обучающий сигнал для связки, `None` если записей ещё нет
    (штатно — на `dev` сразу после MF-1940 их 0 строк, см. эпик). Читает
    ТОЛЬКО связку `machine_id`+`material_id` (обязательные NOT NULL колонки
    таблицы, см. миграцию) — не привязано к конкретному `slicer_profile_id`,
    чтобы сигнал не терялся при смене базового профиля движком между
    прогонами."""
    with conn.cursor() as cur:
        cur.execute(
            """
            select count(*) filter (where outcome = 'success'),
                   count(*) filter (where outcome = 'defect'),
                   avg(flow_ratio),
                   avg(pressure_advance)
              from slicer_profile_calibrations
             where machine_id = %s and material_id = %s
            """,
            (machine_id, material_id),
        )
        row = cur.fetchone()
    if row is None:
        return None
    success_count, defect_count, avg_flow_ratio, avg_pressure_advance = row
    sample_count = success_count + defect_count
    if sample_count == 0:
        return None
    flow_ratio = float(avg_flow_ratio) if avg_flow_ratio is not None else None
    pressure_advance = float(avg_pressure_advance) if avg_pressure_advance is not None else None
    return CalibrationSummary(
        sample_count=sample_count,
        success_count=success_count,
        defect_count=defect_count,
        avg_flow_ratio=flow_ratio,
        avg_pressure_advance=pressure_advance,
    )
