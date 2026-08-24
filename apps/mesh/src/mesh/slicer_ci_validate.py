"""Реальная CI-валидация импортом в headless-слайсеры (MF-1920, MF-413
фаза 3, шаг «CI-валидация реальным импортом»).

Три РАЗНЫХ CLI-пути, по одному на слайсер — единого метода нет, потому что
ни один из трёх слайсеров не даёт готовой команды "просто validate" для
нашего сценария (полностью синтетический, не-каталожный принтер). Каждый
метод найден и подтверждён живым запуском реального бинаря (версии —
`docs/infra/slicer.ci.headless.md`, те же, что провижинит CI, MF-1918):

- **OrcaSlicer** — `--load-settings ...;process.json --export-3mf`
  (project-merge) на ПРОДОВОМ, НЕИЗМЕНЁННОМ выводе `build_orca_bundle` —
  никакой CI-only модификации бандла не требуется. История: живой бинарь
  сначала показал (MF-1919, `docs/epics/slicer.profiles.md` § «Живая
  проверка реальным бинарём»), что этот CLI-путь сравнивает
  `compatible_printers` не с ИМЕНЕМ printer-пресета (так делает GUI,
  `is_compatible_with_printer`), а с его `inherits` ("system name") — для
  полностью синтетического принтера без `inherits` этот system-name пуст,
  `compatible 0`. Экспортёр это чинит синтетическим якорем `inherits`
  (`_orca_compat_link_id`) — CLI матчит по нему. Но якорь ≠ `printer.name`,
  а `compatible_printers`, ограниченный только якорем, регрессировал бы
  ИМЕННО ту GUI-проверку, ради которой изначально появился (найдено этим
  прогоном, MF-1920, при повторной проверке бандла живым бинарём после
  правки MF-1919 — CLI внезапно снова вернул `compatible 0`, потому что
  между двумя фиксами `compatible_printers` лишился `printer.name`).
  Финальный фикс (в `slicer_profile_export.py`, не здесь) —
  `compatible_printers = [printer.name, якорь]`: оба значения в одном
  массиве, каждая проверка (GUI по имени, CLI по якорю) читает список
  независимо и видит своё совпадение. Подтверждено живым запуском:
  `compatible 1`, реальный `.3mf` записан на диск, `printer.name`
  присутствует в списке байт-в-байт. Гейт валидирует РОВНО ТО, что уйдёт
  пользователю — не CI-only проксирующую копию.
- **PrusaSlicer** — `--load bundle.ini --export-gcode` на ПРОДОВОМ,
  НЕИЗМЕНЁННОМ выводе `build_prusa_bundle` — подтверждено, реально
  генерирует g-code (тот же путь, что MF-1918 нашла рабочим на одной
  связке, здесь — систематически на корпусе).
- **Cura** — НЕ Uranium `InstanceContainer.deserialize()` (открытый гэп
  MF-1918: headless PyQt6/Nuitka-фриз AppImage не даёт запустить
  произвольный Python-скрипт через `UltiMaker-Cura` — это скомпилированная
  точка входа `cura_app.py`, а не универсальный интерпретатор; попытка
  прогнать системным python3.12 с `PYTHONPATH`/`LD_LIBRARY_PATH` на
  бандловые `.so` заканчивалась сегфолтом из-за несовпадения ABI). Вместо
  этого — `CuraEngine` (отдельный C++ CLI слайсер-бэкенд внутри того же
  AppImage, независимый от Qt/Python-фронтенда, задокументированный
  режим `CuraEngine slice -j ... -s key=value -l model.stl -o out.gcode`):
  полный резолв дефолтов `fdmprinter.def.json`/`fdmextruder.def.json`
  (рекурсивный обход `children`, `_collect_defaults` ниже) + оверрайд
  нашими `[values]` → реальный слайс в g-code (подтверждено: реальный
  g-code, ~2000 команд перемещения, температуры совпадают с нашим
  оверрайдом).
  Сам бинарь `CuraEngine` внутри распакованного AppImage нельзя запускать
  напрямую: его ELF-интерпретатор (`lib64/ld-linux-x86-64.so.2`) —
  ОТНОСИТЕЛЬНЫЙ путь, который резолвится только через `AppRun`, а
  `DT_RUNPATH` бинаря — абсолютные пути conan-кэша build-машины GitHub
  Actions, не существующие в CI-окружении. Обходим явным вызовом
  системного `ld.so --library-path <appdir>` — `LD_LIBRARY_PATH`/
  `--library-path` имеет приоритет над `DT_RUNPATH` при резолве
  зависимостей (стандартный порядок поиска glibc), поэтому это безопасно
  и не требует патчить бинарь или ставить FUSE.
"""

from __future__ import annotations

import configparser
import io
import json
import subprocess
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_SYSTEM_LINKER_CANDIDATES: tuple[str, ...] = (
    "/lib64/ld-linux-x86-64.so.2",
    "/lib/ld-linux-x86-64.so.2",
)


@dataclass(frozen=True)
class ValidationResult:
    ok: bool
    detail: str


def _run(cmd: list[str], *, timeout: int) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)


def _extract_zip(data: bytes, target: Path) -> None:
    target.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        archive.extractall(target)


# --- OrcaSlicer --------------------------------------------------------------


