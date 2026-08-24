"""Спайк-эталон детекторов для новых форматов «артефакт как есть» (MF-500).

НЕ production-код: настоящий upload-валидатор живёт в `apps/api`
(TypeScript, MF-501) — граница Mesh/Back не размывается этим файлом.
Это исполняемая спецификация эвристик, которые попадают в
`docs/epics/formats.policy.md` v0.2 — Back портирует ту же логику на
TypeScript, а `test_format_spike.py` доказывает, что она реально
различает форматы и не даёт ложных срабатываний друг на друге
(текстовые G-code/SVG/Gerber/DXF визуально похожи — все "строки с
числами").
"""

from __future__ import annotations

import re
import stat
import zipfile
from dataclasses import dataclass
from pathlib import Path

STEP_MAGIC = b"ISO-10303-21;"
DXF_BINARY_MAGIC = b"AutoCAD Binary DXF\r\n\x1a\x00"
_DXF_SECTION_NAMES = {
    "HEADER",
    "CLASSES",
    "TABLES",
    "BLOCKS",
    "ENTITIES",
    "OBJECTS",
    "THUMBNAILIMAGE",
    "ACDSDATA",
}
_SVG_ROOT_RE = re.compile(
    r"^\s*(<\?xml[^>]*\?>\s*)?(<!doctype[^>]*>\s*)?(<!--.*?-->\s*)*<svg[\s>]",
    re.IGNORECASE | re.DOTALL,
)
_GMT_CODE_RE = re.compile(r"^[GMT]\d+", re.IGNORECASE)


def detect_step(data: bytes) -> bool:
    """ASCII-заголовок ISO-10303-21; допускаем ведущий BOM/пробелы."""
    return data.lstrip(b" \t\r\n\xef\xbb\xbf")[: len(STEP_MAGIC)] == STEP_MAGIC


def detect_dxf_binary(data: bytes) -> bool:
    return data[: len(DXF_BINARY_MAGIC)] == DXF_BINARY_MAGIC


def detect_dxf_ascii(text: str) -> bool:
    """Ищем пару группа-код "0" + один из маркеров секции в первых строках.

    Это структурный маркер DXF (группа-код/значение), которого нет ни у
    G-code, ни у Gerber, ни у SVG — они не используют этот протокол пар.
    """
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    window = lines[:60]
    for i in range(len(window) - 1):
        if window[i] == "0" and window[i + 1] in ({"SECTION"} | _DXF_SECTION_NAMES):
            return True
    return False


def detect_svg(text: str) -> bool:
    """`<svg>` как корневой элемент (после опц. BOM/декларации/DOCTYPE/комментариев)."""
    head = text[:4096]
    return bool(_SVG_ROOT_RE.match(head))


def detect_gcode(text: str) -> bool:
    """Эвристика: доля «значимых» строк, начинающихся с G/M/T + число, high.

    Комментарии (`;...`, `(...)`) и голые строки-разделители `%` (старый
    формат программ ЧПУ Fanuc/Heidenhain) не учитываются в знаменателе —
    иначе Fanuc-стиль с рамкой `%...%` путается с Gerber (тоже строки на
    `%`), а слайсерные комментарии-заголовки (`;FLAVOR:Marlin`) занижают
    долю совпадений на реальном 3D-принтерном G-code.
    """
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    considered = 0
    matched = 0
    for line in lines[:200]:
        if line.startswith(";") or line.startswith("("):
            continue
        if line == "%":
            continue
        considered += 1
        if _GMT_CODE_RE.match(line):
            matched += 1
    if considered == 0:
        return False
    return (matched / considered) >= 0.6


def detect_gerber(text: str) -> bool:
    """RS-274X: расширенные команды `%...*%` + statements, оканчивающиеся на `*`.

    Требуем хотя бы одну реальную расширенную команду (`%FS...*%`,
    `%MO...*%` и т.п., не голый `%`-разделитель) — это то, чего в
    G-code (даже percent-delimited Fanuc-стиле) не бывает по конструкции.
    """
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return False
    has_extended_command = any(
        line.startswith("%") and line.endswith("%") and line != "%" for line in lines[:30]
    )
    if not has_extended_command:
        return False
    considered = [line for line in lines[:200] if line != "%"]
    if not considered:
        return False
    terminated = sum(1 for line in considered if line.endswith("*") or line.endswith("*%"))
    return (terminated / len(considered)) >= 0.8


@dataclass(frozen=True)
class ZipSafetyViolation:
    # reason: too_many_entries | path_traversal | symlink_entry
    #       | compression_ratio | total_uncompressed
    reason: str
    entry: str | None = None


def _is_symlink_entry(info: zipfile.ZipInfo) -> bool:
    # external_attr верхние 16 бит — unix-режим файла, только когда архив
    # создан на unix-системе (create_system == 3); на прочих — 0, что не
    # совпадает с S_IFLNK, так что ложных срабатываний на Windows-зипах нет.
    mode = info.external_attr >> 16
    return stat.S_ISLNK(mode) if mode else False


def check_zip_container_safety(
    path: Path,
    *,
    max_entries: int = 10_000,
    max_total_uncompressed: int = 500 * 1024 * 1024,
    max_ratio: int = 100,
) -> ZipSafetyViolation | None:
    """Общая защита для непрозрачных zip-артефактов (Gerber-набор, архив кода).

    В отличие от 3MF (где парсим конкретный `3D/3dmodel.model`), эти
    контейнеры — просто «сумка файлов»: единственное, что мы можем и
    должны проверить — что распаковка не взорвёт диск/CPU (zip-бомба) и
    что имена записей не выходят за пределы целевой директории при
    будущей распаковке (zip-slip) или не являются симлинками.
    """
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        if len(infos) > max_entries:
            return ZipSafetyViolation("too_many_entries")

        total_uncompressed = 0
        for info in infos:
            name = info.filename
            normalized = name.replace("\\", "/")
            is_absolute = name.startswith("/") or name.startswith("\\")
            if is_absolute or ".." in normalized.split("/"):
                return ZipSafetyViolation("path_traversal", name)
            if _is_symlink_entry(info):
                return ZipSafetyViolation("symlink_entry", name)
            if info.is_dir():
                continue
            total_uncompressed += info.file_size
            if info.compress_size > 0:
                ratio = info.file_size / info.compress_size
                if ratio > max_ratio:
                    return ZipSafetyViolation("compression_ratio", name)
        if total_uncompressed > max_total_uncompressed:
            return ZipSafetyViolation("total_uncompressed")
    return None
