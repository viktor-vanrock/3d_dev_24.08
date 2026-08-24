"""Экспорт unified slicer-профиля (MF-411, `docs/epics/slicer.profiles.md`) в
нативные bundle-файлы OrcaSlicer/PrusaSlicer/Cura (MF-413, фаза 3 эпика MF-34,
шаг «Экспорт в нативные форматы»).

Вход — тот же плоский словарь unified-ключей, что отдаёт резолвер MF-412
(`GET /slicer-profiles/:printerId/:filamentId`, `apps/api/src/slicerProfiles/
matcher.ts::Recommendation.params`) плюс отдельно словарь machine-геометрии
принтера (каталог `machines`, MF-32) — резолвер НЕ кладёт build_volume/
nozzle_diameter в `params`, когда база подбора — process-профиль (см. открытый
архитектурный разрыв ниже), поэтому геометрию экспортёр берёт отдельным
аргументом, а не из `Recommendation.params`.

Мэппинг unified→нативный ключ для process/filament классов Orca и Prusa —
НЕ угадан: это те же самые пары `(native_key, unified_path)`, что уже
использует и тестирует `apps/scout/src/scout/sources/slicer_print_profiles*.py`
(парсер в обратную сторону, вросший в `dev` на реальных вендорских данных,
MF-411 шаг 2/3) — здесь они просто инвертированы. Дублирование таблиц (не
импорт из `apps/scout`) — сознательно: `apps/mesh` и `apps/scout` разные
приложения монорепо с разными границами владения, шарить код между ними —
не территория этой карточки.

Формат-энвелоуп (какие top-level поля несёт нативный JSON/INI, как называется
zip-контейнер) для Orca/Prusa проверен по реальным файлам апстрима
(`SoftFever/OrcaSlicer`/`prusa3d/PrusaSlicer-settings`, те же репозитории,
что уже фетчит scout) — не по догадке. Формат Cura (`.curaprofile` — zip
`UM.Settings.InstanceContainer.serialize()`, секции `[general]`/`[metadata]`/
`[values]`) проверен по исходнику `Ultimaker/Uranium`; НАБОР ключей `[values]`
для Cura взят из `resources/definitions/fdmprinter.def.json` там, где это
удалось подтвердить фетчем, и из устоявшейся публичной документации Cura там,
где нет — см. `_CURA_FIELDS` ниже, отдельно помечено что не пере-проверено
байт-в-байт в этом прогоне. `setting_version` Cura (внутренний номер ревизии
формата настроек) — ЗАГЛУШКА (`CURA_SETTING_VERSION_PLACEHOLDER`), не найден
в открытых источниках без доступа к живому Cura — калибровка нужна перед CI-
валидацией реальным импортом (MF-413, шаг 2 фазы 3, ещё не эта карточка).

Machine-класс (геометрия принтера → нативный формат) покрывает ТОЛЬКО поля,
для которых нашёлся подтверждённый нативный ключ (printable_area/
printable_height/nozzle_diameter — Orca; bed_shape/max_print_height/
nozzle_diameter — Prusa). `kinematics`/`max_nozzle_temp_c`/`max_bed_temp_c`/
`has_heated_chamber`/`extruder_type`/`gcode_flavor` (кроме дефолта) сознательно
НЕ экспортируются — нет подтверждённого 1:1 нативного ключа, гадать формат
запрещено принципами зоны Mesh (см. CLAUDE.md). Cura-экспортёр machine-класс
не пишет вообще (нужен отдельный контейнер `definition_changes`, не
`quality_changes` — вне бюджета этого шага, задокументировано как открытый
вопрос).
"""

from __future__ import annotations

import configparser
import io
import json
import zipfile
from dataclasses import dataclass
from typing import Any

CURA_SETTING_VERSION_PLACEHOLDER = 25


class ProfileExportError(Exception):
    """Входные данные недостаточны для генерации синтаксически валидного bundle."""


