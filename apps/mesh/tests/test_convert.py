import struct
import zipfile
from dataclasses import replace
from pathlib import Path

import lib3mf
import numpy as np
import pytest
import trimesh

from mesh.convert import (
    ConversionError,
    ModelMetadata,
    convert_to_3mf,
    passthrough_3mf,
    validate_3mf,
)
from mesh.derivatives import export_stl
from mesh.errors import RejectCode
from mesh.limits import load_limits


def _fixture_stl(tmp_path: Path) -> Path:
    box = trimesh.creation.box(extents=[10.0, 20.0, 30.0])
    stl = tmp_path / "box.stl"
    box.export(stl)
    return stl


def _fixture_multipart_colored_obj(tmp_path: Path) -> Path:
    """Синтетический эталон «мультипарт + цвет»: два объекта, разный цвет,
    разное положение в пространстве — прокси для реальных многодетальных
    цветных моделей (напр. nier2b, 26 деталей, `3dmake/DEMO.md`), которых нет
    в тестовом корпусе репозитория. Пишем OBJ+MTL руками (не через
    `trimesh.Scene.export`), т.к. экспортёр сцены трогает `scipy`, которого
    нет в зависимостях `apps/mesh` (см. `mesh.convert` — конвейер его тоже
    не требует, только `trimesh`/`numpy`/`lib3mf`).
    """
    box_a = trimesh.creation.box(extents=[10.0, 10.0, 10.0])
    box_b = trimesh.creation.box(extents=[5.0, 5.0, 5.0])
    box_b.apply_translation([20.0, 0.0, 0.0])

    mtl_path = tmp_path / "multi.mtl"
    mtl_path.write_text("newmtl red\nKd 1.0 0.0 0.0\n\nnewmtl green\nKd 0.0 1.0 0.0\n")

    lines = ["mtllib multi.mtl"]
    offset = 0
    for name, mesh, material in (("partA", box_a, "red"), ("partB", box_b, "green")):
        lines.append(f"o {name}")
        lines.append(f"usemtl {material}")
        for v in mesh.vertices:
            lines.append(f"v {v[0]} {v[1]} {v[2]}")
        for f in mesh.faces:
            lines.append("f " + " ".join(str(i + 1 + offset) for i in f))
        offset += len(mesh.vertices)

    obj_path = tmp_path / "multi.obj"
    obj_path.write_text("\n".join(lines) + "\n")
    return obj_path


def _fixture_obj_with_duplicate_vertices_and_hole(tmp_path: Path) -> Path:
    """Куб с двумя явно продублированными вершинами и выброшенной гранью
    (простая дыра) — источник, который нужно почистить перед экспортом.
    """
    box = trimesh.creation.box(extents=[10.0, 10.0, 10.0])
    duplicated_vertices = np.vstack([box.vertices, box.vertices[:2]])
    faces = box.faces[:-1]

    lines = [f"v {v[0]} {v[1]} {v[2]}" for v in duplicated_vertices]
    lines += ["f " + " ".join(str(i + 1) for i in f) for f in faces]

    obj_path = tmp_path / "holey.obj"
    obj_path.write_text("\n".join(lines) + "\n")
    return obj_path


def _read_mesh_objects(path: Path):
    """(число mesh-объектов, число build item'ов, набор цветов) — через lib3mf."""
    wrapper = lib3mf.Wrapper()
    model = wrapper.CreateModel()
    reader = model.QueryReader("3mf")
    reader.ReadFromFile(str(path))

    objects = model.GetMeshObjects()
    object_count = 0
    colors = set()
    while objects.MoveNext():
        mesh_object = objects.GetCurrentMeshObject()
        object_count += 1
        resource_id, property_id, has_property = mesh_object.GetObjectLevelProperty()
        assert has_property
        group = model.GetResourceByID(resource_id)
        color = group.GetDisplayColor(property_id)
        colors.add((color.Red, color.Green, color.Blue, color.Alpha))

    items = model.GetBuildItems()
    item_count = 0
    while items.MoveNext():
        item_count += 1

    return object_count, item_count, colors


