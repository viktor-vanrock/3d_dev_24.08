"""Экспорт-деривативы для скачивания из канонического 3MF.

Пользователь всегда может скачать модель как STL — обязательный fallback
«одной кнопкой» (см. `docs/epics/3mf.storage.md`, MF-377): часть слайсеров/
CAD не открывает наш 3MF-профиль (Production-расширение — не универсальный
интероп), а STL — легаси-дефолт, который открывается везде. Это одностороннее
вырождение: STL не несёт мультиматериал/сборку/единицы, обратный путь не
предусмотрен. GLB для превью уже деривируется отдельно (`preview.py`,
role='preview') — здесь только downloadable-STL.

Эта функция выполняет только геометрическую конвертацию. `revision_worker.py`
вызывает её best-effort сразу после canonical и публикует revision-scoped STL
по детерминированному ключу; HTTP-запрос не пересобирает дериватив на лету.
"""

from __future__ import annotations

from pathlib import Path

import trimesh


class DerivativeError(Exception):
    """Не удалось сгенерировать дериватив для скачивания из канонического 3MF."""


def export_stl(canonical_path: Path, destination: Path) -> Path:
    """Экспортирует STL из канонического 3MF.

    Мультипарт-сборка (когда конвейер начнёт её сохранять, см. долг
    `force="mesh"` в `convert.py`) схлопывается в один меш — у STL всё равно
    нет понятия сборки/материалов, потеря ожидаема и не является багом.
    """
    try:
        mesh = trimesh.load(canonical_path, force="mesh")
    except Exception as exc:  # noqa: BLE001 — любой сбой чтения канона = ошибка дериватива
        raise DerivativeError(
            f"не удалось прочитать канонический 3MF {canonical_path.name}: {exc}"
        ) from exc

    if not isinstance(mesh, trimesh.Trimesh) or mesh.faces.shape[0] == 0:
        raise DerivativeError(
            f"канонический 3MF {canonical_path.name} не дал треугольной геометрии"
        )

    try:
        mesh.export(destination, file_type="stl")
    except Exception as exc:  # noqa: BLE001
        raise DerivativeError(f"STL-экспорт не удался: {exc}") from exc

    if not destination.exists() or destination.stat().st_size == 0:
        raise DerivativeError("STL-экспорт вернул пустой файл")

    return destination