def validate_orca_import(
    bundle_zip: bytes, *, orca_bin: str, stl_path: Path, workdir: Path, timeout: int = 60
) -> ValidationResult:
    _extract_zip(bundle_zip, workdir)

    printer_path = workdir / "printer.json"
    process_path = workdir / "process.json"
    filament_path = workdir / "filament.json"

    out_3mf = workdir / "ci_check.3mf"
    result = _run(
        [
            orca_bin,
            "--load-settings",
            f"{printer_path};{process_path}",
            "--load-filaments",
            str(filament_path),
            "--export-3mf",
            str(out_3mf),
            str(stl_path),
        ],
        timeout=timeout,
    )
    if result.returncode != 0 or not out_3mf.is_file() or out_3mf.stat().st_size == 0:
        return ValidationResult(
            False, f"orcaslicer export rc={result.returncode}: {result.stderr.strip()[-500:]}"
        )
    return ValidationResult(True, f"3mf экспортирован ({out_3mf.stat().st_size} байт)")


# --- PrusaSlicer -------------------------------------------------------------


def validate_prusa_import(
    bundle_ini: bytes, *, prusa_bin: str, stl_path: Path, workdir: Path, timeout: int = 120
) -> ValidationResult:
    workdir.mkdir(parents=True, exist_ok=True)
    bundle_path = workdir / "bundle.ini"
    bundle_path.write_bytes(bundle_ini)

    out_gcode = workdir / "ci_check.gcode"
    result = _run(
        [
            prusa_bin,
            "--load",
            str(bundle_path),
            "--export-gcode",
            str(stl_path),
            "--output",
            str(out_gcode),
        ],
        timeout=timeout,
    )
    if result.returncode != 0 or not out_gcode.is_file() or out_gcode.stat().st_size == 0:
        return ValidationResult(
            False, f"prusaslicer export rc={result.returncode}: {result.stderr.strip()[-500:]}"
        )
    return ValidationResult(True, f"g-code сгенерирован ({out_gcode.stat().st_size} байт)")


# --- Cura --------------------------------------------------------------------


def _collect_defaults(definition_doc: dict[str, Any]) -> dict[str, Any]:
    """Рекурсивный обход дерева `settings`/`children` def.json — полный
    набор `default_value` (см. докстринг модуля § Cura).
    """
    out: dict[str, Any] = {}

    def walk(settings: dict[str, Any]) -> None:
        for key, spec in settings.items():
            if not isinstance(spec, dict):
                continue
            if "default_value" in spec:
                out[key] = spec["default_value"]
            children = spec.get("children")
            if isinstance(children, dict):
                walk(children)

    walk(definition_doc.get("settings", {}))
    return out


def _cura_arg_fmt(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, list):
        return json.dumps(value)
    return str(value)


def _cura_setting_args(values: dict[str, Any]) -> list[str]:
    args: list[str] = []
    for key, value in values.items():
        args += ["-s", f"{key}={_cura_arg_fmt(value)}"]
    return args


def _find_system_linker() -> str:
    for candidate in _SYSTEM_LINKER_CANDIDATES:
        if Path(candidate).is_file():
            return candidate
    raise FileNotFoundError(f"системный ld.so не найден среди {_SYSTEM_LINKER_CANDIDATES}")


def validate_cura_import(
    curaprofile_zip: bytes,
    *,
    cura_engine_bin: Path,
    library_dir: Path,
    definitions_dir: Path,
    stl_path: Path,
    workdir: Path,
    timeout: int = 120,
) -> ValidationResult:
    workdir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(curaprofile_zip)) as archive:
        container_text = archive.read(archive.namelist()[0]).decode("utf-8")

    parser = configparser.ConfigParser(interpolation=None)
    parser.optionxform = str  # type: ignore[assignment]
    parser.read_string(container_text)
    overrides: dict[str, str] = dict(parser["values"]) if parser.has_section("values") else {}

    printer_defaults = _collect_defaults(
        json.loads((definitions_dir / "fdmprinter.def.json").read_text(encoding="utf-8"))
    )
    extruder_defaults = _collect_defaults(
        json.loads((definitions_dir / "fdmextruder.def.json").read_text(encoding="utf-8"))
    )
    printer_defaults.update(overrides)
    extruder_defaults.update(
        {key: value for key, value in overrides.items() if key in extruder_defaults}
    )

    out_gcode = workdir / "ci_check.gcode"
    try:
        linker = _find_system_linker()
    except FileNotFoundError as exc:
        return ValidationResult(False, str(exc))

    cmd = [
        linker,
        "--library-path",
        str(library_dir),
        str(cura_engine_bin),
        "slice",
        "-j",
        str(definitions_dir / "fdmprinter.def.json"),
        *_cura_setting_args(printer_defaults),
        "-e0",
        "-j",
        str(definitions_dir / "fdmextruder.def.json"),
        *_cura_setting_args(extruder_defaults),
        "-l",
        str(stl_path),
        "-o",
        str(out_gcode),
    ]
    result = _run(cmd, timeout=timeout)
    if result.returncode != 0 or not out_gcode.is_file() or out_gcode.stat().st_size == 0:
        return ValidationResult(
            False, f"CuraEngine slice rc={result.returncode}: {result.stderr.strip()[-800:]}"
        )
    return ValidationResult(True, f"g-code сгенерирован ({out_gcode.stat().st_size} байт)")