@dataclass(frozen=True)
class ExportAttribution:
    """Провенанс — зеркалит `explanation`/`profile` контракта
    `slicer.profile-recommendation.v1` (`docs/contracts/slicer.profile-recommendation.v1.md`).
    Не пишется внутрь нативных файлов (риск, что незнакомое поле сломает
    парсер целевого слайсера, не подтверждён ни для одного из трёх форматов) —
    только в `manifest`, который вызывающий код хранит рядом с bundle
    (S3-метаданные/БД), не внутри архива.
    """

    source_name: str
    source_url: str | None
    source_ref: str | None
    license: str
    confidence: float
    extrapolated: bool
    disclaimer: str


def _get_nested(params: dict[str, Any], path: str) -> Any:
    node: Any = params
    for part in path.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node


def _fmt(value: Any) -> str:
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _require_geometry(machine: dict[str, Any]) -> tuple[float, float, float, float]:
    x = _get_nested(machine, "build_volume_mm.x")
    y = _get_nested(machine, "build_volume_mm.y")
    z = _get_nested(machine, "build_volume_mm.z")
    nozzle = _get_nested(machine, "nozzle_diameter_mm")
    missing = [
        name
        for name, value in (
            ("build_volume_mm.x", x),
            ("build_volume_mm.y", y),
            ("build_volume_mm.z", z),
            ("nozzle_diameter_mm", nozzle),
        )
        if value is None
    ]
    if missing:
        raise ProfileExportError(
            "недостаточно геометрии принтера для экспорта machine-класса, "
            f"нет: {', '.join(missing)}"
        )
    return float(x), float(y), float(z), float(nozzle)


def _require_params(params: dict[str, Any]) -> None:
    if not params:
        raise ProfileExportError("unified params пуст — экспортировать нечего")


def _manifest(
    attribution: ExportAttribution, *, slicer: str, bundle_filename: str
) -> dict[str, Any]:
    return {
        "slicer": slicer,
        "bundle_filename": bundle_filename,
        "generated_by": "3mf.tech slicer-profile exporter (MF-413)",
        "attribution": {
            "source_name": attribution.source_name,
            "source_url": attribution.source_url,
            "source_ref": attribution.source_ref,
            "license": attribution.license,
            "confidence": attribution.confidence,
            "extrapolated": attribution.extrapolated,
            "disclaimer": attribution.disclaimer,
        },
    }


