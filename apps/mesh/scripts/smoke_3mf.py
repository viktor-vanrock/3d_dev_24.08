"""Смоук-тест тулчейна (MF-378): STL → 3MF → чтение обратно.

Проверяет, что весь стек (trimesh + lib3mf + numpy + manifold3d) реально
устанавливается и работает вместе в текущем venv — не юнит-тест (тот же
путь покрыт `tests/test_convert.py`), а быстрая ручная/CI-проверка
тулчейна после апгрейда версий. Запуск: `uv run python scripts/smoke_3mf.py`.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import lib3mf  # noqa: E402
import manifold3d  # noqa: E402, F401 — присутствие в тулчейне для Фазы 2 (repair), сам смоук его пока не вызывает
import numpy  # noqa: E402
import trimesh  # noqa: E402

from mesh.convert import convert_to_3mf, validate_3mf  # noqa: E402


def _validate_with_slicer(env_name: str, output: Path) -> None:
    binary = os.getenv(env_name)
    if not binary:
        print(f"{env_name} не задан — внешний headless smoke пропущен")
        return
    completed = subprocess.run(
        [binary, "--info", str(output)],
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    print(f"{env_name}: exit={completed.returncode}")
    if completed.stdout:
        print(completed.stdout.strip())
    if completed.stderr:
        print(completed.stderr.strip(), file=sys.stderr)
    if completed.returncode != 0:
        raise RuntimeError(f"{env_name} не принял 3MF (код {completed.returncode})")


def main() -> None:
    print(f"trimesh   {trimesh.__version__}")
    print(f"numpy     {numpy.__version__}")
    print(f"lib3mf    (wrapper import ok, {lib3mf.Wrapper().GetLibraryVersion()})")
    print(f"manifold3d (import ok: {manifold3d.__name__})")

    with tempfile.TemporaryDirectory(prefix="mesh-smoke-") as tmp:
        tmp_dir = Path(tmp)
        stl_path = tmp_dir / "box.stl"
        out_path = tmp_dir / "box.3mf"

        box = trimesh.creation.box(extents=[10.0, 20.0, 30.0])
        box.export(stl_path)
        print(f"STL записан: {stl_path} ({stl_path.stat().st_size} байт)")

        result = convert_to_3mf(stl_path, out_path)
        print(f"3MF записан: {result.path} bbox={result.bbox}")

        validate_3mf(result.path)
        reloaded = trimesh.load(result.path, force="mesh")
        print(f"3MF прочитан обратно: {reloaded.faces.shape[0]} треугольников")
        _validate_with_slicer("MESH_PRUSA_SLICER_BIN", result.path)
        _validate_with_slicer("MESH_ORCA_SLICER_BIN", result.path)

    print("СМОУК OK")


if __name__ == "__main__":
    main()
