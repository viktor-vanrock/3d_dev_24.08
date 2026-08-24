"""Канонический профиль Snapmaker U1 для headless OrcaSlicer (MF-1974).

Snapmaker U1 официально поддержан самим OrcaSlicer (вендор `Snapmaker`,
`resources/profiles/Snapmaker/machine/Snapmaker U1*.json` — тот же апстрим
`SoftFever/OrcaSlicer`, который уже парсит `apps/scout` в канон `slicer_profiles`
и который CI провижинит headless для валидации экспортёра, MF-1918/MF-1920).
Для этой карточки источник — НЕ синтетическая реконструкция через
`slicer_profile_export.build_orca_bundle` (тот путь — generic "любой принтер
каталога `machines`", с синтетическим compatible-linkage якорем, см. докстринг
`slicer_profile_export.py`), а РЕАЛЬНЫЙ вендорский профиль, читаемый напрямую из
распакованного бандла Orca — тот же паттерн источника данных, что уже
используют `slicer_ci_corpus.py`/`apps/scout/.../slicer_print_profiles.py`
(живые вендорские JSON, не выдуманные числа).

## Наследование — та же delta-модель, что у `slicer_profiles` (Data, MF-411)

Вендорские файлы Orca хранят профиль через `inherits` (см.
`docs/epics/slicer.profiles.md` § «Наследование — дельты, не плоская копия»):
`resolve_snapmaker_u1_profile` резолвит цепочку `machine`/`process`/`filament`
внутри `resources/profiles/Snapmaker/` тем же способом, что и живой
GUI-импорт Orca — родитель первым, дочерний переопределяет. Проверено живым
прогоном (MF-1974): резолвленная тройка `Snapmaker U1 (0.4 nozzle)` +
`0.20 Standard @Snapmaker U1 (0.4 nozzle)` + `Snapmaker PLA @U1` реально режет
`orca-slicer --slice 0 --export-3mf` в валидный toolpath на реальном корпусе
SO-ARM100 (см. тесты).

## Multi-toolhead U1 — явно не симулируется (MVP-граница карточки)

`fdm_U1.json` (базовый machine-профиль U1) наследует `fdm_toolchanger` — U1
физически 4-toolhead (плюс общий 5-й слот в базовом non-instantiable
`fdm_U1`, `single_extruder_multi_material: "0"`). Эта карточка (MF-1974)
явно ограничена single-material печатью через toolhead `0` — маппинг
деталь→toolhead НЕ реализован и НЕ симулируется угадыванием; вызывающий код
обязан прогнать `slicer_preflight.check_single_toolhead` до слайса.

## Провенанс

`SnapmakerU1Profile.content_hash` — sha256 канонической (`sort_keys=True`)
сериализации резолвленной тройки printer/process/filament — воспроизводим:
тот же вендорский бандл даёт тот же хэш байт-в-байт (проверено повторным
резолвом в тестах). `source_ref` указывает на три конкретных файла внутри
вендорского бандла — воспроизводимость "откуда именно взято" (тот же принцип,
что `slicer_profiles.source_ref` у Data, docs/epics/slicer.profiles.md
§ «Провенанс»).
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SOURCE_NAME = "SoftFever/OrcaSlicer"
SOURCE_URL = "https://github.com/SoftFever/OrcaSlicer"
# Та же пиненная версия, что CI провижинит для headless-валидации (MF-1918,
# docs/infra/slicer.ci.headless.md) — не отдельная, не гаданная.
SOURCE_VERSION = "v2.4.2"
SOURCE_LICENSE = "AGPL-3.0"

VENDOR = "Snapmaker"
PRINTER_NAME = "Snapmaker U1 (0.4 nozzle)"
PROCESS_NAME = "0.20 Standard @Snapmaker U1 (0.4 nozzle)"
FILAMENT_NAME = "Snapmaker PLA @U1"

# Паспорт U1 (build volume/nozzle) — вендорский официальный спек (270×270×270,
# см. описание карточки) ПОДТВЕРЖДЁН живым чтением вендорского Orca-профиля
# (MF-1974): допуск в 1мм на округление printable_height/printable_area.
EXPECTED_BUILD_VOLUME_MM: dict[str, float] = {"x": 270.0, "y": 270.0, "z": 270.05}
_GEOMETRY_TOLERANCE_MM = 1.0

# MVP этой карточки — single-material, только toolhead 0 (см. докстринг модуля).
SUPPORTED_TOOLHEAD_INDEX = 0


class SnapmakerProfileError(Exception):
    """Вендорские файлы Snapmaker U1 не найдены/не резолвятся в распакованном
    бандле Orca, либо резолвленная геометрия разошлась с зафиксированным
    паспортом U1."""


def _load_by_name(profiles_dir: Path, vendor: str, subdir: str, name: str) -> dict[str, Any]:
    directory = profiles_dir / vendor / subdir
    if not directory.is_dir():
        raise SnapmakerProfileError(f"нет папки '{subdir}' у вендора '{vendor}': {directory}")
    for path in sorted(directory.glob("*.json")):
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if doc.get("name") == name:
            return doc
    raise SnapmakerProfileError(f"профиль '{name}' не найден в {directory}")


def _resolve_inherits_chain(
    profiles_dir: Path, vendor: str, subdir: str, name: str, *, max_depth: int = 32
) -> dict[str, Any]:
    """Родитель первым, дочерний переопределяет — та же модель мёржа, что
    `slicer_engine._profile_chain`/`resolve_prusa_ini`, но по вендорским
    `inherits`-именам внутри бандла Orca, а не по `inherits_id` в Postgres."""
    chain: list[dict[str, Any]] = []
    seen: set[str] = set()
    current: str | None = name
    while current is not None:
        if current in seen:
            raise SnapmakerProfileError(f"цикл inherits при резолве {subdir}/{name} на '{current}'")
        if len(chain) >= max_depth:
            raise SnapmakerProfileError(
                f"цепочка inherits {subdir}/{name} превысила max_depth={max_depth}"
            )
        seen.add(current)
        doc = _load_by_name(profiles_dir, vendor, subdir, current)
        chain.append(doc)
        current = doc.get("inherits")
    chain.reverse()
    merged: dict[str, Any] = {}
    for doc in chain:
        merged.update({key: value for key, value in doc.items() if key != "inherits"})
    return merged


def _canonical_bytes(doc: dict[str, Any]) -> bytes:
    return json.dumps(doc, sort_keys=True, ensure_ascii=False).encode("utf-8")


def _parse_printable_area(printer: dict[str, Any]) -> tuple[float, float]:
    area = printer.get("printable_area")
    if not area:
        raise SnapmakerProfileError("printer-профиль без 'printable_area'")
    points = ",".join(area).split(",") if isinstance(area, list) else str(area).split(",")
    xs = [float(point.split("x")[0]) for point in points]
    ys = [float(point.split("x")[1]) for point in points]
    return max(xs) - min(xs), max(ys) - min(ys)


def build_volume_mm(printer: dict[str, Any]) -> dict[str, float]:
    """Unified `{x,y,z}` из нативных `printable_area`/`printable_height`
    (тот же нормализатор, что `slicer_ci_corpus.machine_from_orca_printer_json`,
    но на резолвленном (не сыром дельтовом) printer-документе)."""
    x, y = _parse_printable_area(printer)
    if "printable_height" not in printer:
        raise SnapmakerProfileError("printer-профиль без 'printable_height'")
    return {"x": x, "y": y, "z": float(printer["printable_height"])}


def _assert_expected_geometry(printer: dict[str, Any]) -> None:
    volume = build_volume_mm(printer)
    for axis, expected in EXPECTED_BUILD_VOLUME_MM.items():
        actual = volume[axis]
        if abs(actual - expected) > _GEOMETRY_TOLERANCE_MM:
            raise SnapmakerProfileError(
                f"неожиданная геометрия Snapmaker U1: {axis}={actual}мм, "
                f"ожидали ~{expected}мм (допуск {_GEOMETRY_TOLERANCE_MM}мм) — вендорский "
                "бандл Orca разошёлся с паспортом, зафиксированным MF-1974"
            )


@dataclass(frozen=True)
class SnapmakerU1Profile:
    printer: dict[str, Any]
    process: dict[str, Any]
    filament: dict[str, Any]
    content_hash: str
    source_name: str
    source_url: str
    source_ref: str
    source_version: str
    license: str

    @property
    def build_volume_mm(self) -> dict[str, float]:
        return build_volume_mm(self.printer)


def resolve_snapmaker_u1_profile(
    profiles_dir: Path,
    *,
    printer_name: str = PRINTER_NAME,
    process_name: str = PROCESS_NAME,
    filament_name: str = FILAMENT_NAME,
) -> SnapmakerU1Profile:
    """`profiles_dir` — корень `resources/profiles` распакованного бандла Orca
    (тот же `MESH_ORCA_PROFILES_DIR`, что использует CI-провижининг MF-1918:
    `<extracted AppImage>/resources/profiles`)."""
    printer = _resolve_inherits_chain(profiles_dir, VENDOR, "machine", printer_name)
    process = _resolve_inherits_chain(profiles_dir, VENDOR, "process", process_name)
    filament = _resolve_inherits_chain(profiles_dir, VENDOR, "filament", filament_name)

    _assert_expected_geometry(printer)

    digest = hashlib.sha256()
    digest.update(_canonical_bytes(printer))
    digest.update(_canonical_bytes(process))
    digest.update(_canonical_bytes(filament))

    source_ref = "; ".join(
        f"resources/profiles/{VENDOR}/{subdir}/{name}.json"
        for subdir, name in (
            ("machine", printer_name),
            ("process", process_name),
            ("filament", filament_name),
        )
    )
    return SnapmakerU1Profile(
        printer=printer,
        process=process,
        filament=filament,
        content_hash=digest.hexdigest(),
        source_name=SOURCE_NAME,
        source_url=SOURCE_URL,
        source_ref=source_ref,
        source_version=SOURCE_VERSION,
        license=SOURCE_LICENSE,
    )


def load_orca_profiles_dir() -> Path | None:
    """`MESH_ORCA_PROFILES_DIR` — корень распакованного вендорского бандла
    Orca (MF-1974/MF-1987). None, если не сконфигурирован — воркер очереди
    (`slicing_queue.py`) простаивает по U1-джобам, тот же паттерн, что
    отсутствие бинаря/S3/БД в `config.py` (не падает)."""
    value = os.getenv("MESH_ORCA_PROFILES_DIR")
    return Path(value) if value else None
