"""Вызов headless-слайсера (PrusaSlicer, MF-989; OrcaSlicer, MF-1974) и минимальный
резолвер профиля.

Полный резолвер экспорта (MF-16/MF-412 — множественные слайсеры, честный мэппинг
унифицированных ключей `slicer_profiles.params` на нативные секции каждого вендора)
ещё не готов (см. docs/epics/slicer.profiles.md). Здесь — узкий MVP-путь только под
PrusaSlicer (единственный установленный на dev-3mf headless-бинарь, MF-989): цепочка
`inherits_id` мёржится сверху вниз (дельты, не плоская копия — тот же принцип, что у
самой схемы), результат льётся как INI-секции `[print]`/`[filament]`/`[printer]` по
`profile_class`. Раз `parse_prusa_bundle` (MF-627) уже кладёт в `params` дельты сырых
INI-ключей вендорского бандла PrusaSlicer, для prusaslicer-профилей это прямой путь без
дополнительного мэппинга; профили других слайсеров (orcaslicer/cura) этим путём сейчас
не резолвятся — `resolve_prusa_ini` кидает `UnsupportedSlicerError` для них, воркер
заводит джобу в `failed` с понятной причиной, ждём полного резолвера MF-16.

## OrcaSlicer headless-слайс (MF-1974)

`run_orcaslicer` — РЕАЛЬНЫЙ headless-слайс (не только импорт-валидация, как
`slicer_ci_validate.validate_orca_import`, MF-1920): `--slice 0 --export-3mf`
встраивает в экспортируемый `.3mf` настоящий toolpath (`Metadata/plate_N.gcode`)
и метрики (`Metadata/slice_info.config` — `prediction` секунд, `weight`/`used_g`
грамм, `used_m` метров филамента), подтверждено живым прогоном на пиненном
`orca-slicer` v2.4.2 (та же версия, что провижинит CI, MF-1918) против реального
`.stl` из корпуса SO-ARM100 (см. `snapmaker_u1_profile.py`/тесты). Out-of-bed
объект даёт реальный ненулевой exit (`206` на живом прогоне, "run found error")
без файла на диске — тот же честный `SlicingError`, что и таймаут/нехватка
бинаря, никакого "тихого" неполного успеха.

Резолвер `profile_id → native Orca dict` для `slicer_profiles` (DB) этим шагом
НЕ сделан — текущая схема `slice_jobs` несёт только `profile_id`/
`filament_profile_id` (два id), без отдельного поля под machine-геометрию,
которая Orca требует отдельно (`printable_area`/`printable_height`/
`nozzle_diameter`, см. `slicer_profile_export.py`); дописывать это здесь без
согласования с Data/Back (владельцы схемы `slice_jobs`/`machines`) означало бы
гадать контракт — запрещено принципами зоны. `run_orcaslicer` поэтому принимает
уже готовые native-словари (printer/process/filament) — вызывающий код
(`snapmaker_u1_profile.py` в этой карточке, DB-резолвер — следующий шаг)
отвечает за их сборку.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

import psycopg


class UnsupportedSlicerError(Exception):
    """Профиль не из поддерживаемого этим MVP-резолвером слайсера (см. докстринг файла)."""


class SlicingError(Exception):
    """Сам вызов слайсера (subprocess) завершился ошибкой/таймаутом."""


@dataclass(frozen=True)
class SlicerEngineConfig:
    binary_path: str
    cpu_quota_percent: int
    memory_max_mb: int
    tasks_max: int
    timeout_seconds: int


def load_slicer_engine_config() -> SlicerEngineConfig | None:
    """None, если бинарь слайсера не сконфигурирован — воркер простаивает по slice_jobs
    (тот же паттерн, что отсутствие S3/DATABASE_URL в config.py), не падает.
    """
    binary_path = os.getenv("SLICER_BINARY_PATH")
    if not binary_path:
        return None
    return SlicerEngineConfig(
        binary_path=binary_path,
        cpu_quota_percent=int(os.getenv("SLICER_CPU_QUOTA_PERCENT", "150")),
        memory_max_mb=int(os.getenv("SLICER_MEMORY_MAX_MB", "1536")),
        tasks_max=int(os.getenv("SLICER_TASKS_MAX", "16")),
        timeout_seconds=int(os.getenv("SLICER_TIMEOUT_SECONDS", "300")),
    )


def load_orca_engine_config() -> SlicerEngineConfig | None:
    """Независимый от `load_slicer_engine_config` (Prusa) конфиг — воркер может
    иметь оба бинаря сразу (мульти-движковая очередь, MF-1974) или ни одного
    (простаивает по `slice_jobs` того движка, для которого бинарь не задан).
    Дефолты выше, чем у Prusa (`MemoryMax`/`TimeoutSeconds`) — живой прогон этой
    карточки на реальной плите SO-101 (96k треугольников, 4.8МБ STL) занял ~48с
    и держал RSS заметно выше типичного Prusa-слайса одной детали; таймаут с
    запасом под более крупные плиты корпуса.
    """
    binary_path = os.getenv("SLICER_ORCA_BINARY_PATH")
    if not binary_path:
        return None
    return SlicerEngineConfig(
        binary_path=binary_path,
        cpu_quota_percent=int(os.getenv("SLICER_ORCA_CPU_QUOTA_PERCENT", "150")),
        memory_max_mb=int(os.getenv("SLICER_ORCA_MEMORY_MAX_MB", "2048")),
        tasks_max=int(os.getenv("SLICER_ORCA_TASKS_MAX", "16")),
        timeout_seconds=int(os.getenv("SLICER_ORCA_TIMEOUT_SECONDS", "600")),
    )


def _profile_chain(conn: psycopg.Connection, profile_id: str) -> list[dict]:
    """Цепочка профиля от корня до `profile_id` (родитель первым — мёрж сверху вниз)."""
    chain: list[dict] = []
    current_id: str | None = profile_id
    seen: set[str] = set()
    with conn.cursor() as cur:
        while current_id is not None:
            if current_id in seen:
                raise UnsupportedSlicerError(f"цикл в inherits_id профиля {profile_id}")
            seen.add(current_id)
            cur.execute(
                "select id, profile_class, slicer, inherits_id, params"
                " from slicer_profiles where id = %s",
                (current_id,),
            )
            row = cur.fetchone()
            if row is None:
                raise UnsupportedSlicerError(f"профиль {current_id} не найден")
            chain.append(
                {
                    "id": row[0],
                    "profile_class": row[1],
                    "slicer": row[2],
                    "inherits_id": row[3],
                    "params": row[4] or {},
                }
            )
            current_id = row[3]
    chain.reverse()
    return chain


_CLASS_TO_SECTION = {"machine": "printer", "process": "print", "filament": "filament"}


def resolve_prusa_ini(conn: psycopg.Connection, profile_id: str) -> tuple[str, dict]:
    """Мёржит цепочку наследования профиля в один набор `key = value` под секцией
    PrusaSlicer, соответствующей `profile_class` последнего звена. Возвращает
    (ini-текст, смёрдженные params) — params нужны вызывающему коду для metrics/отладки.
    """
    chain = _profile_chain(conn, profile_id)
    for link in chain:
        if link["slicer"] != "prusaslicer":
            raise UnsupportedSlicerError(
                f"профиль {link['id']} — слайсер '{link['slicer']}', "
                "резолвер MVP умеет только prusaslicer"
            )
    merged: dict = {}
    for link in chain:
        merged.update(link["params"])
    section = _CLASS_TO_SECTION[chain[-1]["profile_class"]]
    lines = [f"[{section}]"] + [f"{key} = {value}" for key, value in merged.items()]
    return "\n".join(lines) + "\n", merged


def run_prusaslicer(
    config: SlicerEngineConfig,
    stl_path: Path,
    ini_texts: list[str],
    output_gcode: Path,
) -> None:
    """Headless-слайс через `prusa-slicer -g --export-gcode`, обёрнутый в
    `systemd-run --user --scope` с cgroup-лимитами (MF-989) + `timeout` как wall-clock
    backstop поверх cgroup (та же схема, что `sandbox.py`/RLIMIT_AS для python-потока —
    здесь внешний процесс, поэтому лимит на уровне systemd-scope, не на python).
    """
    with tempfile.TemporaryDirectory(prefix="mesh-slice-ini-") as tmp:
        tmp_dir = Path(tmp)
        ini_args: list[str] = []
        for idx, text in enumerate(ini_texts):
            ini_path = tmp_dir / f"profile-{idx}.ini"
            ini_path.write_text(text, encoding="utf-8")
            ini_args += ["--load", str(ini_path)]

        cmd = [
            "systemd-run",
            "--user",
            "--scope",
            "-p", f"CPUQuota={config.cpu_quota_percent}%",
            "-p", f"MemoryMax={config.memory_max_mb}M",
            "-p", f"TasksMax={config.tasks_max}",
            "--",
            "timeout",
            str(config.timeout_seconds),
            config.binary_path,
            "-g",
            "--export-gcode",
            *ini_args,
            "-o",
            str(output_gcode),
            str(stl_path),
        ]
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=config.timeout_seconds + 30,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise SlicingError(
                f"слайсер не уложился в таймаут (systemd-run: {shlex.join(cmd)})"
            ) from exc

        if result.returncode != 0 or not output_gcode.exists():
            raise SlicingError(
                f"слайсер завершился с кодом {result.returncode}: stderr={result.stderr[-2000:]}"
            )


@dataclass(frozen=True)
class OrcaSliceMetrics:
    """Реальные метрики из `Metadata/slice_info.config` (не оценка мешем, а то,
    что сам Orca посчитал по факту построенного toolpath)."""

    print_time_seconds: float
    filament_used_g: float
    filament_used_m: float
    warnings: tuple[str, ...]


def _write_orca_settings(
    tmp_dir: Path,
    printer_json: dict[str, Any],
    process_json: dict[str, Any],
    filament_json: dict[str, Any],
) -> tuple[Path, Path, Path]:
    printer_path = tmp_dir / "printer.json"
    process_path = tmp_dir / "process.json"
    filament_path = tmp_dir / "filament.json"
    printer_path.write_text(json.dumps(printer_json), encoding="utf-8")
    process_path.write_text(json.dumps(process_json), encoding="utf-8")
    filament_path.write_text(json.dumps(filament_json), encoding="utf-8")
    return printer_path, process_path, filament_path


def _orca_slice_cmd(
    binary_path: str, printer_path: Path, process_path: Path, filament_path: Path,
    stl_path: Path, out_3mf: Path, *, arrange: bool = True,
) -> list[str]:
    """`--arrange 1 --ensure-on-bed` (по умолчанию) — реальные объекты корпуса
    SO-ARM100 не всегда приходят уже центрированными/лежащими на Z=0
    (проверено живьём на `Base_SO101.stl` — bbox уходит в отрицательные X/Z);
    без auto-arrange слайсер либо кладёт деталь вне стола, либо режет её
    ниже нуля. Preflight (см. `slicer_preflight.py`) проверяет исходный bbox
    ДО этого вызова — auto-arrange здесь не заменяет preflight, а даёт
    слайсеру физически валидную стартовую позицию для уже прошедшей preflight
    детали.

    `arrange=False` (MF-1987, мульти-инстанс плита) — вход уже несёт
    провалидированный per-item transform (`snapmaker_u1_slice.build_plate_3mf`,
    `slicer_preflight.check_plate_layout`); Orca не должен переписывать уже
    проверенную раскладку. Тот же вызов НЕ добавляет `--ensure-on-bed` в этом
    случае — Z-выравнивание каждого инстанса на бэд Mesh делает сам при
    сборке plate-3MF (см. `build_plate_3mf`), не полагаясь на недокументированное
    для отключённого `--arrange` поведение флага у стороннего бинаря.
    """
    cmd = [
        binary_path,
        "--load-settings", f"{printer_path};{process_path}",
        "--load-filaments", str(filament_path),
    ]
    if arrange:
        cmd += ["--arrange", "1", "--ensure-on-bed"]
    else:
        cmd += ["--arrange", "0"]
    cmd += ["--slice", "0", "--export-3mf", str(out_3mf), str(stl_path)]
    return cmd


def slice_with_orca_cli(
    binary_path: str,
    stl_path: Path,
    printer_json: dict[str, Any],
    process_json: dict[str, Any],
    filament_json: dict[str, Any],
    output_gcode: Path,
    *,
    timeout_seconds: int = 180,
) -> OrcaSliceMetrics:
    """Прямой вызов `orca-slicer` БЕЗ cgroup-обёртки (`systemd-run`) — тот же
    уровень, что `slicer_ci_validate.validate_orca_import` (MF-1920):
    подходит для live-тестов в окружении без пользовательской systemd/dbus-
    сессии (эта песочница, вероятно и часть CI-раннеров — `run_orcaslicer`
    ниже требует её и поэтому нигде в тестах не гоняется живым бинарём, тот
    же паттерн, что уже сложился для `run_prusaslicer`). Продовый воркер
    (`slicing_queue.py`) обязан звать cgroup-обёрнутый `run_orcaslicer`, не
    эту функцию напрямую — здесь нет лимитов CPU/памяти/таймаута процесса.
    """
    with tempfile.TemporaryDirectory(prefix="mesh-orca-slice-cli-") as tmp:
        tmp_dir = Path(tmp)
        printer_path, process_path, filament_path = _write_orca_settings(
            tmp_dir, printer_json, process_json, filament_json
        )
        out_3mf = tmp_dir / "sliced.3mf"
        cmd = _orca_slice_cmd(
            binary_path, printer_path, process_path, filament_path, stl_path, out_3mf
        )
        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=timeout_seconds, check=False
            )
        except subprocess.TimeoutExpired as exc:
            raise SlicingError(f"orcaslicer не уложился в таймаут ({shlex.join(cmd)})") from exc

        if result.returncode != 0 or not out_3mf.exists():
            raise SlicingError(
                f"orcaslicer завершился с кодом {result.returncode}: "
                f"stderr={result.stderr[-2000:]} stdout={result.stdout[-500:]}"
            )
        return _extract_orca_slice_result(out_3mf, output_gcode)


def run_orcaslicer(
    config: SlicerEngineConfig,
    stl_path: Path,
    printer_json: dict[str, Any],
    process_json: dict[str, Any],
    filament_json: dict[str, Any],
    output_gcode: Path,
) -> OrcaSliceMetrics:
    """Headless-слайс через `orca-slicer --slice 0 --export-3mf`, тот же
    `systemd-run --user --scope` cgroup-обёрточный паттерн, что `run_prusaslicer`
    (см. докстринг модуля § «OrcaSlicer headless-слайс») — продовый вход для
    будущего DB-driven диспетчера очереди. Живая проверка реального
    CLI-поведения (успех/collision/метрики) — через `slice_with_orca_cli`
    (см. её докстринг про отсутствие пользовательской systemd-сессии здесь).
    """
    with tempfile.TemporaryDirectory(prefix="mesh-orca-slice-") as tmp:
        tmp_dir = Path(tmp)
        printer_path, process_path, filament_path = _write_orca_settings(
            tmp_dir, printer_json, process_json, filament_json
        )
        out_3mf = tmp_dir / "sliced.3mf"
        cmd = [
            "systemd-run",
            "--user",
            "--scope",
            "-p", f"CPUQuota={config.cpu_quota_percent}%",
            "-p", f"MemoryMax={config.memory_max_mb}M",
            "-p", f"TasksMax={config.tasks_max}",
            "--",
            "timeout",
            str(config.timeout_seconds),
            *_orca_slice_cmd(
                config.binary_path, printer_path, process_path, filament_path, stl_path, out_3mf
            ),
        ]
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=config.timeout_seconds + 30,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise SlicingError(
                f"orcaslicer не уложился в таймаут (systemd-run: {shlex.join(cmd)})"
            ) from exc

        if result.returncode != 0 or not out_3mf.exists():
            raise SlicingError(
                f"orcaslicer завершился с кодом {result.returncode}: "
                f"stderr={result.stderr[-2000:]} stdout={result.stdout[-500:]}"
            )

        return _extract_orca_slice_result(out_3mf, output_gcode)


def _read_orca_export(exported_3mf: Path) -> tuple[bytes, str]:
    """Общая распаковка `--export-3mf`: ровно один plate-gcode + slice_info.config.
    Используется и агрегатным (`_extract_orca_slice_result`), и по-объектным
    (`_extract_orca_plate_slice_result`, MF-1987) парсерами — одна точка
    валидации формы экспорта, не дублируем условия в двух местах.
    """
    with zipfile.ZipFile(exported_3mf) as archive:
        gcode_names = sorted(
            name
            for name in archive.namelist()
            if name.startswith("Metadata/plate_") and name.endswith(".gcode")
        )
        if not gcode_names:
            raise SlicingError("orcaslicer export не содержит plate-gcode — слайс не выполнен")
        if len(gcode_names) > 1:
            raise SlicingError(
                f"orcaslicer export содержит {len(gcode_names)} плейтов — "
                "MVP (MF-1974) поддерживает ровно один плейт на джобу"
            )
        gcode_bytes = archive.read(gcode_names[0])

        info_names = [name for name in archive.namelist() if name.endswith("slice_info.config")]
        if not info_names:
            raise SlicingError("orcaslicer export без slice_info.config — метрики недоступны")
        info_xml = archive.read(info_names[0]).decode("utf-8")
    return gcode_bytes, info_xml


def _extract_orca_slice_result(exported_3mf: Path, output_gcode: Path) -> OrcaSliceMetrics:
    gcode_bytes, info_xml = _read_orca_export(exported_3mf)
    output_gcode.write_bytes(gcode_bytes)
    return _parse_orca_slice_info(info_xml)


def _parse_orca_slice_info(info_xml: str) -> OrcaSliceMetrics:
    try:
        root = ElementTree.fromstring(info_xml)
    except ElementTree.ParseError as exc:
        raise SlicingError(f"slice_info.config: невалидный XML: {exc}") from exc

    plate = root.find("plate")
    if plate is None:
        raise SlicingError("slice_info.config без <plate> — неожиданный формат вывода orcaslicer")

    metadata = {item.get("key"): item.get("value") for item in plate.findall("metadata")}
    warnings: list[str] = []
    for obj in plate.findall("object"):
        if obj.get("skipped") == "true":
            warnings.append(f"объект '{obj.get('name')}' пропущен слайсером (skipped=true)")

    filaments = plate.findall("filament")
    if not filaments:
        raise SlicingError("slice_info.config без <filament> — метрики расхода недоступны")
    filament_used_g = sum(float(f.get("used_g", "0")) for f in filaments)
    filament_used_m = sum(float(f.get("used_m", "0")) for f in filaments)

    prediction = metadata.get("prediction")
    try:
        print_time_seconds = float(prediction)
    except (TypeError, ValueError) as exc:
        raise SlicingError(
            f"slice_info.config: не удалось разобрать 'prediction'={prediction!r}"
        ) from exc

    return OrcaSliceMetrics(
        print_time_seconds=print_time_seconds,
        filament_used_g=filament_used_g,
        filament_used_m=filament_used_m,
        warnings=tuple(warnings),
    )


## Мульти-инстанс плита (MF-1987, project-slice-request.v1) — несколько объектов
## в одном `--export-3mf`, per-object разбивка для preview-манифеста.


@dataclass(frozen=True)
class OrcaPlateObjectResult:
    """Метрика одного объекта плиты. `name` смэтчен с `instance_id`, который
    Mesh задаёт при сборке plate-3MF (`snapmaker_u1_slice.build_plate_3mf`
    именует каждый `<object>` по `instance_id`) — Orca переносит имя объекта
    в `slice_info.config` без изменений (тот же атрибут `name`, что уже
    используется для skipped-warning в `_parse_orca_slice_info`), так
    per-instance результат матчится обратно без угадывания по порядку."""

    name: str
    skipped: bool


@dataclass(frozen=True)
class OrcaPlateSliceResult:
    metrics: OrcaSliceMetrics
    objects: tuple[OrcaPlateObjectResult, ...]
    layer_count: int


_LAYER_COUNT_HEADER = re.compile(rb"total layer number[:\s]+(\d+)", re.IGNORECASE)


def _parse_layer_count(gcode: bytes) -> int:
    """Реальный `layer_count` из toolpath-gcode плейта (MF-1987 — «данные, уже
    существующие внутри экспортируемого .3mf», не оценка Mesh). Сначала явный
    header-комментарий вендора (`; total layer number: N`, конвенция
    Bambu/Orca-семейства), иначе счёт маркеров смены слоя (`;LAYER_CHANGE` /
    `; CHANGE_LAYER` — тот же Marlin-семейный конвеншн, что и у остальных
    форков PrusaSlicer/OrcaSlicer). Честный отказ, если ни один формат не
    распознан — не подставляем 0 или выдуманное число (см. `test_snapmaker_u1_slice.py`
    для живой проверки этого парсера против реального бинаря)."""
    header = _LAYER_COUNT_HEADER.search(gcode)
    if header is not None:
        return int(header.group(1))
    count = gcode.count(b";LAYER_CHANGE") or gcode.count(b"; CHANGE_LAYER")
    if count > 0:
        return count
    raise SlicingError(
        "не удалось определить layer_count из gcode — неизвестный формат маркеров слоёв"
    )


def _extract_orca_plate_slice_result(
    exported_3mf: Path, output_gcode: Path
) -> OrcaPlateSliceResult:
    """Тот же экспорт, что `_extract_orca_slice_result`, но с per-object
    разбивкой — используется мульти-инстанс путём (`slice_plate_with_orca_cli`/
    `run_orcaslicer_plate`)."""
    gcode_bytes, info_xml = _read_orca_export(exported_3mf)
    output_gcode.write_bytes(gcode_bytes)
    metrics = _parse_orca_slice_info(info_xml)

    try:
        root = ElementTree.fromstring(info_xml)
    except ElementTree.ParseError as exc:
        raise SlicingError(f"slice_info.config: невалидный XML: {exc}") from exc
    plate = root.find("plate")
    if plate is None:
        raise SlicingError("slice_info.config без <plate> — неожиданный формат вывода orcaslicer")
    objects = tuple(
        OrcaPlateObjectResult(name=obj.get("name") or "", skipped=obj.get("skipped") == "true")
        for obj in plate.findall("object")
    )
    layer_count = _parse_layer_count(gcode_bytes)
    return OrcaPlateSliceResult(metrics=metrics, objects=objects, layer_count=layer_count)


def slice_plate_with_orca_cli(
    binary_path: str,
    plate_3mf_path: Path,
    printer_json: dict[str, Any],
    process_json: dict[str, Any],
    filament_json: dict[str, Any],
    output_gcode: Path,
    *,
    timeout_seconds: int = 180,
) -> OrcaPlateSliceResult:
    """Мульти-инстанс вариант `slice_with_orca_cli` (MF-1987) БЕЗ cgroup-обёртки
    — живые тесты в окружении без пользовательской systemd/dbus-сессии (тот же
    паттерн, что у одиночного пути). Вход — уже собранный multi-object
    plate-3MF (`snapmaker_u1_slice.build_plate_3mf`) с зафиксированными
    per-item transform'ами; `arrange=False` обязателен — Orca не должен
    переписывать уже провалидированную раскладку. Продовый воркер обязан
    звать cgroup-обёрнутый `run_orcaslicer_plate`, не эту функцию напрямую."""
    with tempfile.TemporaryDirectory(prefix="mesh-orca-plate-cli-") as tmp:
        tmp_dir = Path(tmp)
        printer_path, process_path, filament_path = _write_orca_settings(
            tmp_dir, printer_json, process_json, filament_json
        )
        out_3mf = tmp_dir / "sliced.3mf"
        cmd = _orca_slice_cmd(
            binary_path, printer_path, process_path, filament_path, plate_3mf_path, out_3mf,
            arrange=False,
        )
        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=timeout_seconds, check=False
            )
        except subprocess.TimeoutExpired as exc:
            raise SlicingError(f"orcaslicer не уложился в таймаут ({shlex.join(cmd)})") from exc

        if result.returncode != 0 or not out_3mf.exists():
            raise SlicingError(
                f"orcaslicer завершился с кодом {result.returncode}: "
                f"stderr={result.stderr[-2000:]} stdout={result.stdout[-500:]}"
            )
        return _extract_orca_plate_slice_result(out_3mf, output_gcode)


def run_orcaslicer_plate(
    config: SlicerEngineConfig,
    plate_3mf_path: Path,
    printer_json: dict[str, Any],
    process_json: dict[str, Any],
    filament_json: dict[str, Any],
    output_gcode: Path,
) -> OrcaPlateSliceResult:
    """cgroup-обёрнутый продовый вход мульти-инстанс плиты (MF-1987) — см.
    `run_orcaslicer` для одиночного пути, тот же `systemd-run --user --scope`
    паттерн."""
    with tempfile.TemporaryDirectory(prefix="mesh-orca-plate-") as tmp:
        tmp_dir = Path(tmp)
        printer_path, process_path, filament_path = _write_orca_settings(
            tmp_dir, printer_json, process_json, filament_json
        )
        out_3mf = tmp_dir / "sliced.3mf"
        cmd = [
            "systemd-run",
            "--user",
            "--scope",
            "-p", f"CPUQuota={config.cpu_quota_percent}%",
            "-p", f"MemoryMax={config.memory_max_mb}M",
            "-p", f"TasksMax={config.tasks_max}",
            "--",
            "timeout",
            str(config.timeout_seconds),
            *_orca_slice_cmd(
                config.binary_path, printer_path, process_path, filament_path,
                plate_3mf_path, out_3mf, arrange=False,
            ),
        ]
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=config.timeout_seconds + 30,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise SlicingError(
                f"orcaslicer не уложился в таймаут (systemd-run: {shlex.join(cmd)})"
            ) from exc

        if result.returncode != 0 or not out_3mf.exists():
            raise SlicingError(
                f"orcaslicer завершился с кодом {result.returncode}: "
                f"stderr={result.stderr[-2000:]} stdout={result.stdout[-500:]}"
            )
        return _extract_orca_plate_slice_result(out_3mf, output_gcode)
