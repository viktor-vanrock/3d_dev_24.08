"""`raw` → `machines.specs` (тот же целевой shape, что уже пишет
`apps/api/scripts/import-machines-bootstrap.ts`: `build_volume {x,y,z,shape}`,
`nozzle_diameters`, `kinematics` — сохраняем совместимость полей, а не изобретаем
параллельный формат для той же колонки).

Два независимых пути извлечения build_volume:
- `raw["specs"]` уже структурирован (`cura-definitions`/`sovol3d-store` на dev
  отдают его готовым) — пропускаем через тот же whitelist ключей, не доверяем
  остальным полям источника вслепую.
- `slicer_profile` (Orca/Prusa) кладёт геометрию плоско: `printable_area` +
  `printable_height` либо `bed_shape` + `max_print_height` — тот же формат
  точек ("XxY", список или CSV-строка), что и `parsePoints` в
  `import-machines-bootstrap.ts`, разбираем тем же bounding-box способом,
  чтобы дать тот же content_hash-вход, что и бутстрап-импорт (см. `hashing.py`).

`vendor_whitelist`-кандидаты (schema.org Product с оф. страницы) специфики не
несут вовсе — `extract_specs` для них возвращает `{}`, что закономерно проваливает
`is_plausible_specs` (см. `matching.plausibility_score`) — без объёма печати
включать в канон нечего, тот же плаузибилити-барьер, что `isPlausible` в TS.
"""

from __future__ import annotations

import re
from typing import Any

_POINT_RE = re.compile(r"^\s*(-?[\d.]+)\s*x\s*(-?[\d.]+)\s*$", re.IGNORECASE)


def parse_points(value: list[str] | str | None) -> tuple[float, float] | None:
    if not value:
        return None
    points = value if isinstance(value, list) else str(value).split(",")
    xs: list[float] = []
    ys: list[float] = []
    for point in points:
        match = _POINT_RE.match(str(point))
        if match is None:
            continue
        xs.append(float(match.group(1)))
        ys.append(float(match.group(2)))
    if len(xs) < 2 or len(ys) < 2:
        return None
    return max(xs) - min(xs), max(ys) - min(ys)


def _numbers(value: Any) -> list[float]:
    if value is None:
        return []
    items = value if isinstance(value, list) else [value]
    out = []
    for item in items:
        try:
            out.append(float(item))
        except (TypeError, ValueError):
            continue
    return out


def _from_structured(raw_specs: dict) -> dict:
    specs: dict[str, Any] = {}
    bv = raw_specs.get("build_volume")
    if isinstance(bv, dict) and all(k in bv for k in ("x", "y", "z")):
        try:
            specs["build_volume"] = {
                "x": float(bv["x"]),
                "y": float(bv["y"]),
                "z": float(bv["z"]),
                "shape": bv.get("shape", "rectangular"),
            }
        except (TypeError, ValueError):
            pass
    kinematics = raw_specs.get("kinematics")
    if kinematics:
        specs["kinematics"] = str(kinematics)
    nozzles = _numbers(raw_specs.get("nozzle_diameters"))
    if nozzles:
        specs["nozzle_diameters"] = sorted(nozzles)
    return specs


def _from_slicer_fields(raw: dict) -> dict:
    specs: dict[str, Any] = {}
    area = None
    z: float | None = None
    if raw.get("printable_area"):
        area = parse_points(raw.get("printable_area"))
        z = _numbers(raw.get("printable_height"))[:1][0] if raw.get("printable_height") else None
    elif raw.get("bed_shape"):
        area = parse_points(raw.get("bed_shape"))
        z = _numbers(raw.get("max_print_height"))[:1][0] if raw.get("max_print_height") else None
    if area is not None and z is not None:
        specs["build_volume"] = {"x": area[0], "y": area[1], "z": z, "shape": "rectangular"}

    nozzles = sorted(_numbers(raw.get("nozzle_diameter_mm")))
    if nozzles:
        specs["nozzle_diameters"] = nozzles
    return specs


def extract_specs(raw: dict) -> dict:
    """`machines.specs`-кандидат: структурный shape приоритетнее плоских
    slicer-полей (богаче/уже нормализован источником), не объединяем два пути —
    смешение двух разных единиц/систем координат на одну запись рискованнее,
    чем взять то, что источник дал целиком."""
    raw_specs = raw.get("specs")
    if isinstance(raw_specs, dict):
        specs = _from_structured(raw_specs)
        if specs:
            return specs
    specs = _from_slicer_fields(raw)
    machine_tech = raw.get("machine_tech")
    if machine_tech:
        specs["machine_tech"] = str(machine_tech)
    return specs


def is_plausible_specs(specs: dict) -> bool:
    """Тот же барьер, что `isPlausible` в `import-machines-bootstrap.ts`:
    вменяемый build_volume — 0 < x,y,z ≤ 2000мм. Без него запись не годится в
    канон целиком (не quarantine — разбирать нечего, см. модульный докстринг)."""
    bv = specs.get("build_volume")
    if not isinstance(bv, dict):
        return False
    try:
        x, y, z = float(bv["x"]), float(bv["y"]), float(bv["z"])
    except (KeyError, TypeError, ValueError):
        return False
    return all(0 < v <= 2000 for v in (x, y, z))


def derive_kind(specs: dict) -> str:
    tech = str(specs.get("machine_tech", "")).strip().upper()
    if tech in {"SLA", "MSLA", "DLP", "RESIN"}:
        return "sla_printer"
    return "fdm_printer"