# --- OrcaSlicer --------------------------------------------------------------
#
# Native-ключи process/filament — инверсия `_PROCESS_RULES`/`_FILAMENT_RULES`
# из `apps/scout/src/scout/sources/slicer_print_profiles.py`. Envelope-поля
# (type/name/from/instantiation/setting_id/printer_settings_id/
# print_settings_id/filament_id) и формат printable_area ("XxY" corners),
# printable_height (строка), nozzle_diameter (массив строк) — проверены по
# реальному файлу `SoftFever/OrcaSlicer` `resources/profiles/Creality/machine/
# Creality Ender-3 0.4 nozzle.json` + `.../filament/Creality Generic PLA.json`
# + `.../process/0.20mm Standard @Creality Ender3.json`.
#
# `compatible_printers`/`inherits` (MF-1919) — линковка process/filament →
# printer. Формат ключа `compatible_printers` (массив строк) подтверждён
# реальным вендорским фикстуром `apps/scout/tests/fixtures/
# orca_filament_generic_pla.json` (`"compatible_printers": ["Creality
# Ender-3 V2 0.4 nozzle"]`) и исходником `OrcaSlicer/OrcaSlicer`
# `src/libslic3r/PresetBundle.cpp` (тот же ключ читается из
# `print_config`/`filament_config`, не только filament).
#
# НО простого совпадения `compatible_printers` со top-level `name` printer-
# пресета недостаточно для headless CLI (`--load-settings`) — это
# перепроверено живым прогоном `orca-slicer` v2.4.2 в этой карточке (не по
# докстрингу PresetBundle.cpp, там это не написано явно): CLI резолвит
# printer-пресет в СИСТЕМНЫЙ (по `setting_id`, известному из его же
# встроенного каталога вендоров) и сравнивает `compatible_printers` именно
# с РЕЗОЛВНУТЫМ predecessor'ом (`"inherited from"` в debug-логе), а не с
# `name` как таковым. Для `"from": "user"`-пресета без известного
# `setting_id` (наш случай — принтер каталога mesh, которого нет среди
# ~133 вендоров, зашитых в конкретный билд Orca) `"inherited from"`
# резолвится в СЫРОЕ значение поля `inherits` printer-пресета — и остаётся
# пустым, если `inherits` не задан (что и давало `process not compatible
# with printer`, return -17, при живом импорте в MF-1918).
#
# Фикс: printer-пресет получает `inherits` — синтетический якорь связки
# (не настоящий вендорский id, гадать который для произвольного принтера
# каталога mesh запрещено — принцип зоны), под which нет цикла (не
# self-reference на собственный `name`, отдельная строка). process/
# filament ссылаются на этот же якорь через `compatible_printers`. Живой
# прогон headless `orca-slicer` (`--load-settings "printer.json;
# process.json" --load-filaments filament.json --export-3mf ... /tmp/
# cube.stl`) с такой связкой даёт `compatible 1`, `exit=0`, реальный
# `.3mf` с сохранённым process/filament — проверено в этой карточке на
# CI-провижининном v2.4.2 (тот же бинарь, что MF-1918), не только
# структурной валидацией. `compatible_printers_condition` не пишем — не
# нужен, когда список задан явно.
#
# ДОБАВЛЕНО (MF-1920, CI-гейт реальным импортом ≥50×3 связок): якорь-only
# `compatible_printers` регрессирует реальный GUI-импорт — `is_compatible_
# with_printer` (`src/libslic3r/Preset.cpp`, установлено ПЕРВЫМ прогоном
# MF-1919 выше) сравнивает `compatible_printers` с ИМЕНЕМ printer-пресета
# (`printer.name`), а не с `inherits`; после замены на якорь список
# перестал содержать `printer_name`, значит реальный GUI больше не считал
# бы process/filament совместимыми с этим принтером. Живым прогоном
# подтверждено: `compatible_printers = [printer_name, якорь]` (ОБА значения,
# массив — не единственная строка) даёт headless `compatible 1` (CLI матчит
# по якорю) И одновременно сохраняет byte-в-byte совпадение с `printer.name`
# для GUI-пути — обе проверки читают один и тот же список независимо, порядок
# элементов не имеет значения ни для одной из них.

_ORCA_PROCESS_FIELDS: tuple[tuple[str, str], ...] = (
    ("layer_height_mm", "layer_height"),
    ("first_layer_height_mm", "initial_layer_print_height"),
    ("print_speed_mm_s", "outer_wall_speed"),
    ("first_layer_speed_mm_s", "initial_layer_speed"),
    ("travel_speed_mm_s", "travel_speed"),
    ("infill_density_pct", "sparse_infill_density"),
    ("infill_pattern", "sparse_infill_pattern"),
    ("wall_loops", "wall_loops"),
    ("top_shell_layers", "top_shell_layers"),
    ("bottom_shell_layers", "bottom_shell_layers"),
    ("support_enable", "enable_support"),
    ("support_type", "support_type"),
    ("skirt_loops", "skirt_loops"),
    ("brim_width_mm", "brim_width"),
)

_ORCA_FILAMENT_FIELDS: tuple[tuple[str, str], ...] = (
    ("nozzle_temperature_c.other", "nozzle_temperature"),
    ("nozzle_temperature_c.first_layer", "nozzle_temperature_initial_layer"),
    ("bed_temperature_c.other", "hot_plate_temp"),
    ("bed_temperature_c.first_layer", "hot_plate_temp_initial_layer"),
    ("max_volumetric_speed_mm3_s", "filament_max_volumetric_speed"),
    ("flow_ratio", "filament_flow_ratio"),
    ("retraction_length_mm", "filament_retraction_length"),
    ("retraction_speed_mm_s", "filament_retraction_speed"),
    ("z_hop_mm", "filament_z_hop"),
    ("density_g_cm3", "filament_density"),
    ("diameter_mm", "filament_diameter"),
    ("cost_per_kg", "filament_cost"),
    ("cooling_fan_speed_pct.min", "fan_min_speed"),
    ("cooling_fan_speed_pct.max", "fan_max_speed"),
)

