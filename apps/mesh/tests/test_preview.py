"""Юнит-тесты производных ассетов превью: GLB (децимация/бюджет), webp, deflate."""

import zipfile

import numpy as np
import pytest
import trimesh
from PIL import Image

from mesh.convert import convert_to_3mf
from mesh.preview import (
    MOBILE_PREVIEW_MAX_BYTES,
    MOBILE_PREVIEW_TARGET_FACES,
    PREVIEW_MAX_BYTES,
    PREVIEW_TARGET_FACES,
    THUMBNAIL_SSAA,
    PreviewError,
    _downsample_rgba,
    export_glb,
    export_mobile_glb,
    export_thumbnail,
    generate_previews,
    zip_uses_deflate,
)


def _dense_sphere(subdivisions: int = 6) -> trimesh.Trimesh:
    # icosphere(6) ≈ 81920 граней; (7) ≈ 327680 — за порогом децимации.
    return trimesh.creation.icosphere(subdivisions=subdivisions)


def test_export_glb_reloads_as_mesh(tmp_path):
    mesh = trimesh.creation.box(extents=[10, 20, 30])
    out = tmp_path / "preview.glb"

    export_glb(mesh, out)

    assert out.exists()
    reloaded = trimesh.load(out, force="mesh")
    assert reloaded.faces.shape[0] > 0


def test_export_glb_decimates_dense_mesh(tmp_path):
    mesh = _dense_sphere(7)  # ~327k граней, выше порога
    assert mesh.faces.shape[0] > PREVIEW_TARGET_FACES
    out = tmp_path / "preview.glb"

    export_glb(mesh, out)

    reloaded = trimesh.load(out, force="mesh")
    # Децимировано до целевого порога (с небольшим допуском реализации).
    assert reloaded.faces.shape[0] <= PREVIEW_TARGET_FACES + 1000


def test_export_glb_keeps_low_poly_untouched(tmp_path):
    mesh = trimesh.creation.box(extents=[1, 1, 1])  # 12 граней
    out = tmp_path / "preview.glb"

    export_glb(mesh, out)

    reloaded = trimesh.load(out, force="mesh")
    # Меши под порогом не «децимируются вверх» — геометрия сохранена.
    assert reloaded.faces.shape[0] == mesh.faces.shape[0]


def test_export_glb_within_size_budget(tmp_path):
    mesh = _dense_sphere(7)
    out = tmp_path / "preview.glb"

    export_glb(mesh, out)

    assert out.stat().st_size <= PREVIEW_MAX_BYTES


def test_mobile_preview_budget_tighter_than_desktop():
    # MF-433: мобильный VRAM-бюджет — на порядок теснее десктопного.
    assert MOBILE_PREVIEW_TARGET_FACES < PREVIEW_TARGET_FACES
    assert MOBILE_PREVIEW_MAX_BYTES < PREVIEW_MAX_BYTES


def test_export_mobile_glb_reloads_as_mesh(tmp_path):
    mesh = trimesh.creation.box(extents=[10, 20, 30])
    out = tmp_path / "preview.mobile.glb"

    export_mobile_glb(mesh, out)

    assert out.exists()
    reloaded = trimesh.load(out, force="mesh")
    assert reloaded.faces.shape[0] > 0


def test_export_mobile_glb_decimates_to_mobile_budget(tmp_path):
    mesh = _dense_sphere(7)  # ~327k граней, выше и десктопного, и мобильного порога
    out = tmp_path / "preview.mobile.glb"

    export_mobile_glb(mesh, out)

    reloaded = trimesh.load(out, force="mesh")
    assert reloaded.faces.shape[0] <= MOBILE_PREVIEW_TARGET_FACES + 1000


def test_export_mobile_glb_within_mobile_size_budget(tmp_path):
    mesh = _dense_sphere(7)
    out = tmp_path / "preview.mobile.glb"

    export_mobile_glb(mesh, out)

    assert out.stat().st_size <= MOBILE_PREVIEW_MAX_BYTES


def test_export_mobile_glb_is_double_sided(tmp_path):
    # MF-1058: preview.mobile.glb рендерился пустым канвасом на тач-устройствах —
    # агрессивная децимация до MOBILE_PREVIEW_TARGET_FACES на тонких «листовых»
    # геометриях (крылья/соты) может развернуть нормали части граней; GLTFLoader
    # вешает на primitive без материала single-sided `MeshStandardMaterial` и
    # заднюю грань не рисует. Явный double-sided материал делает мобильный ассет
    # терпимым к этому классу дефекта декимации. Десктопный preview.glb такой
    # материал не получает (бюджет мягче, регресса не было).
    mesh = _dense_sphere(7)
    out = tmp_path / "preview.mobile.glb"

    export_mobile_glb(mesh, out)

    scene = trimesh.load(out, force="scene")
    materials = [
        geom.visual.material
        for geom in scene.geometry.values()
        if hasattr(geom.visual, "material")
    ]
    assert materials, "мобильный GLB должен нести явный материал"
    assert all(getattr(mat, "doubleSided", False) for mat in materials)


def test_export_glb_desktop_has_no_explicit_material(tmp_path):
    # Контроль: double-sided — мобильная мера, десктопный ассет не трогаем.
    mesh = _dense_sphere(7)
    out = tmp_path / "preview.glb"

    export_glb(mesh, out)

    scene = trimesh.load(out, force="scene")
    for geom in scene.geometry.values():
        material = getattr(geom.visual, "material", None)
        assert material is None or not getattr(material, "doubleSided", False)