def test_stl_to_3mf_produces_valid_package(tmp_path):
    stl = _fixture_stl(tmp_path)
    out = tmp_path / "box.3mf"

    convert_to_3mf(stl, out)

    assert out.exists()
    assert zipfile.is_zipfile(out)
    # Не кидает — значит Core+Materials+Production namespaces на месте.
    validate_3mf(out)

    with zipfile.ZipFile(out) as archive:
        names = set(archive.namelist())
        assert "[Content_Types].xml" in names
        assert "_rels/.rels" in names
        assert "3D/3dmodel.model" in names


def test_bbox_matches_source_extents(tmp_path):
    stl = _fixture_stl(tmp_path)
    out = tmp_path / "box.3mf"

    result = convert_to_3mf(stl, out)

    assert result.bbox["unit"] == "mm"
    # Автоориентация (MF-827) может повернуть сборку на устойчивую грань —
    # габариты остаются той же тройкой чисел, но не обязательно в исходном
    # порядке осей источника.
    assert sorted(result.bbox["size"]) == pytest.approx([10.0, 20.0, 30.0], abs=1e-3)


def test_conversion_orients_model_bottom_to_floor(tmp_path):
    """MF-827: источник, экспортированный «на боку» (частый случай кривого
    CAD-экспорта), после конвертации стоит устойчиво дном к полу — самая
    большая грань лежит на Z=0, а не висит под произвольным углом.
    """
    box = trimesh.creation.box(extents=[10.0, 20.0, 40.0])
    box.apply_transform(trimesh.transformations.rotation_matrix(np.radians(37), [1, 0, 0]))
    stl = tmp_path / "tilted.stl"
    box.export(stl)
    out = tmp_path / "tilted.3mf"

    result = convert_to_3mf(stl, out)

    assert result.bbox["min"][2] == pytest.approx(0.0, abs=1e-3)

    reloaded = trimesh.load(out, force="mesh")
    floor_vertices = reloaded.vertices[reloaded.vertices[:, 2] < 1e-3]
    # Устойчивая грань — плоскость, не одна точка/ребро: у box'а на полу лежит
    # как минимум целая четырёхугольная грань.
    assert len(floor_vertices) >= 4


def test_converted_3mf_reopens_in_trimesh(tmp_path):
    # Прокси-проверка «открывается сторонним инструментом»: 3MF снова читается как меш.
    stl = _fixture_stl(tmp_path)
    out = tmp_path / "box.3mf"
    convert_to_3mf(stl, out)

    reloaded = trimesh.load(out, force="mesh")
    assert reloaded.faces.shape[0] > 0


def test_passthrough_3mf_validates_and_copies(tmp_path):
    stl = _fixture_stl(tmp_path)
    canonical = tmp_path / "canonical.3mf"
    convert_to_3mf(stl, canonical)  # получаем валидный 3MF как «входной»

    out = tmp_path / "passthrough.3mf"
    result = passthrough_3mf(canonical, out)

    assert out.exists()
    assert out.read_bytes() == canonical.read_bytes()
    # passthrough не режет геометрию — источник (canonical) уже сориентирован
    # автоориентацией convert_to_3mf выше, порядок осей передаётся как есть.
    assert sorted(result.bbox["size"]) == pytest.approx([10.0, 20.0, 30.0], abs=1e-3)


def test_convert_rejects_garbage_source(tmp_path):
    junk = tmp_path / "broken.stl"
    junk.write_bytes(b"not an stl file at all")
    out = tmp_path / "broken.3mf"

    with pytest.raises(ConversionError):
        convert_to_3mf(junk, out)


def test_passthrough_rejects_non_zip(tmp_path):
    fake = tmp_path / "fake.3mf"
    fake.write_bytes(b"definitely not a zip")
    out = tmp_path / "out.3mf"

    with pytest.raises(ConversionError):
        passthrough_3mf(fake, out)


def test_multipart_colored_source_preserves_parts_and_colors(tmp_path):
    # MF-376: round-trip на эталонной мультипарт-цветной модели — force="mesh"
    # больше не схлопывает сцену, каждая деталь остаётся своим build item'ом
    # (Production) со своим базовым материалом (Materials).
    obj = _fixture_multipart_colored_obj(tmp_path)
    out = tmp_path / "multi.3mf"

    result = convert_to_3mf(obj, out)

    validate_3mf(out)
    object_count, item_count, colors = _read_mesh_objects(out)
    assert object_count == 2
    assert item_count == 2
    assert colors == {(255, 0, 0, 255), (0, 255, 0, 255)}
    assert result.bbox["unit"] == "mm"