# Проценты у Orca пишутся с суффиксом "%" (подтверждено реальным файлом —
# `sparse_infill_density: "15%"`); только для полей, чьё unified-имя
# однозначно фиксирует "это проценты" (*_pct) — остальные не дополняются
# наугад (см. докстринг файла § first_layer_speed_mm_s).
_ORCA_PERCENT_NATIVE_KEYS = frozenset({"sparse_infill_density"})


def _orca_compat_link_id(printer_name: str) -> str:
    """Синтетический якорь compatible-linkage (см. секцию выше) — детерминирован
    от `printer_name`, не настоящий вендорский system-id (гадать который для
    произвольного принтера каталога mesh запрещено принципами зоны)."""
    return f"3mf.tech printer link — {printer_name}"


def _orca_compatible_printers(printer_name: str) -> list[str]:
    """`compatible_printers` для process/filament — ОБА значения (см.
    докстринг секции § «ДОБАВЛЕНО MF-1920»): `printer_name` — для реального
    GUI-импорта (`is_compatible_with_printer` сравнивает по имени),
    синтетический якорь — для headless CLI (сравнивает по резолвнутому
    `inherits`)."""
    return [printer_name, _orca_compat_link_id(printer_name)]


def _orca_machine_json(machine: dict[str, Any], *, name: str) -> dict[str, Any]:
    x, y, z, nozzle = _require_geometry(machine)
    doc: dict[str, Any] = {
        "type": "machine",
        "name": name,
        "inherits": _orca_compat_link_id(name),
        "from": "user",
        "instantiation": "true",
        "setting_id": "",
        "printer_settings_id": "",
        "printable_area": ["0x0", f"{_fmt(x)}x0", f"{_fmt(x)}x{_fmt(y)}", f"0x{_fmt(y)}"],
        "printable_height": _fmt(z),
        "nozzle_diameter": [_fmt(nozzle)],
    }
    gcode_flavor = _get_nested(machine, "gcode_flavor")
    doc["gcode_flavor"] = (
        gcode_flavor if isinstance(gcode_flavor, str) and gcode_flavor else "marlin"
    )
    return doc


def _orca_process_json(params: dict[str, Any], *, name: str, printer_name: str) -> dict[str, Any]:
    doc: dict[str, Any] = {
        "type": "process",
        "name": name,
        "from": "user",
        "instantiation": "true",
        "setting_id": "",
        "print_settings_id": "",
        "compatible_printers": _orca_compatible_printers(printer_name),
    }
    for unified_path, native_key in _ORCA_PROCESS_FIELDS:
        value = _get_nested(params, unified_path)
        if value is None:
            continue
        text = _fmt(value)
        doc[native_key] = f"{text}%" if native_key in _ORCA_PERCENT_NATIVE_KEYS else text
    return doc


def _orca_filament_json(params: dict[str, Any], *, name: str, printer_name: str) -> dict[str, Any]:
    doc: dict[str, Any] = {
        "type": "filament",
        "name": name,
        "from": "user",
        "instantiation": "true",
        "setting_id": "",
        "filament_id": "",
        "compatible_printers": _orca_compatible_printers(printer_name),
    }
    for unified_path, native_key in _ORCA_FILAMENT_FIELDS:
        value = _get_nested(params, unified_path)
        if value is None:
            continue
        doc[native_key] = [_fmt(value)]
    return doc


