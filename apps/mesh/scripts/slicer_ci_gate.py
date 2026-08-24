"""CI-гейт: реальный импорт связок принтер×филамент во все три headless-
слайсера (MF-1920, MF-413 фаза 3, последний шаг эпика MF-34).

Запуск: `uv run python scripts/slicer_ci_gate.py` в CI-джобе `python`
(`.gitverse/workflows/ci.yaml`, `matrix.app == mesh`) ПОСЛЕ шага
провижининга headless-слайсеров (MF-1918) — нужны переменные окружения
`MESH_ORCA_SLICER_BIN`/`MESH_PRUSA_SLICER_BIN`/`MESH_CURA_BIN`,
которые тот шаг уже экспортирует. Локально без слайсеров (переменные не
заданы) — гейт пропускается с понятным сообщением, тем же паттерном, что
`smoke_3mf.py::_validate_with_slicer`, не падает.

Корпус связок (реальные вендорские данные) и метод валидации каждого
слайсера (три разных CLI-пути, ни один не «просто validate») —
`mesh.slicer_ci_corpus`/`mesh.slicer_ci_validate`, подробности и известные
ограничения — в докстрингах тех модулей и
`docs/epics/slicer.profiles.md` § «CI-гейт реальным импортом».
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import trimesh  # noqa: E402

from mesh.slicer_ci_corpus import DEFAULT_VENDOR, CorpusError, build_corpus  # noqa: E402
from mesh.slicer_ci_validate import (  # noqa: E402
    ValidationResult,
    validate_cura_import,
    validate_orca_import,
    validate_prusa_import,
)
from mesh.slicer_profile_export import (  # noqa: E402
    ExportAttribution,
    build_cura_bundle,
    build_orca_bundle,
    build_prusa_bundle,
)

PRINTER_LIMIT = int(os.getenv("MESH_SLICER_CI_PRINTER_LIMIT", "50"))

_ATTRIBUTION = ExportAttribution(
    source_name="OrcaSlicer upstream vendor profiles (CI-корпус MF-1920)",
    source_url="https://github.com/SoftFever/OrcaSlicer",
    source_ref=f"resources/profiles/{DEFAULT_VENDOR}",
    license="AGPL-3.0",
    confidence=1.0,
    extrapolated=False,
    disclaimer="Связка CI-гейта реального импорта, не прод-рекомендация пользователю.",
)


def _orca_profiles_dir() -> Path | None:
    bin_path = os.getenv("MESH_ORCA_SLICER_BIN")
    if not bin_path:
        return None
    return Path(bin_path).resolve().parent / "resources" / "profiles"


def _cura_paths() -> tuple[Path, Path, Path] | None:
    bin_path = os.getenv("MESH_CURA_BIN")
    if not bin_path:
        return None
    appdir = Path(bin_path).resolve().parent
    return appdir, appdir / "CuraEngine", appdir / "share" / "cura" / "resources" / "definitions"


def _record(
    report: dict[str, list[dict[str, object]]], slicer: str, combo_id: str, result: ValidationResult
) -> int:
    report[slicer].append({"combo": combo_id, "ok": result.ok, "detail": result.detail})
    return 0 if result.ok else 1


def main() -> int:
    orca_bin = os.getenv("MESH_ORCA_SLICER_BIN")
    prusa_bin = os.getenv("MESH_PRUSA_SLICER_BIN")
    cura_paths = _cura_paths()
    profiles_dir = _orca_profiles_dir()

    if not profiles_dir or not profiles_dir.is_dir():
        print("MESH_ORCA_SLICER_BIN не задан/бандл профилей не найден — CI-гейт пропущен")
        return 0

    try:
        corpus = build_corpus(profiles_dir, printer_limit=PRINTER_LIMIT)
    except CorpusError as exc:
        print(f"не удалось построить корпус связок: {exc}", file=sys.stderr)
        return 1

    printers = {entry.printer_name for entry in corpus}
    materials = {entry.material for entry in corpus}
    print(
        f"корпус MF-1920: {len(printers)} принтеров × {len(materials)} материала "
        f"= {len(corpus)} связок"
    )

    report: dict[str, list[dict[str, object]]] = {"orcaslicer": [], "prusaslicer": [], "cura": []}
    failures = 0

    with tempfile.TemporaryDirectory(prefix="slicer-ci-gate-") as tmp:
        tmp_dir = Path(tmp)
        stl_path = tmp_dir / "probe.stl"
        trimesh.creation.box(extents=[20.0, 20.0, 20.0]).export(stl_path)

        cura_engine_ready = bool(cura_paths and cura_paths[1].is_file() and cura_paths[2].is_dir())

        for index, entry in enumerate(corpus):
            combo_id = f"{entry.printer_name} / {entry.material}"
            filament_name = f"{entry.printer_name} {entry.material}"
            workdir = tmp_dir / f"combo-{index}"

            if orca_bin:
                data, _manifest = build_orca_bundle(
                    entry.params,
                    entry.machine,
                    printer_name=entry.printer_name,
                    filament_name=filament_name,
                    attribution=_ATTRIBUTION,
                )
                result = validate_orca_import(
                    data, orca_bin=orca_bin, stl_path=stl_path, workdir=workdir / "orca"
                )
                failures += _record(report, "orcaslicer", combo_id, result)

            if prusa_bin:
                data, _manifest = build_prusa_bundle(
                    entry.params,
                    entry.machine,
                    printer_name=entry.printer_name,
                    filament_name=filament_name,
                    attribution=_ATTRIBUTION,
                )
                result = validate_prusa_import(
                    data, prusa_bin=prusa_bin, stl_path=stl_path, workdir=workdir / "prusa"
                )
                failures += _record(report, "prusaslicer", combo_id, result)

            if cura_engine_ready:
                appdir, engine, definitions = cura_paths  # type: ignore[misc]
                data, _manifest = build_cura_bundle(
                    entry.params,
                    printer_name=entry.printer_name,
                    filament_name=filament_name,
                    attribution=_ATTRIBUTION,
                )
                result = validate_cura_import(
                    data,
                    cura_engine_bin=engine,
                    library_dir=appdir,
                    definitions_dir=definitions,
                    stl_path=stl_path,
                    workdir=workdir / "cura",
                )
                failures += _record(report, "cura", combo_id, result)

        for slicer, results in report.items():
            if not results:
                print(f"{slicer}: пропущено (бинарь не сконфигурирован)")
                continue
            passed = sum(1 for item in results if item["ok"])
            print(f"{slicer}: {passed}/{len(results)} связок прошли реальный импорт")
            for item in results:
                if not item["ok"]:
                    print(f"  FAIL {item['combo']}: {item['detail']}")

        report_path = os.getenv("MESH_SLICER_CI_REPORT_PATH")
        if report_path:
            Path(report_path).write_text(
                json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
            )

    if failures:
        print(f"\nCI-гейт красный: {failures} связок не прошли реальный импорт", file=sys.stderr)
        return 1
    print("\nCI-гейт зелёный: все связки прошли реальный импорт")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
