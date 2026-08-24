"""Тесты приёма фото дефекта: валидация, EXIF-стрип, ресайз (MF-360 шаг 3)."""

from __future__ import annotations

import io

import pytest
from PIL import Image
from PIL.TiffImagePlugin import IFDRational

from giga.diagnostics.photos import (
    MAX_SIDE_PX,
    MAX_UPLOAD_BYTES,
    MIN_DIMENSION_PX,
    InvalidPhotoError,
    process_diagnostic_photo,
)


def _jpeg_with_gps(size=(800, 600), color=(30, 120, 30)) -> bytes:
    image = Image.new("RGB", size, color)
    exif = image.getexif()
    gps_ifd = exif.get_ifd(0x8825)
    gps_ifd[1] = "N"
    gps_ifd[2] = (IFDRational(55, 1), IFDRational(45, 1), IFDRational(0, 1))
    gps_ifd[3] = "E"
    gps_ifd[4] = (IFDRational(37, 1), IFDRational(37, 1), IFDRational(0, 1))
    exif[0x8825] = gps_ifd
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", exif=exif)
    return buffer.getvalue()


def test_process_diagnostic_photo_strips_gps_and_exif():
    source = _jpeg_with_gps()
    source_exif = Image.open(io.BytesIO(source)).getexif()
    assert source_exif.get_ifd(0x8825)

    result = process_diagnostic_photo(source)

    decoded = Image.open(io.BytesIO(result.data))
    decoded.load()
    assert decoded.format == "WEBP"
    result_exif = decoded.getexif()
    assert not result_exif.get_ifd(0x8825)
    assert len(result_exif) == 0
    assert result.content_type == "image/webp"


def test_process_diagnostic_photo_respects_max_side():
    source = _jpeg_with_gps(size=(4000, 3000))
    result = process_diagnostic_photo(source)
    assert max(result.width, result.height) <= MAX_SIDE_PX
    decoded = Image.open(io.BytesIO(result.data))
    assert max(decoded.size) <= MAX_SIDE_PX


def test_process_diagnostic_photo_applies_exif_orientation():
    image = Image.new("RGB", (600, 400), (10, 200, 10))
    exif = image.getexif()
    exif[0x0112] = 6
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", exif=exif)

    result = process_diagnostic_photo(buffer.getvalue())
    assert result.height > result.width


def test_invalid_bytes_raise():
    with pytest.raises(InvalidPhotoError):
        process_diagnostic_photo(b"not an image")


def test_too_large_upload_rejected():
    oversized = b"0" * (MAX_UPLOAD_BYTES + 1)
    with pytest.raises(InvalidPhotoError):
        process_diagnostic_photo(oversized)


def test_too_small_image_rejected():
    tiny = Image.new("RGB", (50, 50), (128, 128, 128))
    buffer = io.BytesIO()
    tiny.save(buffer, format="JPEG")
    with pytest.raises(InvalidPhotoError):
        process_diagnostic_photo(buffer.getvalue())


def test_dimension_floor_accepted():
    exact = Image.new("RGB", (MIN_DIMENSION_PX, MIN_DIMENSION_PX), (5, 5, 5))
    buffer = io.BytesIO()
    exact.save(buffer, format="JPEG")
    result = process_diagnostic_photo(buffer.getvalue())
    assert result.width == MIN_DIMENSION_PX
