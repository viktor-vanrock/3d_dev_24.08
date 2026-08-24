"""Лимиты на вход пользовательских файлов (MF-378, «вход враждебен»).

Все значения переопределяются через env (см. имена полей `_ENV`), дефолты
рассчитаны на прод-VDS с общим бюджетом 4GB (делится с Postgres и api —
см. CLAUDE.md зоны `apps/mesh`). Лимиты документированы здесь и должны
меняться только тут — ни один модуль не хардкодит свои числа отдельно.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

# 1 треугольник в бинарном STL — 50 байт (12 float32 нормаль+3 вершины + uint16
# attribute count); заголовок — 84 байта (80 header + 4 uint32 count).
STL_BINARY_HEADER_SIZE = 80
STL_BINARY_COUNT_SIZE = 4
STL_BINARY_TRIANGLE_SIZE = 50


@dataclass(frozen=True)
class Limits:
    """Лимиты одного разбора файла. Иммутабельно — на процесс/задачу свой снапшот."""

    # Максимальный размер входного файла (STL/3MF) на диске.
    max_file_bytes: int
    # Максимальное число треугольников, которое мы согласны обработать.
    max_triangles: int
    # Максимальный суммарный распакованный размер OPC/zip-пакета (3MF).
    max_zip_uncompressed_bytes: int
    # Максимальное отношение uncompressed/compressed на один entry zip —
    # выше этого порога считаем zip-бомбой и отклоняем.
    max_zip_compression_ratio: float
    # Максимальное число entries в zip-пакете (защита от zip-бомбы из
    # огромного количества мелких файлов).
    max_zip_entries: int
    # Жёсткий wall-clock таймаут на разбор одного файла в изолированном процессе.
    parse_timeout_seconds: float
    # Cap на адресное пространство (RLIMIT_AS) изолированного процесса разбора.
    parse_memory_bytes: int
    # Потолок треугольников на деталь для repair-режима (fix_winding/fill_holes/
    # manifold3d — дороже базового парсинга, см. `mesh.convert._repair_mesh`).
    # Выше этого порога repair отклоняет деталь по бюджету (`RejectCode.
    # TOO_EXPENSIVE_TO_REPAIR`) вместо неограниченной по времени починки;
    # strict-диагностика (`mesh.diagnostics.diagnose`) выше порога пропускает
    # только самые дорогие поля (shell_count/winding_flipped_face_indices).
    max_repair_triangles: int


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    return int(raw) if raw else default


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    return float(raw) if raw else default


def load_limits() -> Limits:
    """Собирает лимиты из env поверх дефолтов (см. поля `Limits` выше)."""
    return Limits(
        max_file_bytes=_env_int("MESH_MAX_FILE_BYTES", 500 * 1024 * 1024),
        max_triangles=_env_int("MESH_MAX_TRIANGLES", 20_000_000),
        max_zip_uncompressed_bytes=_env_int(
            "MESH_MAX_ZIP_UNCOMPRESSED_BYTES", 1024 * 1024 * 1024
        ),
        max_zip_compression_ratio=_env_float("MESH_MAX_ZIP_COMPRESSION_RATIO", 100.0),
        max_zip_entries=_env_int("MESH_MAX_ZIP_ENTRIES", 10_000),
        parse_timeout_seconds=_env_float("MESH_PARSE_TIMEOUT_SECONDS", 60.0),
        parse_memory_bytes=_env_int("MESH_PARSE_MEMORY_BYTES", 2 * 1024 * 1024 * 1024),
        max_repair_triangles=_env_int("MESH_MAX_REPAIR_TRIANGLES", 2_000_000),
    )