def test_export_mobile_glb_keeps_low_poly_untouched(tmp_path):
    mesh = trimesh.creation.box(extents=[1, 1, 1])  # 12 граней
    out = tmp_path / "preview.mobile.glb"

    export_mobile_glb(mesh, out)

    reloaded = trimesh.load(out, force="mesh")
    assert reloaded.faces.shape[0] == mesh.faces.shape[0]


def test_export_thumbnail_produces_webp(tmp_path):
    mesh = _dense_sphere(4)
    out = tmp_path / "thumb.webp"

    export_thumbnail(mesh, out, size=256)

    assert out.exists()
    image = Image.open(out)
    assert image.format == "WEBP"
    assert image.size == (256, 256)
    assert image.mode == "RGBA"


def test_thumbnail_background_transparent_object_opaque(tmp_path):
    mesh = _dense_sphere(4)
    out = tmp_path / "thumb.webp"

    export_thumbnail(mesh, out, size=256)

    arr = np.asarray(Image.open(out))
    alpha = arr[..., 3]
    # Есть и непрозрачный объект в центре, и прозрачный фон по краям.
    assert (alpha > 0).any(), "объект не отрендерился"
    assert (alpha == 0).any(), "фон должен быть прозрачным (слоёный стек каталога)"
    # Углы кадра — фон (прозрачные).
    assert alpha[0, 0] == 0
    assert alpha[-1, -1] == 0


def test_thumbnail_rejects_empty_mesh(tmp_path):
    empty = trimesh.Trimesh(vertices=np.zeros((0, 3)), faces=np.zeros((0, 3), dtype=np.int64))
    with pytest.raises(PreviewError):
        export_thumbnail(empty, tmp_path / "thumb.webp")


def test_thumbnail_edges_antialiased_partial_alpha(tmp_path):
    # SSAA должен давать полупрозрачные пиксели на контуре силуэта: без сглаживания
    # альфа строго бинарна (0/255), с ним у края появляются промежуточные значения.
    mesh = _dense_sphere(4)
    out = tmp_path / "thumb.webp"

    export_thumbnail(mesh, out, size=256)

    alpha = np.asarray(Image.open(out))[..., 3]
    partial = (alpha > 0) & (alpha < 255)
    assert partial.any(), "контур силуэта не сглажен — нет полупрозрачных краевых пикселей"


def test_downsample_alpha_edge_no_dark_fringe():
    # Край силуэта (белый объект) рядом с прозрачно-чёрным фоном. Наивное усреднение
    # RGB затянуло бы чёрный фон в контур; корректный (premultiplied) даунскейл
    # обязан оставить видимый цвет светлым, а не почернить его на полупрозрачном крае.
    hi = np.zeros((2, 2, 4), dtype=np.uint8)
    hi[0, 0] = (200, 200, 200, 255)  # один субпиксель — объект, три — прозрачный фон

    out = _downsample_rgba(hi, 2)

    assert out.shape == (1, 1, 4)
    # Альфа — среднее по блоку: один из четырёх непрозрачен → ~64.
    assert out[0, 0, 3] == round(255 / 4)
    # Цвет не «утёк» в чёрный от прозрачного фона: остаётся исходным светлым albedo.
    assert tuple(out[0, 0, :3]) == (200, 200, 200)


def test_downsample_factor_one_is_identity():
    arr = np.random.default_rng(0).integers(0, 256, size=(4, 4, 4), dtype=np.uint8)
    assert np.array_equal(_downsample_rgba(arr, 1), arr)


def test_thumbnail_ssaa_default_is_supersampling():
    # Контракт качества MF-471: рендерим крупнее экрана и даунскейлим (SSAA ≥ 2).
    assert THUMBNAIL_SSAA >= 2


def test_generate_previews_writes_both(tmp_path):
    mesh = _dense_sphere(4)
    glb = tmp_path / "preview.glb"
    thumb = tmp_path / "thumb.webp"

    result = generate_previews(mesh, glb, thumb)

    assert result.glb_path == glb and glb.exists()
    assert result.thumbnail_path == thumb and thumb.exists()


def test_canonical_3mf_uses_deflate_not_stored(tmp_path):
    # Требование «сжатый 3MF» (§1 п.5): все части ZIP/OPC — deflate, не stored.
    box = trimesh.creation.box(extents=[10, 20, 30])
    stl = tmp_path / "box.stl"
    box.export(stl)
    out = tmp_path / "box.3mf"
    convert_to_3mf(stl, out)

    assert zip_uses_deflate(out)
    with zipfile.ZipFile(out) as archive:
        for info in archive.infolist():
            assert info.compress_type == zipfile.ZIP_DEFLATED


def test_compressed_3mf_smaller_than_raw_stl(tmp_path):
    # Компрессия контейнера реально уменьшает вес против сырого STL.
    mesh = _dense_sphere(5)  # плотный меш, где выигрыш deflate заметен
    stl = tmp_path / "dense.stl"
    mesh.export(stl)
    out = tmp_path / "dense.3mf"
    convert_to_3mf(stl, out)

    assert out.stat().st_size < stl.stat().st_size


def test_zip_uses_deflate_false_for_stored(tmp_path):
    # Контроль: stored-архив детектируется как НЕ deflate.
    path = tmp_path / "stored.zip"
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("a.txt", "x" * 1000)
    assert not zip_uses_deflate(path)