def test_multipart_source_reopens_as_scene_with_two_geometries(tmp_path):
    # Прокси «открывается сторонним инструментом, сборка не потеряна»:
    # без force="mesh" trimesh тоже видит Scene из двух геометрий.
    obj = _fixture_multipart_colored_obj(tmp_path)
    out = tmp_path / "multi.3mf"
    convert_to_3mf(obj, out)

    reloaded = trimesh.load(out)
    assert isinstance(reloaded, trimesh.Scene)
    assert len(reloaded.geometry) == 2


def test_multipart_canonical_exports_nonempty_stl(tmp_path):
    # Критерий «экспорт STL из того же 3MF валиден» — деталь MF-377/derivatives.
    obj = _fixture_multipart_colored_obj(tmp_path)
    canonical = tmp_path / "multi.3mf"
    convert_to_3mf(obj, canonical)

    stl_out = tmp_path / "multi_export.stl"
    export_stl(canonical, stl_out)

    assert stl_out.exists() and stl_out.stat().st_size > 0
    reloaded = trimesh.load(stl_out, force="mesh")
    assert reloaded.faces.shape[0] > 0


def test_repair_merges_duplicate_vertices_and_fills_hole(tmp_path):
    obj = _fixture_obj_with_duplicate_vertices_and_hole(tmp_path)
    out = tmp_path / "holey.3mf"

    convert_to_3mf(obj, out)

    reloaded = trimesh.load(out, force="mesh")
    unique_coords = {tuple(row) for row in np.round(reloaded.vertices, 6)}
    # Источник нёс 2 явно продублированные вершины — в каноне дублей не остаётся.
    assert len(unique_coords) == len(reloaded.vertices)
    # Одна выброшенная грань — простая треугольная дыра, fill_holes её латает.
    assert reloaded.is_watertight


def test_suspiciously_small_source_scaled_assuming_inches(tmp_path):
    # STL безразмерен; габарит < 5 (наш порог) для печатной детали неправдоподобен —
    # эвристика считает источник в дюймах и приводит к мм (×25.4).
    box = trimesh.creation.box(extents=[1.0, 2.0, 3.0])
    stl = tmp_path / "tiny.stl"
    box.export(stl)
    out = tmp_path / "tiny.3mf"

    result = convert_to_3mf(stl, out)

    assert result.bbox["unit"] == "mm"
    # Автоориентация (MF-827) может переставить оси — проверяем набор габаритов.
    assert sorted(result.bbox["size"]) == pytest.approx([25.4, 50.8, 76.2], abs=1e-3)


def test_convert_rejects_empty_file_with_structured_code(tmp_path):
    empty = tmp_path / "empty.stl"
    empty.write_bytes(b"")
    out = tmp_path / "empty.3mf"

    with pytest.raises(ConversionError) as exc_info:
        convert_to_3mf(empty, out)

    assert exc_info.value.code == RejectCode.EMPTY_FILE


def test_convert_rejects_truncated_binary_stl_with_structured_code(tmp_path):
    header = b"MF-378 truncated".ljust(80, b"\x00")
    triangle = struct.pack("<12fH", 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0)
    # Заявлено 5 треугольников, реально записан только 1 — усечённый бинарный STL.
    truncated = tmp_path / "truncated.stl"
    truncated.write_bytes(header + struct.pack("<I", 5) + triangle)
    out = tmp_path / "truncated.3mf"

    with pytest.raises(ConversionError) as exc_info:
        convert_to_3mf(truncated, out)

    assert exc_info.value.code == RejectCode.TRUNCATED


def test_convert_rejects_stl_over_triangle_limit(tmp_path):
    stl = _fixture_stl(tmp_path)
    out = tmp_path / "box.3mf"
    limits = replace(load_limits(), max_triangles=1)  # куб — 12 треугольников

    with pytest.raises(ConversionError) as exc_info:
        convert_to_3mf(stl, out, limits=limits)

    assert exc_info.value.code == RejectCode.TOO_MANY_TRIANGLES


