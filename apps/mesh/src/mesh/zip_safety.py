"""Защита ZIP/OPC-пакетов (3MF) от zip-бомб и path traversal (MF-378).

Применяется ДО того, как что-либо (zipfile-извлечение, lib3mf, trimesh)
распакует содержимое — полноценного собственного 3MF-ридера в этой фазе ещё
нет (см. MF-379+), это защитный слой под сегодняшний `passthrough_3mf`
(который уже читает входной 3MF) и фундамент под будущий парсер.
"""

from __future__ import annotations

import zipfile
from pathlib import Path, PurePosixPath

from .errors import RejectCode, RejectionError
from .limits import Limits


def _is_safe_member_name(name: str) -> bool:
    """Отклоняет абсолютные пути и `..`-переходы в именах OPC-частей архива."""
    if name.startswith("/") or name.startswith("\\") or (len(name) > 1 and name[1] == ":"):
        return False
    return ".." not in PurePosixPath(name).parts


def check_zip_safety(path: Path, limits: Limits) -> None:
    """Проверяет zip-архив на path traversal и zip-бомбу до извлечения содержимого.

    Кидает RejectionError(PATH_TRAVERSAL|ZIP_BOMB) при первом нарушении:
    небезопасное имя части, превышение лимита числа entries, суммарного
    распакованного размера или отношения uncompressed/compressed на entry.
    """
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        if len(infos) > limits.max_zip_entries:
            raise RejectionError(
                RejectCode.ZIP_BOMB,
                f"{path.name}: {len(infos)} частей в архиве, лимит {limits.max_zip_entries}",
            )

        total_uncompressed = 0
        for info in infos:
            if not _is_safe_member_name(info.filename):
                raise RejectionError(
                    RejectCode.PATH_TRAVERSAL,
                    f"{path.name}: небезопасное имя части архива {info.filename!r}",
                )

            total_uncompressed += info.file_size
            if total_uncompressed > limits.max_zip_uncompressed_bytes:
                raise RejectionError(
                    RejectCode.ZIP_BOMB,
                    f"{path.name}: суммарный распакованный размер превышает лимит "
                    f"{limits.max_zip_uncompressed_bytes} байт",
                )

            if info.compress_size > 0:
                ratio = info.file_size / info.compress_size
                if ratio > limits.max_zip_compression_ratio:
                    raise RejectionError(
                        RejectCode.ZIP_BOMB,
                        f"{path.name}: часть {info.filename!r} сжата с отношением "
                        f"{ratio:.1f}x, лимит {limits.max_zip_compression_ratio}x",
                    )
