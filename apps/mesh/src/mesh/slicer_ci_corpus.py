"""Корпус реальных связок принтер×филамент для CI-гейта реального импорта
(MF-1920, MF-413 фаза 3, последний шаг — «CI-валидация реальным импортом»).

Источник данных — сознательно НЕ живой `slicer_profiles`/`machines`
(Postgres): CI-джоба `python` (`.gitverse/workflows/ci.yaml`) сейчас не
поднимает Postgres-service для `matrix.app == mesh` (в отличие от
node-джобы) — заводить его только ради выборки готового списка связок
было бы лишней инфраструктурой для карточки, которая и так должна дать
зелёный/красный по реальному импорту в три слайсера. Вместо этого корпус
читает РЕАЛЬНЫЕ вендорские JSON-профили прямо из бандла OrcaSlicer,
который CI уже скачивает и распаковывает на шаге провижининга (MF-1918,
`docs/infra/slicer.ci.headless.md`) — тот же апстрим-репозиторий
(`SoftFever/OrcaSlicer` `resources/profiles/`), который парсит
`apps/scout/src/scout/sources/slicer_print_profiles.py` в канон
`slicer_profiles`. Данные подлинные (не выдуманные), только источник
чтения — распакованный бандл слайсера, а не наша БД.

Вендор по умолчанию — Creality: единственный из проверенных вендоров, у
которого ОДНОВРЕМЕННО (а) machine-пресеты самодостаточны (несут
`printable_area`/`printable_height`/`nozzle_diameter` напрямую, не
дельтой) И (б) `fdm_filament_{pla,petg,abs}.json` — тоже НЕ дельты, а
полные профили с конкретными температурами/плотностью. У большинства
других вендоров хотя бы один из файлов — дельта, требующая полного
резолвера цепочки `inherits` (это уже делает `apps/scout` для канона, но
не входит в бюджет этого CI-гейта). Creality даёт 100 инстанцируемых
machine-пресетов — с большим запасом покрывает порог эпика ≥50 принтеров
(`printer_limit` ниже усекает до ровно порога, чтобы не раздувать время
CI без необходимости; полный список можно долить увеличением лимита).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DEFAULT_VENDOR = "Creality"
MATERIALS: tuple[str, ...] = ("pla", "petg", "abs")

# Общий print-процесс (0.20mm Standard-подобный) — одинаковый для всех связок
# корпуса: гейт проверяет импортируемость геометрии+материала, а не перебор
# процессов (это отдельная, не эта карточка, задача резолвера MF-16).
_PROCESS_BASELINE: dict[str, Any] = {
    "layer_height_mm": 0.2,
    "first_layer_height_mm": 0.2,
    "print_speed_mm_s": 60,
    "first_layer_speed_mm_s": 20,
    "travel_speed_mm_s": 150,
    "infill_density_pct": 15,
    "infill_pattern": "grid",
    "wall_loops": 2,
    "top_shell_layers": 4,
    "bottom_shell_layers": 3,
    "support_enable": False,
    "skirt_loops": 1,
    "brim_width_mm": 0,
}


class CorpusError(Exception):
    """Данные вендора в распакованном бандле недостаточны для корпуса."""


@dataclass(frozen=True)
class CorpusEntry:
    vendor: str
    printer_name: str
    material: str
    machine: dict[str, Any]
    params: dict[str, Any]


def _first(doc: dict[str, Any], key: str, default: Any = None) -> Any:
    value = doc.get(key)
    if isinstance(value, list):
        return value[0] if value else default
    return value if value is not None else default


def machine_from_orca_printer_json(doc: dict[str, Any]) -> dict[str, Any]:
    """Геометрия принтера (unified `machine`-словарь, тот же формат, что
    ждёт `slicer_profile_export.build_*_bundle`) — из реального
    инстанцируемого `printer.json` вендора (не дельты, см. докстринг
    модуля).

    `printable_area` в реальных вендорских файлах встречается в ДВУХ
    формах — JSON-список из 4 угловых строк ("0x0", "220x0", ...) ИЛИ
    одна строка с теми же 4 угловыми точками через запятую
    ("0x0,220x0,220x220,0x220") — обе подтверждены живыми файлами
    `resources/profiles/Creality/machine/*.json` этого же бандла (не
    догадка). Нормализуем через join(",")+split(",") — работает для
    обеих форм одинаково.
    """
    area = doc["printable_area"]
    points = ",".join(area).split(",") if isinstance(area, list) else area.split(",")
    xs = [float(point.split("x")[0]) for point in points]
    ys = [float(point.split("x")[1]) for point in points]
    return {
        "build_volume_mm": {
            "x": max(xs) - min(xs),
            "y": max(ys) - min(ys),
            "z": float(doc["printable_height"]),
        },
        "nozzle_diameter_mm": float(doc["nozzle_diameter"][0]),
    }


def params_from_orca_filament_json(doc: dict[str, Any]) -> dict[str, Any]:
    """Материальные unified-ключи из полного (не-дельтового) `fdm_filament_*`
    файла вендора — температуры/плотность реальны, не экстраполированы.
    """
    nozzle_other = float(_first(doc, "nozzle_temperature"))
    nozzle_first = float(_first(doc, "nozzle_temperature_initial_layer", nozzle_other))
    bed_other = float(_first(doc, "hot_plate_temp"))
    bed_first = float(_first(doc, "hot_plate_temp_initial_layer", bed_other))
    return {
        "nozzle_temperature_c": {"other": nozzle_other, "first_layer": nozzle_first},
        "bed_temperature_c": {"other": bed_other, "first_layer": bed_first},
        "max_volumetric_speed_mm3_s": float(_first(doc, "filament_max_volumetric_speed", 10.0)),
        "flow_ratio": float(_first(doc, "filament_flow_ratio", 1.0)),
        "density_g_cm3": float(_first(doc, "filament_density", 1.24)),
        "diameter_mm": 1.75,
    }


def load_orca_vendor_machines(
    profiles_dir: Path, vendor: str, *, limit: int | None = None
) -> list[tuple[str, dict[str, Any]]]:
    """Самодостаточные (не-дельта) инстанцируемые machine-пресеты вендора,
    отсортированы по имени файла для детерминированности корпуса.
    """
    machine_dir = profiles_dir / vendor / "machine"
    if not machine_dir.is_dir():
        raise CorpusError(f"нет папки machine у вендора {vendor}: {machine_dir}")

    entries: list[tuple[str, dict[str, Any]]] = []
    for path in sorted(machine_dir.glob("*.json")):
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if doc.get("instantiation") != "true":
            continue
        if not all(key in doc for key in ("printable_area", "printable_height", "nozzle_diameter")):
            continue
        entries.append((doc.get("name", path.stem), doc))

    if not entries:
        raise CorpusError(f"нет ни одного самодостаточного machine-пресета у вендора {vendor}")
    return entries[:limit] if limit is not None else entries


def load_orca_vendor_materials(profiles_dir: Path, vendor: str) -> dict[str, dict[str, Any]]:
    """Полные (не-дельта) `fdm_filament_{pla,petg,abs}.json` вендора."""
    materials: dict[str, dict[str, Any]] = {}
    for material in MATERIALS:
        path = profiles_dir / vendor / "filament" / f"fdm_filament_{material}.json"
        if not path.is_file():
            raise CorpusError(f"нет общего filament-профиля {material} у вендора {vendor}: {path}")
        doc = json.loads(path.read_text(encoding="utf-8"))
        if not all(key in doc for key in ("nozzle_temperature", "hot_plate_temp")):
            raise CorpusError(
                f"filament-профиль {material} вендора {vendor} — дельта без температур, не подходит"
            )
        materials[material] = doc
    return materials


def build_corpus(
    profiles_dir: Path, *, vendor: str = DEFAULT_VENDOR, printer_limit: int = 50
) -> list[CorpusEntry]:
    """≥50 принтеров × 3 материала (MF-1920 «Готово когда» — реальные
    вендорские данные, см. докстринг модуля про выбор источника/вендора).
    """
    machines = load_orca_vendor_machines(profiles_dir, vendor, limit=printer_limit)
    materials = load_orca_vendor_materials(profiles_dir, vendor)

    entries: list[CorpusEntry] = []
    for printer_name, machine_doc in machines:
        machine = machine_from_orca_printer_json(machine_doc)
        for material_name, material_doc in materials.items():
            params = dict(_PROCESS_BASELINE)
            params.update(params_from_orca_filament_json(material_doc))
            entries.append(
                CorpusEntry(
                    vendor=vendor,
                    printer_name=printer_name,
                    material=material_name,
                    machine=machine,
                    params=params,
                )
            )
    return entries