def test_passthrough_rejects_zip_bomb_with_structured_code(tmp_path):
    bomb = tmp_path / "bomb.3mf"
    with zipfile.ZipFile(bomb, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", b"<a/>")
        archive.writestr("3D/3dmodel.model", b"\x00" * (50 * 1024 * 1024))
    out = tmp_path / "out.3mf"
    limits = replace(load_limits(), max_zip_compression_ratio=10.0)

    with pytest.raises(ConversionError) as exc_info:
        passthrough_3mf(bomb, out, limits=limits)

    assert exc_info.value.code == RejectCode.ZIP_BOMB


def test_passthrough_rejects_path_traversal_with_structured_code(tmp_path):
    traversal = tmp_path / "traversal.3mf"
    with zipfile.ZipFile(traversal, "w") as archive:
        archive.writestr("[Content_Types].xml", b"<a/>")
        archive.writestr("3D/3dmodel.model", b"<b/>")
        archive.writestr("../../etc/passwd", b"pwned")
    out = tmp_path / "out.3mf"

    with pytest.raises(ConversionError) as exc_info:
        passthrough_3mf(traversal, out)

    assert exc_info.value.code == RejectCode.PATH_TRAVERSAL


# ---- Фаза 2 (MF-379): единицы, диагностика/починка, метадата, thumbnail ----


def _fixture_obj_with_inverted_face(tmp_path: Path) -> Path:
    """Куб с одной гранью в обратной намотке — источник с «разрывом намотки»."""
    box = trimesh.creation.box(extents=[10.0, 10.0, 10.0])
    faces = box.faces.copy()
    faces[0] = faces[0][::-1]

    lines = [f"v {v[0]} {v[1]} {v[2]}" for v in box.vertices]
    lines += ["f " + " ".join(str(i + 1) for i in f) for f in faces]

    obj_path = tmp_path / "inverted.obj"
    obj_path.write_text("\n".join(lines) + "\n")
    return obj_path


def _fixture_obj_with_duplicate_faces(tmp_path: Path) -> Path:
    box = trimesh.creation.box(extents=[10.0, 10.0, 10.0])
    faces = np.vstack([box.faces, box.faces[:2]])

    lines = [f"v {v[0]} {v[1]} {v[2]}" for v in box.vertices]
    lines += ["f " + " ".join(str(i + 1) for i in f) for f in faces]

    obj_path = tmp_path / "duplicate.obj"
    obj_path.write_text("\n".join(lines) + "\n")
    return obj_path


def test_explicit_unit_cm_scales_deterministically(tmp_path):
    box = trimesh.creation.box(extents=[10.0, 20.0, 30.0])
    stl = tmp_path / "box.stl"
    box.export(stl)
    out = tmp_path / "box.3mf"

    result = convert_to_3mf(stl, out, unit="cm")

    # Автоориентация (MF-827) может переставить оси — проверяем набор габаритов.
    assert sorted(result.bbox["size"]) == pytest.approx([100.0, 200.0, 300.0], abs=1e-3)


def test_explicit_unit_m_scales_deterministically(tmp_path):
    box = trimesh.creation.box(extents=[0.01, 0.02, 0.03])
    stl = tmp_path / "box.stl"
    box.export(stl)
    out = tmp_path / "box.3mf"

    result = convert_to_3mf(stl, out, unit="m")

    assert sorted(result.bbox["size"]) == pytest.approx([10.0, 20.0, 30.0], abs=1e-3)


def test_explicit_unit_in_scales_deterministically(tmp_path):
    box = trimesh.creation.box(extents=[1.0, 2.0, 3.0])
    stl = tmp_path / "box.stl"
    box.export(stl)
    out = tmp_path / "box.3mf"

    result = convert_to_3mf(stl, out, unit="in")

    assert sorted(result.bbox["size"]) == pytest.approx([25.4, 50.8, 76.2], abs=1e-3)


def test_explicit_unit_overrides_inch_heuristic_regression(tmp_path):
    # Регресс «модель в 1000х масштабе»: источник маленький (1мм куб — сам по
    # себе похож на кандидата для эвристики «наверное дюймы»), но единицы
    # заявлены явно ("cm") — детерминированный множитель должен победить
    # эвристику, иначе печать выйдет в 25.4/10 раз не в том масштабе.
    box = trimesh.creation.box(extents=[1.0, 1.0, 1.0])
    stl = tmp_path / "tiny.stl"
    box.export(stl)
    out = tmp_path / "tiny.3mf"

    result = convert_to_3mf(stl, out, unit="cm")

    assert result.bbox["size"] == pytest.approx([10.0, 10.0, 10.0], abs=1e-3)


def test_unknown_unit_flag_rejected_with_structured_code(tmp_path):
    stl = _fixture_stl(tmp_path)
    out = tmp_path / "box.3mf"

    with pytest.raises(ConversionError) as exc_info:
        convert_to_3mf(stl, out, unit="furlong")

    assert exc_info.value.code == RejectCode.UNKNOWN_UNIT


def test_strict_mode_reports_hole_without_repairing(tmp_path):
    obj = _fixture_obj_with_duplicate_vertices_and_hole(tmp_path)
    out = tmp_path / "holey.3mf"

    result = convert_to_3mf(obj, out, mode="strict")

    assert len(result.reports) == 1
    report = result.reports[0]
    assert report.mode == "strict"
    assert report.after is None
    assert report.before.watertight is False
    assert report.before.hole_count >= 1

    # strict не чинит — читаем обратно и убеждаемся, что дыра осталась.
    reloaded = trimesh.load(out, force="mesh")
    assert not reloaded.is_watertight


def test_strict_mode_reports_duplicate_face_indices(tmp_path):
    obj = _fixture_obj_with_duplicate_faces(tmp_path)
    out = tmp_path / "dup.3mf"

    result = convert_to_3mf(obj, out, mode="strict")

    report = result.reports[0]
    assert len(report.before.duplicate_face_indices) == 2


def test_strict_mode_reports_winding_inconsistency(tmp_path):
    obj = _fixture_obj_with_inverted_face(tmp_path)
    out = tmp_path / "inverted.3mf"

    result = convert_to_3mf(obj, out, mode="strict")

    report = result.reports[0]
    assert report.before.winding_consistent is False
    assert report.before.winding_flipped_face_indices  # непусто


def test_repair_mode_report_shows_before_after_fix(tmp_path):
    obj = _fixture_obj_with_duplicate_vertices_and_hole(tmp_path)
    out = tmp_path / "holey.3mf"

    result = convert_to_3mf(obj, out, mode="repair")

    report = result.reports[0]
    assert report.mode == "repair"
    assert report.before.watertight is False
    assert report.after is not None
    assert report.after.watertight is True


def test_repair_rejects_mesh_over_budget_with_structured_code(tmp_path):
    stl = _fixture_stl(tmp_path)
    out = tmp_path / "box.3mf"
    limits = replace(load_limits(), max_repair_triangles=1)  # куб — 12 треугольников

    with pytest.raises(ConversionError) as exc_info:
        convert_to_3mf(stl, out, mode="repair", limits=limits)

    assert exc_info.value.code == RejectCode.TOO_EXPENSIVE_TO_REPAIR


def test_strict_mode_ignores_repair_budget(tmp_path):
    # strict не чинит — бюджет починки на неё не должен распространяться.
    stl = _fixture_stl(tmp_path)
    out = tmp_path / "box.3mf"
    limits = replace(load_limits(), max_repair_triangles=1)

    result = convert_to_3mf(stl, out, mode="strict", limits=limits)

    assert out.exists()
    # Дорогие поля (shell_count/winding-проба) выше бюджета пропущены (None),
    # дешёвые (watertight/degenerate/duplicate/hole_count) остаются на месте.
    assert result.reports[0].before.shell_count is None


def test_metadata_round_trips_through_lib3mf(tmp_path):
    stl = _fixture_stl(tmp_path)
    out = tmp_path / "box.3mf"
    metadata = ModelMetadata(
        title="Тестовая деталь",
        author="Mesh Agent",
        license="CC-BY-4.0",
        model_id="model-123",
        source="upload:test",
    )

    convert_to_3mf(stl, out, metadata=metadata)

    wrapper = lib3mf.Wrapper()
    model = wrapper.CreateModel()
    reader = model.QueryReader("3mf")
    reader.ReadFromFile(str(out))
    group = model.GetMetaDataGroup()
    values = {}
    for i in range(group.GetMetaDataCount()):
        entry = group.GetMetaData(i)
        values[(entry.GetNameSpace(), entry.GetName())] = entry.GetValue()

    assert values[("", "Title")] == "Тестовая деталь"
    assert values[("", "Designer")] == "Mesh Agent"
    assert values[("", "LicenseTerms")] == "CC-BY-4.0"
    assert values[("https://3mf.tech/metadata/2026", "ModelId")] == "model-123"
    assert values[("https://3mf.tech/metadata/2026", "Source")] == "upload:test"


def test_no_metadata_writes_nothing(tmp_path):
    """Без `ModelMetadata` не пишутся Core/маркетплейс-поля — но toolchain-версии
    (MF-380) пишутся всегда, воспроизводимость не опциональна."""
    stl = _fixture_stl(tmp_path)
    out = tmp_path / "box.3mf"

    convert_to_3mf(stl, out)

    wrapper = lib3mf.Wrapper()
    model = wrapper.CreateModel()
    reader = model.QueryReader("3mf")
    reader.ReadFromFile(str(out))
    group = model.GetMetaDataGroup()
    names = {(group.GetMetaData(i).GetNameSpace(), group.GetMetaData(i).GetName())
             for i in range(group.GetMetaDataCount())}
    assert not any(ns == "" for ns, _ in names)
    assert not any(name in ("ModelId", "Source") for _, name in names)
    assert any(name.startswith("Toolchain.") for _, name in names)


def test_toolchain_versions_written_to_metadata_and_result(tmp_path):
    stl = _fixture_stl(tmp_path)
    out = tmp_path / "box.3mf"

    result = convert_to_3mf(stl, out)

    assert result.duration_ms >= 0.0
    assert "trimesh" in result.toolchain_versions
    assert "lib3mf" in result.toolchain_versions

    wrapper = lib3mf.Wrapper()
    model = wrapper.CreateModel()
    reader = model.QueryReader("3mf")
    reader.ReadFromFile(str(out))
    group = model.GetMetaDataGroup()
    values = {}
    for i in range(group.GetMetaDataCount()):
        entry = group.GetMetaData(i)
        values[(entry.GetNameSpace(), entry.GetName())] = entry.GetValue()
    key = ("https://3mf.tech/metadata/2026", "Toolchain.trimesh")
    assert values[key] == result.toolchain_versions["trimesh"]


def test_thumbnail_embedded_with_opc_relationship(tmp_path):
    stl = _fixture_stl(tmp_path)
    out = tmp_path / "box.3mf"

    convert_to_3mf(stl, out, thumbnail=True)

    with zipfile.ZipFile(out) as archive:
        names = set(archive.namelist())
        assert "Metadata/thumbnail.png" in names
        rels = archive.read("_rels/.rels").decode()
        assert "package/2006/relationships/metadata/thumbnail" in rels
        assert "/Metadata/thumbnail.png" in rels
        png_bytes = archive.read("Metadata/thumbnail.png")
        assert png_bytes[:8] == b"\x89PNG\r\n\x1a\n"

    wrapper = lib3mf.Wrapper()
    model = wrapper.CreateModel()
    reader = model.QueryReader("3mf")
    reader.ReadFromFile(str(out))
    assert model.HasPackageThumbnailAttachment()


def test_thumbnail_can_be_disabled(tmp_path):
    stl = _fixture_stl(tmp_path)
    out = tmp_path / "box.3mf"

    convert_to_3mf(stl, out, thumbnail=False)

    with zipfile.ZipFile(out) as archive:
        assert "Metadata/thumbnail.png" not in archive.namelist()


def test_multipart_objects_get_unique_production_uuids(tmp_path):
    obj = _fixture_multipart_colored_obj(tmp_path)
    out = tmp_path / "multi.3mf"

    convert_to_3mf(obj, out)

    wrapper = lib3mf.Wrapper()
    model = wrapper.CreateModel()
    reader = model.QueryReader("3mf")
    reader.ReadFromFile(str(out))

    object_uuids = set()
    objects = model.GetMeshObjects()
    while objects.MoveNext():
        has_uuid, object_uuid = objects.GetCurrentMeshObject().GetUUID()
        assert has_uuid
        object_uuids.add(object_uuid)
    assert len(object_uuids) == 2

    item_uuids = set()
    items = model.GetBuildItems()
    while items.MoveNext():
        has_uuid, item_uuid = items.GetCurrent().GetUUID()
        assert has_uuid
        item_uuids.add(item_uuid)
    assert len(item_uuids) == 2