def build_orca_bundle(
    params: dict[str, Any],
    machine: dict[str, Any],
    *,
    printer_name: str,
    filament_name: str,
    attribution: ExportAttribution,
) -> tuple[bytes, dict[str, Any]]:
    """`.orca_printer` bundle: zip из `printer.json`/`process.json`/
    `filament.json` (три отдельных preset-файла, каждый — валидный
    самостоятельный Orca user-preset — тот же документ, что Orca пишет в
    `user/<id>/{printer,process,filament}/<name>.json`; отдельные `.zip` под
    один класс, если вызывающему нужен не полный "entire printer setup",
    получаются тем же путём — взять один из трёх `writestr`).
    """
    _require_params(params)
    machine_doc = _orca_machine_json(machine, name=printer_name)
    process_doc = _orca_process_json(
        params, name=f"3mf.tech — {printer_name}", printer_name=printer_name
    )
    filament_doc = _orca_filament_json(
        params, name=f"3mf.tech — {filament_name}", printer_name=printer_name
    )

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("printer.json", json.dumps(machine_doc, ensure_ascii=False, indent=2))
        archive.writestr("process.json", json.dumps(process_doc, ensure_ascii=False, indent=2))
        archive.writestr("filament.json", json.dumps(filament_doc, ensure_ascii=False, indent=2))

    manifest = _manifest(
        attribution, slicer="orcaslicer", bundle_filename=f"{printer_name}.orca_printer"
    )
    return buffer.getvalue(), manifest


# --- PrusaSlicer ---------------------------------------------------------
#
# Native-ключи — инверсия `_PROCESS_RULES`/`_FILAMENT_RULES` из
# `apps/scout/src/scout/sources/slicer_print_profiles_prusa.py`. Секции
# `[print:Name]`/`[filament:Name]`/`[printer:Name]` + заголовок `[presets]` —
# формат config-бандла PrusaSlicer (отличается от однопрофильного
# `[print]`/`[filament]`/`[printer]` без имени, который использует
# `slicer_engine.py::resolve_prusa_ini` для headless-слайсинга одной
# activной связки — два разных сценария одного и того же INI-семейства).
# `bed_shape`/`max_print_height` — подтверждённые нативные ключи секции
# `[printer:...]` (см. `apps/scout/.../slicer_profiles.py::build_prusa_candidate`,
# читает их из реального вендорского бандла PrusaResearch).

_PRUSA_PROCESS_FIELDS: tuple[tuple[str, str], ...] = (
    ("layer_height_mm", "layer_height"),
    ("first_layer_height_mm", "first_layer_height"),
    ("print_speed_mm_s", "external_perimeter_speed"),
    ("first_layer_speed_mm_s", "first_layer_speed"),
    ("travel_speed_mm_s", "travel_speed"),
    ("infill_density_pct", "fill_density"),
    ("infill_pattern", "fill_pattern"),
    ("wall_loops", "perimeters"),
    ("top_shell_layers", "top_solid_layers"),
    ("bottom_shell_layers", "bottom_solid_layers"),
    ("support_enable", "support_material"),
    ("support_type", "support_material_pattern"),
    ("skirt_loops", "skirts"),
    ("brim_width_mm", "brim_width"),
)

_PRUSA_FILAMENT_FIELDS: tuple[tuple[str, str], ...] = (
    ("nozzle_temperature_c.other", "temperature"),
    ("nozzle_temperature_c.first_layer", "first_layer_temperature"),
    ("bed_temperature_c.other", "bed_temperature"),
    ("bed_temperature_c.first_layer", "first_layer_bed_temperature"),
    ("max_volumetric_speed_mm3_s", "filament_max_volumetric_speed"),
    ("flow_ratio", "extrusion_multiplier"),
    ("density_g_cm3", "filament_density"),
    ("diameter_mm", "filament_diameter"),
    ("cost_per_kg", "filament_cost"),
)

_PRUSA_PERCENT_NATIVE_KEYS = frozenset({"fill_density"})


def _prusa_section_values(
    params: dict[str, Any], fields: tuple[tuple[str, str], ...], *, percent_keys: frozenset[str]
) -> dict[str, str]:
    values: dict[str, str] = {}
    for unified_path, native_key in fields:
        value = _get_nested(params, unified_path)
        if value is None:
            continue
        text = _fmt(value)
        values[native_key] = f"{text}%" if native_key in percent_keys else text
    return values


