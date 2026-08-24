"""Спайк: что `trimesh` реально читает/пишет по каждому формату whitelist.

Не юнит-тесты конвертера (см. `test_convert.py`) — это фактическая проверка
утверждений матрицы `docs/epics/formats.policy.md` § «Матрица форматов».
Каждый тест — заявление вида «формат X даёт данные Y», подтверждённое кодом,
а не предположением. Если тест здесь падает после апгрейда `trimesh` —
матрица в policy.md устарела и должна быть пересмотрена вместе с ней.

Референс: `trimesh==4.12.2` (см. `apps/mesh/uv.lock`).
"""

from __future__ import annotations

import stat
import struct
import zipfile
from pathlib import Path

import numpy as np
import pytest
import trimesh
from format_detect_spike import (
    check_zip_container_safety,
    detect_dxf_ascii,
    detect_dxf_binary,
    detect_gcode,
    detect_gerber,
    detect_step,
    detect_svg,
)


def _unit_triangle_obj() -> trimesh.Trimesh:
    return trimesh.Trimesh(
        vertices=[[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        faces=[[0, 1, 2]],
        process=False,
    )


class TestSTL:
    """STL: геометрия — да; цвет/единицы/сборка — нет."""

    def test_stl_has_no_units_field(self, tmp_path: Path) -> None:
        mesh = _unit_triangle_obj()
        path = tmp_path / "tri.stl"
        mesh.export(path)
        raw = path.read_bytes()
        # Бинарный STL: 80-байтный заголовок + uint32 (кол-во треугольников) +
        # только координаты float32. Ни здесь, ни где-либо в формате нет поля
        # единиц измерения — оно физически отсутствует в спеке STL.
        assert len(raw) == 80 + 4 + 1 * 50
        header = raw[:80]
        assert b"unit" not in header.lower()

    def test_stl_roundtrip_loses_color(self, tmp_path: Path) -> None:
        mesh = _unit_triangle_obj()
        mesh.visual.face_colors = [255, 0, 0, 255]
        path = tmp_path / "tri_colored.stl"
        mesh.export(path)
        loaded = trimesh.load(path, force="mesh")
        # STL не хранит цвет вообще (кроме нестандартного VisCAM/Magics
        # 2-байтного хака в binary STL, который trimesh не пишет и не читает
        # по умолчанию) — после round-trip цвет откатывается на дефолтный.
        assert not np.array_equal(loaded.visual.face_colors[0][:3], [255, 0, 0])


class TestOBJ:
    """OBJ + .mtl: геометрия + материал (базовый цвет) — да; сборка — нет."""

    def test_obj_mtl_color_roundtrip(self, tmp_path: Path) -> None:
        mesh = _unit_triangle_obj()
        mesh.visual = trimesh.visual.TextureVisuals(
            material=trimesh.visual.material.SimpleMaterial(diffuse=[200, 30, 30, 255])
        )
        obj_path = tmp_path / "tri.obj"
        mesh.export(obj_path)
        assert (tmp_path / "tri.obj.mtl").exists() or any(
            p.suffix == ".mtl" for p in tmp_path.iterdir()
        )

        loaded = trimesh.load(obj_path, force="mesh")
        diffuse = np.asarray(loaded.visual.material.diffuse, dtype=float)
        # trimesh реально переносит diffuse-цвет через .mtl туда и обратно.
        assert diffuse[0] > diffuse[1] and diffuse[0] > diffuse[2]

    def test_obj_multi_object_default_load_merges_groups(self, tmp_path: Path) -> None:
        a = trimesh.creation.box(extents=[1, 1, 1])
        b = trimesh.creation.box(extents=[1, 1, 1])
        b.apply_translation([5, 0, 0])
        scene = trimesh.Scene({"part_a": a, "part_b": b})
        obj_path = tmp_path / "assembly.obj"
        scene.export(obj_path)  # экспорт реально пишет два `o `-блока в файл

        # ВАЖНАЯ НАХОДКА: даже с force="scene" загрузчик OBJ по умолчанию
        # (`split_objects=False`) СХЛОПЫВАЕТ оба `o`-блока в одну геометрию —
        # сборка теряется без явного kwarg, а не только при force="mesh".
        loaded_default = trimesh.load(obj_path, force="scene")
        assert len(loaded_default.geometry) == 1

        # Сборка сохраняется, только если явно передать split_objects=True —
        # это должно быть зафиксировано как обязательный параметр конвейера
        # при чтении OBJ-входа, если хотим сохранить мультипарт.
        loaded_split = trimesh.load(obj_path, force="scene", split_objects=True)
        assert len(loaded_split.geometry) == 2

    def test_obj_force_mesh_merges_into_single_geometry(self, tmp_path: Path) -> None:
        a = trimesh.creation.box(extents=[1, 1, 1])
        b = trimesh.creation.box(extents=[1, 1, 1])
        b.apply_translation([5, 0, 0])
        scene = trimesh.Scene({"part_a": a, "part_b": b})
        obj_path = tmp_path / "assembly.obj"
        scene.export(obj_path)

        loaded_forced = trimesh.load(obj_path, force="mesh")
        assert isinstance(loaded_forced, trimesh.Trimesh)
        # force="mesh" схлопывает обе детали в одну геометрию —
        # подтверждает долг force="mesh" из 3mf.storage.md/convert.py.
        assert loaded_forced.vertices.shape[0] == a.vertices.shape[0] + b.vertices.shape[0]


class TestPLY:
    """PLY: геометрия + per-vertex цвет — да; единицы/сборка — нет."""

    def test_ply_per_vertex_color_roundtrip(self, tmp_path: Path) -> None:
        mesh = _unit_triangle_obj()
        mesh.visual.vertex_colors = [
            [255, 0, 0, 255],
            [0, 255, 0, 255],
            [0, 0, 255, 255],
        ]
        path = tmp_path / "tri.ply"
        mesh.export(path)
        loaded = trimesh.load(path, force="mesh")
        colors = loaded.visual.vertex_colors[:, :3]
        # per-vertex цвет реально переживает round-trip через PLY.
        assert list(colors[0]) == [255, 0, 0]
        assert list(colors[1]) == [0, 255, 0]
        assert list(colors[2]) == [0, 0, 255]


class TestGLB:
    """glTF/GLB: геометрия + PBR base color — да; анимация не проверяется (вне whitelist)."""

    def test_glb_pbr_basecolor_roundtrip(self, tmp_path: Path) -> None:
        mesh = _unit_triangle_obj()
        mesh.visual = trimesh.visual.TextureVisuals(
            material=trimesh.visual.material.PBRMaterial(
                baseColorFactor=[0.8, 0.1, 0.1, 1.0]
            )
        )
        path = tmp_path / "tri.glb"
        mesh.export(path)
        loaded = trimesh.load(path, force="mesh")
        base_color = np.asarray(loaded.visual.material.baseColorFactor, dtype=float)
        # PBR baseColorFactor реально переносится через GLB туда и обратно.
        assert base_color[0] > base_color[1]

    def test_glb_multi_node_becomes_scene(self, tmp_path: Path) -> None:
        a = trimesh.creation.box(extents=[1, 1, 1])
        b = trimesh.creation.icosphere(radius=0.5)
        scene = trimesh.Scene({"part_a": a, "part_b": b})
        path = tmp_path / "assembly.glb"
        scene.export(path)
        loaded = trimesh.load(path, force="scene")
        # Многообъектные сцены (сборки) сохраняются в GLB как несколько узлов.
        assert len(loaded.geometry) == 2


class TestThreeMF:
    """3MF: multi-object как отдельная сцена — да, но Materials/Production
    расширения на ЗАПИСЬ через сам `trimesh` НЕ гарантированы (см. ниже) —
    отсюда решение конвейера паковать финальный 3MF через `lib3mf`
    (уже так в `convert.py`), а `trimesh` использовать только на чтение
    входа + геометрическую обработку.
    """

    def test_3mf_multi_object_read_as_scene(self, tmp_path: Path) -> None:
        a = trimesh.creation.box(extents=[1, 1, 1])
        b = trimesh.creation.icosphere(radius=0.5)
        b.apply_translation([3, 0, 0])
        scene = trimesh.Scene({"part_a": a, "part_b": b})
        path = tmp_path / "assembly.3mf"
        scene.export(path)
        loaded = trimesh.load(path, force="scene")
        # Мультиобъектный вход 3MF читается как сцена с раздельными
        # деталями — подтверждает, что мультипарт можно сохранить, если
        # НЕ форсировать force="mesh" при чтении (см. долг в convert.py).
        assert len(loaded.geometry) == 2

    def test_3mf_export_declares_namespace_but_drops_color_data(self, tmp_path: Path) -> None:
        mesh = _unit_triangle_obj()
        mesh.visual.face_colors = [200, 30, 30, 255]
        path = tmp_path / "tri_colored.3mf"
        mesh.export(path)

        import zipfile

        with zipfile.ZipFile(path) as archive:
            model_xml = archive.read("3D/3dmodel.model").decode("utf-8", errors="replace")

        material_ns = "http://schemas.microsoft.com/3dmanufacturing/material/2015/02"
        # ВАЖНАЯ НАХОДКА: голый `trimesh.export(..., "3mf")` объявляет
        # xmlns Materials-расширения на корневом элементе за компанию со
        # всеми остальными (production/beamlattice/slice/securecontent) —
        # ПРОСТАЯ ПРОВЕРКА «namespace-строка встречается в XML» (как делает
        # `convert.validate_3mf()`) НЕ доказывает, что материал реально
        # записан. Реальных элементов расширения (<basematerials>/<m:...>)
        # в выводе нет — цвет молча теряется, несмотря на объявленный ns.
        assert material_ns in model_xml  # namespace объявлен...
        assert "basematerials" not in model_xml  # ...но данных материала нет
        assert 'pid="' not in model_xml  # и ссылок m:pid на группу свойств тоже нет
        # Это подтверждает решение convert.py: финальную упаковку с реальными
        # Materials-данными делает lib3mf, а не сырой trimesh.export.


class TestSTEP:
    """STEP: `trimesh` заявляет loader в реестре, но реально не работает
    без внешней зависимости `cascadio` (BREP-тесселятор), которой нет в
    `apps/mesh` (см. pyproject.toml). Подтверждает решение 3mf.storage.md —
    STEP только Фаза 3, отдельная тесселяционная цепочка (python-occ/FreeCAD),
    не «из коробки» через trimesh.
    """

    def test_step_loader_requires_missing_cascadio_dependency(self) -> None:
        loader = trimesh.exchange.load.mesh_loaders.get("step")
        with pytest.raises(ModuleNotFoundError, match="cascadio"):
            loader(file_obj=None)


class TestAMF:
    """AMF: `trimesh` НЕ регистрирует loader/exporter для AMF вообще —
    вопреки формулировке в 3mf.storage.md «слайсеры/trimesh ещё читают».
    Для нашего стека (только `trimesh`) это неверно: AMF нельзя прочитать
    без дополнительной библиотеки. Меняет рекомендацию п.10 policy —
    AMF не «пассивный вход», а «не поддерживается» на MVP.
    """

    def test_amf_not_in_trimesh_loaders(self) -> None:
        assert "amf" not in trimesh.exchange.load.mesh_loaders
        assert "amf" not in trimesh.exchange.export._mesh_exporters
        assert "amf" not in trimesh.available_formats()


def test_magic_bytes_reference_values(tmp_path: Path) -> None:
    """Байты сигнатур, которые реально пишут экспортёры — основа
    whitelist-таблицы magic bytes в formats.policy.md (не из документации
    форматов «в теории», а из фактического вывода наших же экспортёров/
    типичных генераторов).
    """
    mesh = _unit_triangle_obj()

    stl_path = tmp_path / "m.stl"
    mesh.export(stl_path, file_type="stl")  # бинарный STL по умолчанию
    stl_head = stl_path.read_bytes()[:80]
    assert len(stl_head) == 80  # 80-байтный заголовок; "solid " — только ASCII-вариант

    glb_path = tmp_path / "m.glb"
    mesh.export(glb_path)
    assert glb_path.read_bytes()[:4] == b"glTF"

    threemf_path = tmp_path / "m.3mf"
    mesh.export(threemf_path)
    # 3MF — ZIP/OPC-контейнер, сигнатура — стандартный ZIP local-file-header.
    assert threemf_path.read_bytes()[:4] == b"PK\x03\x04"

    ply_path = tmp_path / "m.ply"
    mesh.export(ply_path)
    assert ply_path.read_bytes()[:3] == b"ply"

    # OBJ/STEP — текстовые форматы, устойчивой бинарной magic-сигнатуры нет;
    # whitelist для них полагается на первые непробельные токены содержимого
    # ("v "/"f "/"mtllib" для OBJ; "ISO-10303-21;" для STEP) + расширение.
    obj_path = tmp_path / "m.obj"
    mesh.export(obj_path)
    obj_head = obj_path.read_text(encoding="utf-8", errors="replace")[:20].lstrip()
    assert obj_head.startswith(("v ", "#"))

    assert struct.calcsize("<I") == 4  # sanity: little-endian uint32 в STL-заголовке треугольников


# --- MF-500: спайк детекторов для класса «артефакт как есть» -------------
#
# Эталонные байты ниже — не выдумка, а типичный вывод реальных генераторов
# каждого формата (комментарий у каждого сэмпла поясняет источник). Детекторы —
# `format_detect_spike.py`, та же логика идёт в таблицу формата в policy.md v0.2
# и в TypeScript-реализацию Back (MF-501). Цель этого блока — доказать
# требование карточки MF-500 п.5: байтовый детект реально отличает форматы и
# не даёт ложных срабатываний друг на друге (G-code/SVG/Gerber/DXF — все
# текстовые, визуально похожи).

_STEP_SAMPLE = (
    b"ISO-10303-21;\n"
    b"HEADER;\n"
    b"FILE_DESCRIPTION((''),'2;1');\n"
    b"ENDSEC;\n"
    b"DATA;\n"
    b"ENDSEC;\n"
    b"END-ISO-10303-21;\n"
)

_DXF_ASCII_SAMPLE = (
    "0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1027\n0\nENDSEC\n"
    "0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n0\n10\n0.0\n20\n0.0\n11\n10.0\n21\n0.0\n"
    "0\nENDSEC\n0\nEOF\n"
)

_SVG_SAMPLE = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">'
    '<rect width="100" height="100"/></svg>\n'
)

# Типичный слайсерный G-code для 3D-принтера (Marlin) — заголовок из
# `;`-комментариев, затем команды без разделителей `%`.
_GCODE_PRINTER_SAMPLE = (
    ";FLAVOR:Marlin\n;TIME:1234\n;Layer height: 0.2\n"
    "G21\nG90\nM82\nG28\nG1 Z5 F5000\nG1 X10 Y10 F3000\nG1 X20 Y10 E5 F1200\n"
    "M107\nM104 S0\n"
)

# Классический Fanuc-стиль ЧПУ: программа обёрнута голыми строками `%` —
# это исторический источник путаницы с Gerber (тоже строки на `%`).
_GCODE_FANUC_PERCENT_SAMPLE = (
    "%\nO0001\nG90 G94 G17 G21 G49 G40 G80\nG54 G0 X0 Y0\nM3 S3000\n"
    "G43 Z25. H1\nG1 Z-1. F150.\nG1 X10.\nG1 Y10.\nM5\nG91 G28 Z0\nM30\n%\n"
)

# RS-274X Gerber — расширенные команды %...*% + statements, оканчивающиеся на *.
_GERBER_SAMPLE = (
    "%FSLAX26Y26*%\n%MOMM*%\n%ADD10C,0.500000*%\n"
    "G04 Layer_1*\nD10*\nX0Y0D02*\nX1000000Y0D01*\nX1000000Y1000000D01*\nM02*\n"
)


class TestNewArtifactSignatures:
    """MF-500: детекторы для STEP/DXF/SVG/G-code/Gerber — true positive."""

    def test_step_detected(self) -> None:
        assert detect_step(_STEP_SAMPLE)

    def test_dxf_ascii_detected(self) -> None:
        assert detect_dxf_ascii(_DXF_ASCII_SAMPLE)

    def test_dxf_binary_detected(self) -> None:
        assert detect_dxf_binary(b"AutoCAD Binary DXF\r\n\x1a\x00\x00\x00rest-of-file")

    def test_svg_detected(self) -> None:
        assert detect_svg(_SVG_SAMPLE)

    def test_svg_detected_with_doctype_and_comment_preamble(self) -> None:
        # Реальные экспортёры (Inkscape/Illustrator) часто добавляют DOCTYPE
        # и/или комментарий перед <svg> — детектор не должен требовать <svg>
        # первым байтом файла.
        text = (
            '<?xml version="1.0"?>\n'
            '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" '
            '"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n'
            "<!-- Generator: Inkscape -->\n"
            '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n'
        )
        assert detect_svg(text)

    def test_gcode_printer_style_detected(self) -> None:
        assert detect_gcode(_GCODE_PRINTER_SAMPLE)

    def test_gcode_fanuc_percent_style_detected(self) -> None:
        assert detect_gcode(_GCODE_FANUC_PERCENT_SAMPLE)

    def test_gerber_detected(self) -> None:
        assert detect_gerber(_GERBER_SAMPLE)


class TestArtifactSignatureCrossFalsePositives:
    """MF-500 п.5: текстовые форматы не должны детектироваться друг как друг.

    Это прямая проверка приёмочного критерия карточки — без неё детект по
    байтам был бы предположением, а не спайком: G-code/SVG/Gerber/DXF на вид
    похожи (строки цифр/букв), и именно здесь легко получить ложное
    срабатывание, которое пробьёт FORMAT_MISMATCH насквозь.
    """

    @pytest.mark.parametrize(
        "sample",
        [_SVG_SAMPLE, _GERBER_SAMPLE, _DXF_ASCII_SAMPLE],
        ids=["svg", "gerber", "dxf_ascii"],
    )
    def test_non_gcode_samples_do_not_trigger_gcode_detector(self, sample: str) -> None:
        assert not detect_gcode(sample)

    @pytest.mark.parametrize(
        "sample",
        [_SVG_SAMPLE, _DXF_ASCII_SAMPLE, _GCODE_PRINTER_SAMPLE],
        ids=["svg", "dxf_ascii", "gcode_printer"],
    )
    def test_non_gerber_samples_do_not_trigger_gerber_detector(self, sample: str) -> None:
        assert not detect_gerber(sample)

    def test_fanuc_percent_gcode_does_not_trigger_gerber_detector(self) -> None:
        # Ключевой кейс: голые `%`-разделители программы ЧПУ похожи на
        # Gerber-обрамление `%...*%`, но Gerber требует РЕАЛЬНУЮ расширенную
        # команду, а не голый `%` — детектор обязан их различать.
        assert not detect_gerber(_GCODE_FANUC_PERCENT_SAMPLE)

    @pytest.mark.parametrize(
        "sample",
        [_GERBER_SAMPLE, _GCODE_PRINTER_SAMPLE, _GCODE_FANUC_PERCENT_SAMPLE],
        ids=["gerber", "gcode_printer", "gcode_fanuc_percent"],
    )
    def test_non_dxf_samples_do_not_trigger_dxf_detector(self, sample: str) -> None:
        assert not detect_dxf_ascii(sample)

    @pytest.mark.parametrize(
        "sample",
        [_GERBER_SAMPLE, _GCODE_PRINTER_SAMPLE, _DXF_ASCII_SAMPLE],
        ids=["gerber", "gcode_printer", "dxf_ascii"],
    )
    def test_non_svg_samples_do_not_trigger_svg_detector(self, sample: str) -> None:
        assert not detect_svg(sample)

    def test_step_signature_does_not_collide_with_other_text_formats(self) -> None:
        for sample in (_SVG_SAMPLE, _GERBER_SAMPLE, _DXF_ASCII_SAMPLE, _GCODE_PRINTER_SAMPLE):
            assert not detect_step(sample.encode("utf-8"))

    def test_disguised_svg_as_gcode_extension_is_rejected(self) -> None:
        # Симулирует атаку из § 1.1: расширению не доверяем. Файл с `.gcode`,
        # но содержимым SVG обязан провалить детект G-code → FORMAT_MISMATCH
        # на стороне валидатора, а не пройти как валидная программа ЧПУ.
        assert not detect_gcode(_SVG_SAMPLE)


class TestZipContainerSafety:
    """MF-500: Gerber-набор и архив кода — непрозрачные ZIP, спайк защиты
    от decompression-bomb/zip-slip/symlink (§8 текущего долга policy.md)."""

    def test_normal_archive_is_safe(self, tmp_path: Path) -> None:
        path = tmp_path / "code.zip"
        with zipfile.ZipFile(path, "w") as zf:
            zf.writestr("firmware/main.c", "int main(void) { return 0; }\n")
            zf.writestr("firmware/readme.txt", "build with make\n")
        assert check_zip_container_safety(path) is None

    def test_path_traversal_entry_is_rejected(self, tmp_path: Path) -> None:
        path = tmp_path / "evil.zip"
        with zipfile.ZipFile(path, "w") as zf:
            zf.writestr("../../etc/passwd", "root:x:0:0\n")
        violation = check_zip_container_safety(path)
        assert violation is not None
        assert violation.reason == "path_traversal"

    def test_absolute_path_entry_is_rejected(self, tmp_path: Path) -> None:
        path = tmp_path / "evil_abs.zip"
        with zipfile.ZipFile(path, "w") as zf:
            zf.writestr("/etc/passwd", "root:x:0:0\n")
        violation = check_zip_container_safety(path)
        assert violation is not None
        assert violation.reason == "path_traversal"

    def test_symlink_entry_is_rejected(self, tmp_path: Path) -> None:
        path = tmp_path / "symlink.zip"
        with zipfile.ZipFile(path, "w") as zf:
            info = zipfile.ZipInfo("link")
            # unix-режим S_IFLNK в старших 16 битах external_attr — так
            # реальные архиваторы (Info-ZIP на unix) кодируют симлинки.
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            zf.writestr(info, "/etc/passwd")
        violation = check_zip_container_safety(path)
        assert violation is not None
        assert violation.reason == "symlink_entry"

    def test_decompression_bomb_ratio_is_rejected(self, tmp_path: Path) -> None:
        path = tmp_path / "bomb.zip"
        # 10 МБ нулей сжимаются в считанные КБ — коэффициент далеко за
        # порог max_ratio=100, типичная сигнатура zip-бомбы одного уровня.
        payload = b"\x00" * (10 * 1024 * 1024)
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("payload.bin", payload)
        violation = check_zip_container_safety(path, max_ratio=100)
        assert violation is not None
        assert violation.reason == "compression_ratio"

    def test_too_many_entries_is_rejected(self, tmp_path: Path) -> None:
        path = tmp_path / "many.zip"
        with zipfile.ZipFile(path, "w") as zf:
            for i in range(50):
                zf.writestr(f"f{i}.txt", "x")
        violation = check_zip_container_safety(path, max_entries=10)
        assert violation is not None
        assert violation.reason == "too_many_entries"
