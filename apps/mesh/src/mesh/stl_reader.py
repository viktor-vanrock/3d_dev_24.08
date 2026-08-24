"""Структурная проверка STL до передачи в trimesh (MF-378).

Бинарный STL: 80-байтный заголовок + uint32 count треугольников + count*50
байт данных (12 float32 нормаль+3 вершины + uint16 attribute byte count).
Заявленный count — вход атаки (переполнение аллокации): до вызова trimesh
проверяем его и против лимита, и против реального размера файла, а не
доверяем ему на слово. `load_stl_mesh` — единственная точка входа, рассчитана
на вызов внутри `sandbox.run_isolated` (сама не знает про таймаут/память).
"""

from __future__ import annotations

from pathlib import Path

import trimesh

from .errors import RejectCode, RejectionError
from .limits import (
    STL_BINARY_COUNT_SIZE,
    STL_BINARY_HEADER_SIZE,
    STL_BINARY_TRIANGLE_SIZE,
    Limits,
)


def _looks_like_ascii_header(header: bytes) -> bool:
    """`solid` в начале 80-байтного заголовка — необходимый, но не достаточный признак.

    Некоторые писатели кладут текст `solid ...` даже в бинарный STL — поэтому
    решающая проверка в `sniff_stl` не текстовая, а по совпадению размера.
    """
    return header.lstrip().startswith(b"solid")


def sniff_stl(path: Path, size_bytes: int) -> tuple[bool, int | None]:
    """Возвращает (is_ascii, declared_triangle_count).

    `declared_triangle_count` заполнен только для бинарного варианта — именно
    там есть поле count, несущее риск переполнения аллокации. Бинарность
    решается по факту: если размер файла бьётся с формулой `84 + count*50`
    для count из байт 80..83 — это бинарный STL, даже если заголовок
    начинается с текста `solid` (реальный STL-гочт: некоторые писатели кладут
    такой текст и в бинарный вариант). Иначе — по текстовому маркеру, что
    покрывает и короткие ASCII-файлы (легитимный 1-facet STL короче 84 байт).
    """
    with path.open("rb") as handle:
        head = handle.read(STL_BINARY_HEADER_SIZE + STL_BINARY_COUNT_SIZE)

    header = head[:STL_BINARY_HEADER_SIZE]
    count_bytes = head[STL_BINARY_HEADER_SIZE : STL_BINARY_HEADER_SIZE + STL_BINARY_COUNT_SIZE]

    declared_count: int | None = None
    if len(count_bytes) == STL_BINARY_COUNT_SIZE:
        declared_count = int.from_bytes(count_bytes, byteorder="little", signed=False)
        expected_binary_size = (
            STL_BINARY_HEADER_SIZE
            + STL_BINARY_COUNT_SIZE
            + declared_count * STL_BINARY_TRIANGLE_SIZE
        )
        if expected_binary_size == size_bytes:
            return False, declared_count

    if _looks_like_ascii_header(header):
        return True, None

    if declared_count is None:
        raise RejectionError(
            RejectCode.TRUNCATED, f"{path.name}: короче минимального заголовка STL"
        )

    # Ни текстовый маркер, ни совпадение бинарной формулы — трактуем как
    # усечённый/битый бинарный STL с этим заявленным count (даст TRUNCATED
    # выше по стеку с понятной диагностикой, а не молчаливый ASCII-фоллбэк).
    return False, declared_count


def check_stl_input(path: Path, limits: Limits) -> int | None:
    """Отклоняет пустой/усечённый/слишком большой STL до передачи в trimesh.

    Возвращает заявленный triangle count для бинарного STL (None для ASCII).
    """
    if not path.exists():
        raise RejectionError(RejectCode.EMPTY_FILE, f"{path.name}: файл не найден")

    size_bytes = path.stat().st_size
    if size_bytes == 0:
        raise RejectionError(RejectCode.EMPTY_FILE, f"{path.name}: файл пуст")
    if size_bytes > limits.max_file_bytes:
        raise RejectionError(
            RejectCode.TOO_LARGE,
            f"{path.name}: {size_bytes} байт превышает лимит {limits.max_file_bytes}",
        )

    is_ascii, declared_count = sniff_stl(path, size_bytes)
    if is_ascii or declared_count is None:
        return None

    if declared_count > limits.max_triangles:
        raise RejectionError(
            RejectCode.TOO_MANY_TRIANGLES,
            f"{path.name}: заявлено {declared_count} треугольников, лимит {limits.max_triangles}",
        )

    expected_size = (
        STL_BINARY_HEADER_SIZE + STL_BINARY_COUNT_SIZE + declared_count * STL_BINARY_TRIANGLE_SIZE
    )
    if expected_size != size_bytes:
        raise RejectionError(
            RejectCode.TRUNCATED,
            f"{path.name}: заявлено {declared_count} треугольников "
            f"({expected_size} байт ожидалось), в файле {size_bytes} байт",
        )

    return declared_count


def load_stl_mesh(path: Path, limits: Limits) -> trimesh.Trimesh:
    """Структурно проверяет STL и читает геометрию через trimesh.

    Точка входа для `sandbox.run_isolated` — сама не думает про wall-timeout
    или память, только про структурные отказы файла.
    """
    check_stl_input(path, limits)
    try:
        mesh = trimesh.load(path, force="mesh")
    except Exception as exc:  # noqa: BLE001 — источник пользователя, любой сбой = структурный отказ
        raise RejectionError(RejectCode.PARSE_ERROR, f"{path.name}: {exc}") from exc
    return mesh