def build_prusa_bundle(
    params: dict[str, Any],
    machine: dict[str, Any],
    *,
    printer_name: str,
    filament_name: str,
    attribution: ExportAttribution,
) -> tuple[bytes, dict[str, Any]]:
    """PrusaSlicer `.ini` config-бандл — множество именованных секций в одном
    файле, импортируется целиком через File → Import → Import Config Bundle.
    """
    _require_params(params)
    x, y, _z, nozzle = _require_geometry(machine)
    max_print_height = _get_nested(machine, "build_volume_mm.z")

    process_name = f"3mf.tech - {printer_name}"
    filament_full_name = f"3mf.tech - {filament_name}"

    process_values = _prusa_section_values(
        params, _PRUSA_PROCESS_FIELDS, percent_keys=_PRUSA_PERCENT_NATIVE_KEYS
    )
    filament_values = _prusa_section_values(
        params, _PRUSA_FILAMENT_FIELDS, percent_keys=frozenset()
    )
    printer_values = {
        "bed_shape": f"0x0,{_fmt(x)}x0,{_fmt(x)}x{_fmt(y)},0x{_fmt(y)}",
        "max_print_height": _fmt(max_print_height),
        "nozzle_diameter": _fmt(nozzle),
    }

    parser = configparser.ConfigParser(interpolation=None)
    parser.optionxform = str  # type: ignore[assignment] — сохранить регистр нативных ключей
    parser[f"print:{process_name}"] = process_values
    parser[f"filament:{filament_full_name}"] = filament_values
    parser[f"printer:{printer_name}"] = printer_values
    parser["presets"] = {
        "print": process_name,
        "filament": filament_full_name,
        "printer": printer_name,
    }

    buf = io.StringIO()
    parser.write(buf, space_around_delimiters=True)
    manifest = _manifest(attribution, slicer="prusaslicer", bundle_filename=f"{printer_name}.ini")
    return buf.getvalue().encode("utf-8"), manifest


# --- Cura ------------------------------------------------------------------
#
# `.curaprofile` — zip, один entry на контейнер, содержимое —
# `UM.Settings.InstanceContainer.serialize()`: ConfigParser с секциями
# `[general]` (version/name/definition), `[metadata]` (произвольные пары,
# здесь только type/quality_type/setting_version), `[values]` (key = value,
# `str(python_value)` — булевы как "True"/"False", не "1"/"0", в отличие от
# Orca/Prusa). Формат подтверждён по исходнику `Ultimaker/Uranium`
# `UM/Settings/InstanceContainer.py::serialize()` и
# `Ultimaker/Cura` `plugins/CuraProfileWriter/CuraProfileWriter.py`
# (zipfile, entry name = container id, содержимое = `container.serialize()`).
#
# Мы пишем ОДИН `quality_changes`-контейнер (не три раздельных, как у Orca/
# Prusa) — в Cura любой setting id, независимо от "категории" (print/
# material/machine), может быть переопределён в `quality_changes`; это
# штатный путь, которым Cura хранит пользовательские правки поверх
# quality/material/variant-стека, а не обход схемы.
#
# `definition = "fdmprinter"` (не id конкретного принтера) — сознательно:
# `slicer_profiles`/`machine_candidates` пока не несут native Cura machine-id
# для произвольного принтера каталога (см. «Не сделано» в
# `docs/epics/slicer.profiles.md` § «Систематическая доливка machine-класса»),
# `fdmprinter` — универсальный base-definition, который Cura принимает для
# любой машины (профиль на конкретный принтер не привязан, что честно
# отражает реальное отсутствие machine-специфичных данных на входе).
#
# `quality_type` — заглушка `"normal"` (общее имя тира качества, часто
# встречается в реальных Cura-профилях, но НЕ подтверждено, что оно
# существует у произвольного целевого принтера) и `setting_version` —
# заглушка `CURA_SETTING_VERSION_PLACEHOLDER`: оба требуют калибровки против
# конкретной версии Cura, которую CI (шаг 2 фазы 3, ещё не сделан) будет
# реально импортировать — см. докстринг модуля.
#
# Ключи `[values]`: machine_width/machine_depth/machine_height/
# machine_nozzle_size/layer_height/layer_height_0/wall_line_count/
# top_layers/bottom_layers/material_diameter подтверждены фетчем
# `resources/definitions/fdmprinter.def.json`. Остальные (speed_*/infill_*/
# support_enable/skirt_line_count/brim_width/material_*_temperature*/
# material_flow/retraction_*/cool_fan_speed_*/material_maximum_volumetric_speed)
# — устоявшиеся, годами стабильные публичные Cura setting id (растущий из
# многих источников community-документации), НЕ пере-проверены байт-в-байт
# по исходнику в этом прогоне (файл `fdmprinter.def.json` слишком велик для
# надёжного полнотекстового fetch в этой сессии) — риск отмечен явно, снимать
# его — часть CI-шага с живым Cura.

