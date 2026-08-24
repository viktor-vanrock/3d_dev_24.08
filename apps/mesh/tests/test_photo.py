"""Юнит-тесты обработки фото Make: EXIF/GPS-стрип, варианты, пре-модерация (MF-783)."""

import io

import numpy as np
import pytest
from PIL import Image
from PIL.TiffImagePlugin import IFDRational

from mesh.photo import (
    VARIANT_SPECS,
    InvalidPhotoError,
    assess_moderation,
    average_hash,
    process_photo,
)


def _jpeg_with_gps(size=(800, 600), color=(30, 120, 30)) -> bytes:
    """JPEG с зашитыми GPS-координатами в EXIF — воспроизводит «утечку локации автора»."""
    image = Image.new("RGB", size, color)
    exif = image.getexif()
    gps_ifd = exif.get_ifd(0x8825)
    gps_ifd[1] = "N"  # GPSLatitudeRef
    gps_ifd[2] = (IFDRational(55, 1), IFDRational(45, 1), IFDRational(0, 1))  # GPSLatitude
    gps_ifd[3] = "E"  # GPSLongitudeRef
    gps_ifd[4] = (IFDRational(37, 1), IFDRational(37, 1), IFDRational(0, 1))  # GPSLongitude
    exif[0x8825] = gps_ifd
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", exif=exif)
    return buffer.getvalue()


def test_process_photo_strips_gps_and_exif():
    source = _jpeg_with_gps()
    # Контроль: у исходника GPS реально есть (иначе тест ничего не проверяет).
    source_exif = Image.open(io.BytesIO(source)).getexif()
    assert source_exif.get_ifd(0x8825)

    result = process_photo(source)

    for variant_name in VARIANT_SPECS:
        variant_bytes = result.variants[variant_name]
        decoded = Image.open(io.BytesIO(variant_bytes))
        decoded.load()
        assert decoded.format == "WEBP"
        result_exif = decoded.getexif()
        assert not result_exif.get_ifd(0x8825), f"{variant_name}: GPS не стёрт"
        assert len(result_exif) == 0, f"{variant_name}: EXIF не пуст"


def test_process_photo_variant_dimensions_respect_max_side():
    source = _jpeg_with_gps(size=(4000, 3000))
    result = process_photo(source)
    for variant_name, (max_side, _quality) in VARIANT_SPECS.items():
        decoded = Image.open(io.BytesIO(result.variants[variant_name]))
        assert max(decoded.size) <= max_side


def test_process_photo_applies_exif_orientation_before_stripping():
    """Фото, снятое «боком» с Orientation=6 (90° CW), должно выйти уже повёрнутым правильно."""
    image = Image.new("RGB", (600, 400), (10, 200, 10))
    exif = image.getexif()
    exif[0x0112] = 6  # Orientation: повернуть 90° по часовой при отображении
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", exif=exif)

    result = process_photo(buffer.getvalue())
    full = Image.open(io.BytesIO(result.variants["full"]))
    # Orientation=6 на исходных 600x400 после применения даёт портретные 400x600.
    assert full.size[1] > full.size[0]


def test_invalid_photo_raises():
    with pytest.raises(InvalidPhotoError):
        process_photo(b"not an image")


def test_moderation_small_image_is_pending():
    tiny = Image.new("RGB", (50, 50), (128, 128, 128))
    assert assess_moderation(tiny) == "pending"


def test_moderation_skin_tone_heavy_image_is_pending():
    skin_tone = Image.new("RGB", (400, 400), (224, 172, 105))  # классический skin-tone RGB
    assert assess_moderation(skin_tone) == "pending"


def test_moderation_ordinary_photo_is_approved():
    rng = np.random.default_rng(42)
    # Синий/зелёный шум — далеко от диапазона тона кожи, размер выше порога.
    pixels = rng.integers(0, 80, size=(400, 400, 3), dtype=np.uint8)
    pixels[..., 0] = 20  # низкий red-канал держит вне skin-диапазона
    image = Image.fromarray(pixels, mode="RGB")
    assert assess_moderation(image) == "approved"


def _hamming_distance(a: int, b: int) -> int:
    return bin((a ^ b) & ((1 << 64) - 1)).count("1")


def _gradient_image(seed: int) -> Image.Image:
    size = 64
    pixels = np.zeros((size, size, 3), dtype=np.uint8)
    for y in range(size):
        for x in range(size):
            pixels[y, x, 0] = (x * 4 + seed) % 256
            pixels[y, x, 1] = (y * 4 + seed) % 256
            pixels[y, x, 2] = ((x + y) * 2 + seed) % 256
    return Image.fromarray(pixels, mode="RGB")


def test_average_hash_is_stable_across_recompression():
    """Тот же кадр, пережатый/уменьшенный (ровно та деформация, что даёт повторный аплойд
    под другую модель, MF-780), должен дать близкий (не обязательно идентичный) хэш."""
    original = _gradient_image(seed=11)
    hash_a = average_hash(original)

    recompressed = original.resize((256, 256)).convert("RGB")
    buffer = io.BytesIO()
    recompressed.save(buffer, format="JPEG", quality=70)
    hash_b = average_hash(Image.open(buffer))

    assert _hamming_distance(hash_a, hash_b) <= 6


def test_average_hash_differs_for_visually_different_images():
    fine = Image.fromarray(
        (np.indices((64, 64)).sum(axis=0) % 4 < 2).astype(np.uint8) * 255, mode="L"
    ).convert("RGB")
    coarse = Image.fromarray(
        (np.indices((64, 64)).sum(axis=0) % 64 < 32).astype(np.uint8) * 255, mode="L"
    ).convert("RGB")

    assert _hamming_distance(average_hash(fine), average_hash(coarse)) > 6


def test_process_photo_includes_phash():
    result = process_photo(_jpeg_with_gps())
    assert isinstance(result.phash, int)
    assert -(1 << 63) <= result.phash < (1 << 63)
