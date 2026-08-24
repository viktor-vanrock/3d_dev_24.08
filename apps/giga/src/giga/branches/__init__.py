"""Реестр веток генерации: branch (openscad/kzd/hueforge/trellis/concepts/scan) → executor.

Фаза 2 (MF-352): реальные ветки (рендер OpenSCAD, генерация изображения через
GigaChat, HueForge-квантование); интерфейс
`(GenerationJob, ProgressReporter) -> GenerationResult` (base.py) остаётся тем
же, что был у плейсхолдера Фазы 1. `trellis` (MF-2001) добавлена тем же
контрактом плюс реальный прогресс — см. `base.py::ProgressReporter`.
"""

from __future__ import annotations

from collections.abc import Callable

from .base import GenerationError, GenerationJob, GenerationResult, ProgressReporter
from .concepts import run_concepts
from .hueforge import run_hueforge
from .kzd import run_kzd
from .openscad import run_openscad
from .scan import run_scan
from .trellis import run_trellis

BRANCHES: dict[str, Callable[[GenerationJob, ProgressReporter], GenerationResult]] = {
    "openscad": run_openscad,
    "kzd": run_kzd,
    "hueforge": run_hueforge,
    "trellis": run_trellis,
    "concepts": run_concepts,
    # scan — единственная ветка, которая ничего не придумывает: она измеряет форму
    # настоящего предмета по десяткам его фотографий (MF-2075).
    "scan": run_scan,
}


def get_executor(branch: str) -> Callable[[GenerationJob, ProgressReporter], GenerationResult]:
    return BRANCHES[branch]


__all__ = [
    "BRANCHES",
    "GenerationError",
    "GenerationJob",
    "GenerationResult",
    "ProgressReporter",
    "get_executor",
]
