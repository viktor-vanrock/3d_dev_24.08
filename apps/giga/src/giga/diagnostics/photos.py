"""Приём фото дефекта печати: валидация, EXIF-стрип, ресайз (MF-360 шаг 3).

Тот же принцип, что `apps/mesh/src/mesh/photo.py` (обработка фото Make):
`Image.save()` без `exif=` стирает EXIF/GPS как побочный эффект
перекодирования, `exif_transpose` — ДО стирания, иначе потеряется поворот.
Проще mesh-варианта — один вариант картинки, не thumb/medium/full: фото
дефекта не публикуется в галерее, оно только контекст для одного вызова
GigaChat Vision (MF-361/362), лишние размеры там не нужны.

Вход враждебен (CLAUDE.md § «ВХОД ВРАЖДЕБЕН»): фото на диагностику грузит
пользователь напрямую, лимит размера — до чтения в Pillow, чтобы не
декодировать зображение, гарантированно превышающее допустимый объём.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

from PIL import Image, ImageOps

# Выше — подозрительно большой файл для фото дефекта с телефона (не 3D-скан и
# не RAW); отклоняем до декодирования, не тратя CPU на распаковку мусора.
MAX_UPLOAD_BYTES = 15 * 1024 * 1024

# Меньше — вероятно иконка/обрезок, не полноценное фото детали с дефектом.
MIN_DIMENSION_PX = 200

# Сторона результирующего webp: фото уходит в промпт GigaChat Vision, не на
# полноэкранный просмотр — крупнее не даёт диагностике точности, только
# увеличивает вес запроса к провайдеру (CLAUDE.md § «СТОИМОСТЬ»).
MAX_SIDE_PX = 1600
WEBP_QUALITY = 85

_ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}


class InvalidPhotoError(Exception):
    """Файл слишком большой, не открылся как изображение или битый — 422 на границе API."""


@dataclass(frozen=True)
class ProcessedDiagnosticPhoto:
    data: bytes  # webp без EXIF/GPS, приведён к MAX_SIDE_PX по большей стороне
    content_type: str
    width: int
    height: int


def process_diagnostic_photo(data: bytes) -> ProcessedDiagnosticPhoto:
    """Валидирует и готовит фото к сохранению/передаче в модель.

    Отклоняет: превышение `MAX_UPLOAD_BYTES`, нечитаемый файл, неподдерживаемый
    формат, слишком маленькое изображение (см. константы выше).
    """
    if len(data) > MAX_UPLOAD_BYTES:
        raise InvalidPhotoError(
            f"файл превышает лимит {MAX_UPLOAD_BYTES // (1024 * 1024)} МБ"
        )

    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception as exc:  # noqa: BLE001 — любой сбой чтения = невалидное фото
        raise InvalidPhotoError(f"не удалось прочитать изображение: {exc}") from exc

    if image.format not in _ALLOWED_FORMATS:
        raise InvalidPhotoError(
            f"формат {image.format!r} не поддерживается, ожидается JPEG/PNG/WEBP"
        )

    image = ImageOps.exif_transpose(image) or image
    if image.mode != "RGB":
        image = image.convert("RGB")

    width, height = image.size
    if min(width, height) < MIN_DIMENSION_PX:
        raise InvalidPhotoError(
            f"изображение слишком маленькое ({width}x{height}), "
            f"минимум {MIN_DIMENSION_PX}px по стороне"
        )

    image.thumbnail((MAX_SIDE_PX, MAX_SIDE_PX), Image.LANCZOS)
    buffer = io.BytesIO()
    # webp без exif= -> EXIF/GPS отсутствует в результирующих байтах.
    image.save(buffer, format="WEBP", quality=WEBP_QUALITY)
    encoded = buffer.getvalue()

    return ProcessedDiagnosticPhoto(
        data=encoded, content_type="image/webp", width=image.width, height=image.height
    )
