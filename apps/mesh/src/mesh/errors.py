"""Структурированные отказы разбора пользовательских файлов (MF-378).

Один тип исключения на весь конвейер приёма: код (машиночитаемый, для
ветвления вызывающим кодом/метрик) + сообщение (человекочитаемое, для логов
и ошибки пользователю). Заменяет голые строки в старых `ConversionError` —
`mesh.convert.ConversionError` теперь alias этого класса.
"""

from __future__ import annotations

from enum import StrEnum


class RejectCode(StrEnum):
    """Причина отказа. Значения — стабильные snake_case-идентификаторы."""

    EMPTY_FILE = "empty_file"
    TOO_LARGE = "too_large"
    TRUNCATED = "truncated"
    TOO_MANY_TRIANGLES = "too_many_triangles"
    NOT_MESH = "not_mesh"
    INVALID_ZIP = "invalid_zip"
    ZIP_BOMB = "zip_bomb"
    PATH_TRAVERSAL = "path_traversal"
    PARSE_ERROR = "parse_error"
    TIMEOUT = "timeout"
    MEMORY_LIMIT = "memory_limit"
    TOO_EXPENSIVE_TO_REPAIR = "too_expensive_to_repair"
    UNKNOWN_UNIT = "unknown_unit"


class RejectionError(Exception):
    """Отказ с кодом. `str(exc)` даёт только сообщение (совместимо со старым API)."""

    def __init__(self, code: RejectCode, message: str) -> None:
        super().__init__(message)
        self.code = code

    def __repr__(self) -> str:  # pragma: no cover — только для логов/отладки
        return f"RejectionError({self.code.value}, {super().__str__()!r})"
