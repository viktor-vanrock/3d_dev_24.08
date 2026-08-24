"""Обработка фото Make: EXIF/GPS-стрип, thumb/medium/full варианты, пре-модерация.

MF-393 шаг 3 / MF-783 (остаток Фазы 1 эпика MF-27). Стек модерации — решение,
закрывающее открытый вопрос эпика: локальная эвристика по пикселям, БЕЗ ML-модели
и БЕЗ внешнего API. Тот же MVP-принцип, что `isPromptBlocked` в
`apps/api/src/generations/moderation.ts` (там — плоский список слов вместо тяжёлой
ML-модерации текста; здесь — дешёвые признаки по изображению вместо NSFW-классификатора).
Обоснование: на v1 нет бюджета/инфры под GPU-модель или платный API, а грубый фильтр
всё равно не заменяет ручную модерацию — он снимает нагрузку с очевидных случаев и
переводит подозрительное в `pending` (НЕ публикуется автоматически), не отклоняя его
с ложной уверенностью. Точная NSFW/print-классификация по содержимому — кандидат на
будущую AI-итерацию (apps/giga), не блокирует этот шаг.

EXIF/GPS реально стирается как побочный эффект перекодирования: `Image.save()` не
пишет ни один тег, если explicit `exif=` не передан, — see `_load_stripped`.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageOps

# "approved" | "pending" | "rejected" — те же значения, что check-констрейнт
# make_photos.moderation_status (apps/api/db/migrations/20260710280000_make_photos.sql).
ModerationStatus = str

# (максимальная сторона в пикселях, качество webp) — деривативы `s3_key`, тот же
# принцип, что modelObjectKey() (models/{model_id}/{role}.{ext}): вариант по
# конвенции имени, а не отдельная колонка на каждый размер.
VARIANT_SPECS: dict[str, tuple[int, int]] = {
    "thumb": (320, 75),
    "medium": (1024, 82),
    "full": (2560, 88),
}

# Ниже — вероятно спам/иконка/обрезок, не полноценное фото печати.
_MIN_DIMENSION_PX = 200
# Порог доли кожи-тона (HSV) — классическая дешёвая эвристика NSFW-ПОДОЗРЕНИЯ,
# не классификатор: ложные срабатывания (портрет на фоне печати, загар) ожидаемы
# и приемлемы, т.к. результат — `pending` (ручной разбор), а не `rejected`.
_SKIN_RATIO_SUSPECT_THRESHOLD = 0.45


class InvalidPhotoError(Exception):
    """Файл не открылся как изображение или битый — 422 на границе API."""


@dataclass(frozen=True)
class ProcessedPhoto:
    variants: dict[str, bytes]  # "thumb"/"medium"/"full" -> webp-байты без EXIF/GPS
    moderation_status: ModerationStatus
    width: int
    height: int
    phash: int  # aHash 64 бита, знаковое представление под Postgres bigint (см. average_hash)


def _load_stripped(data: bytes) -> Image.Image:
    """Открывает фото, применяет EXIF-поворот и возвращает RGB без EXIF/GPS.

    `exif_transpose` обязан идти ДО стирания EXIF — иначе поворот, закодированный в
    Orientation-теге, потеряется и фото ляжет боком. Само стирание ниже по коду
    происходит просто потому, что `_encode_variant` не передаёт `exif=` в `save()`.
    """
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception as exc:  # noqa: BLE001 — любой сбой чтения = невалидное фото
        raise InvalidPhotoError(f"не удалось прочитать изображение: {exc}") from exc
    image = ImageOps.exif_transpose(image) or image
    if image.mode != "RGB":
        image = image.convert("RGB")
    return image


def _encode_variant(image: Image.Image, max_side: int, quality: int) -> bytes:
    resized = image.copy()
    resized.thumbnail((max_side, max_side), Image.LANCZOS)
    buffer = io.BytesIO()
    # webp без exif= → EXIF/GPS отсутствует в результирующих байтах.
    resized.save(buffer, format="WEBP", quality=quality)
    return buffer.getvalue()


def _skin_ratio(image: Image.Image) -> float:
    """Доля пикселей в классическом HSV-диапазоне тона кожи — грубый признак, не классификатор."""
    sample = image.copy()
    sample.thumbnail((256, 256), Image.LANCZOS)  # эвристику незачем гонять по полному разрешению
    hsv = np.asarray(sample.convert("HSV"), dtype=np.uint8)
    hue, sat, val = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    mask = (hue <= 25) & (sat >= 48) & (sat <= 200) & (val >= 60)
    return float(mask.mean())


def assess_moderation(image: Image.Image) -> ModerationStatus:
    """pending — подозрительное (слишком маленькое ИЛИ похоже на NSFW по HSV-эвристике),
    approved — прошло обе проверки. `rejected` в этой MVP-эвристике не выставляется
    автоматически: она недостаточно точна, чтобы отклонять с уверенностью — только
    отправлять на ручной разбор (см. docstring модуля)."""
    width, height = image.size
    if min(width, height) < _MIN_DIMENSION_PX:
        return "pending"
    if _skin_ratio(image) >= _SKIN_RATIO_SUSPECT_THRESHOLD:
        return "pending"
    return "approved"


_HASH_SIZE = 8  # 8×8 = 64 бита — умещается в bigint без потери точности.


def average_hash(image: Image.Image) -> int:
    """Перцептивный хэш (aHash, MF-780): даунскейл до 8×8 grayscale, бит=1, если пиксель не
    темнее среднего по кадру. Ловит буквальный повторный аплойд того же кадра (в т.ч. после
    пережатия/ресайза — ровно та деформация, что даёт повторная заливка под другую модель),
    не произвольный форк/обрезку/поворот — сознательный MVP-компромисс, тот же принцип, что
    HSV-эвристика модерации выше в этом модуле.

    Возвращает знаковое 64-битное представление (`BigInt.asIntN(64, ...)`-эквивалент) —
    Postgres `bigint` не умеет беззнаковый диапазон, а верхний бит хэша иначе не влезет.
    """
    small = image.convert("L").resize((_HASH_SIZE, _HASH_SIZE), Image.LANCZOS)
    pixels = np.asarray(small, dtype=np.uint8).flatten()
    average = float(pixels.mean())
    bits = 0
    for value in pixels:
        bits = (bits << 1) | (1 if value >= average else 0)
    return bits - (1 << 64) if bits >= (1 << 63) else bits


def process_photo(data: bytes) -> ProcessedPhoto:
    """Стрип EXIF/GPS + thumb/medium/full + пре-модерация + перцептивный хэш — одним проходом"""
    image = _load_stripped(data)
    variants = {
        name: _encode_variant(image, max_side, quality)
        for name, (max_side, quality) in VARIANT_SPECS.items()
    }
    status = assess_moderation(image)
    width, height = image.size
    phash = average_hash(image)
    return ProcessedPhoto(
        variants=variants, moderation_status=status, width=width, height=height, phash=phash
    )