_CURA_FIELDS: tuple[tuple[str, str], ...] = (
    ("layer_height_mm", "layer_height"),
    ("first_layer_height_mm", "layer_height_0"),
    ("print_speed_mm_s", "speed_print"),
    ("first_layer_speed_mm_s", "speed_layer_0"),
    ("travel_speed_mm_s", "speed_travel"),
    ("infill_density_pct", "infill_sparse_density"),
    ("infill_pattern", "infill_pattern"),
    ("wall_loops", "wall_line_count"),
    ("top_shell_layers", "top_layers"),
    ("bottom_shell_layers", "bottom_layers"),
    ("support_enable", "support_enable"),
    ("skirt_loops", "skirt_line_count"),
    ("brim_width_mm", "brim_width"),
    ("nozzle_temperature_c.other", "material_print_temperature"),
    ("nozzle_temperature_c.first_layer", "material_print_temperature_layer_0"),
    ("bed_temperature_c.other", "material_bed_temperature"),
    ("bed_temperature_c.first_layer", "material_bed_temperature_layer_0"),
    ("flow_ratio", "material_flow"),
    ("retraction_length_mm", "retraction_amount"),
    ("retraction_speed_mm_s", "retraction_speed"),
    ("z_hop_mm", "retraction_hop"),
    ("diameter_mm", "material_diameter"),
    ("cooling_fan_speed_pct.min", "cool_fan_speed_min"),
    ("cooling_fan_speed_pct.max", "cool_fan_speed_max"),
    ("max_volumetric_speed_mm3_s", "material_maximum_volumetric_speed"),
)


def _cura_fmt(value: Any) -> str:
    if isinstance(value, bool):
        return "True" if value else "False"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _cura_container_id(printer_name: str, filament_name: str) -> str:
    slug = "-".join(f"{printer_name}-{filament_name}".lower().split())
    return f"3mf-tech-{slug}"


def build_cura_bundle(
    params: dict[str, Any],
    *,
    printer_name: str,
    filament_name: str,
    attribution: ExportAttribution,
    setting_version: int = CURA_SETTING_VERSION_PLACEHOLDER,
) -> tuple[bytes, dict[str, Any]]:
    """`.curaprofile` — zip с одним `quality_changes`-контейнером (print +
    material настройки вместе, см. докстринг секции выше). Machine-геометрия
    сознательно не экспортируется (нужен отдельный `definition_changes`
    контейнер, не эта функция).
    """
    _require_params(params)
    values: dict[str, str] = {}
    for unified_path, native_key in _CURA_FIELDS:
        value = _get_nested(params, unified_path)
        if value is None:
            continue
        values[native_key] = _cura_fmt(value)
    if not values:
        raise ProfileExportError(
            "ни одно unified-поле не покрыто словарём Cura — экспортировать нечего"
        )

    container_id = _cura_container_id(printer_name, filament_name)
    parser = configparser.ConfigParser(interpolation=None)
    parser.optionxform = str  # type: ignore[assignment]
    parser["general"] = {
        "version": "4",
        "name": f"3mf.tech — {printer_name} / {filament_name}",
        "definition": "fdmprinter",
    }
    parser["metadata"] = {
        "type": "quality_changes",
        "quality_type": "normal",
        "setting_version": str(setting_version),
    }
    parser["values"] = values

    text_buf = io.StringIO()
    parser.write(text_buf)

    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(container_id, text_buf.getvalue())

    manifest = _manifest(
        attribution, slicer="cura", bundle_filename=f"{printer_name}-{filament_name}.curaprofile"
    )
    manifest["setting_version_placeholder"] = setting_version
    return zip_buf.getvalue(), manifest
