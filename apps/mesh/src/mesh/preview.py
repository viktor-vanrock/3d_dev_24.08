"""Производные ассеты превью из геометрии, распарсенной trimesh.

Три вещи, все — производные от канонического 3MF (см. `docs/epics/marketplace.md`
§1 п.3–4), НЕ формат хранения:

1. **GLB (binary glTF)** — ассет десктоп/дефолт-вьюера (three.js `GLTFLoader`,
   орбитальный просмотр). Децимация до ~150k треугольников, целевой вес ≤5 МБ.
   Нативный веб-формат: 3MF — ZIP/OPC под слайсеры, парс в браузере тяжёлый.
   S3-ключ `models/{model_id}/preview.glb`, `model_files.role='preview'`.

2. **webp-миниатюра каталога** — offscreen-рендер меша в 3/4-ракурсе на
   прозрачном фоне (слоёный псевдо-3D стек каталога подкладывает свечение/тень
   сам, см. `docs/design/model-preview.md`). Рендер — чистый numpy-растеризатор
   (z-буфер + диффузное освещение): работает headless на VDS без OpenGL/GPU
   и драйверов, что важно для systemd-воркера без дисплея. Тот же ассет служит
   статичным превью ленты на мобильном (MF-433) — canvas там поднимается только
   по тапу на детальной карточке, список/лента живой webgl не грузит.

3. **mobile-preview GLB** — отдельный, гораздо более лёгкий вариант для мобильного
   3D-вьюера (MF-433): «6 МБ GLB» десктопного превью — маленькое по сети, но не
   дёшево в GPU-памяти на телефоне класса 2 ГБ VRAM. Потолок полигонов и байт ниже
   на порядок, тот же экспорт-путь с другим бюджетом. S3-ключ
   `models/{model_id}/preview.mobile.glb`, роль в схеме — заявка Data (MF-466-стиль:
   объект и его revision-scoped publication записывает `revision_worker.py`).

Генерация превью НЕ должна валить конвертацию: воркер ловит `PreviewError` и
оставляет модель `ready` без превью (у фронта есть fallback-постер,
`docs/design/marketplace.full.md` §12).
"""

from __future__ import annotations

import zipfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image

# Цель децимации GLB-ассета вьюера: орбитальный просмотр не требует полного
# полигонажа печатной модели. Порог из архрешения (§1 п.3).
PREVIEW_TARGET_FACES = 150_000
# Жёсткий потолок веса GLB (§1 п.3). Если децимация до 150k его не удержала —
# дожимаем агрессивнее (двоичный поиск по числу треугольников).
PREVIEW_MAX_BYTES = 5 * 1024 * 1024

# Мобильный вариант (MF-433): бюджет считается от GPU-памяти телефона класса
# 2 ГБ VRAM, не от веса файла по сети — «6 МБ GLB маленький по сети ≠ дёшев в
# GPU-памяти» (эпик MF-42). На порядок меньше десктопного потолка: орбитальный
# просмотр пальцем на детальной карточке не требует того же полигонажа, что
# вьюер на десктопе, а плотная геометрия на мобильном GPU реально роняет кадры.
MOBILE_PREVIEW_TARGET_FACES = 30_000
MOBILE_PREVIEW_MAX_BYTES = 1_500_000

# MF-1058: децимация до MOBILE_PREVIEW_TARGET_FACES регулярно скармливается тонким
# «листовым» геометриям (крылья, соты — ровно репро-случаи бага), где quadric
# decimation, устойчивая на объёмных телах, на тонких стенках может развернуть
# нормали части граней (нестабильная квадрика на почти плоских тонких участках).
# Десктопный бюджет (150k) режет те же модели куда мягче — переворотов либо нет,
# либо их доля мала и не видна. GLTFLoader вешает на primitive без материала
# дефолтный `MeshStandardMaterial` с `side: THREE.FrontSide` — заднюю грань не
# рисует вовсе, поэтому развёрнутый патч на тонкой стенке даёт дыру/невидимую
# модель, хотя канвас честно перешёл в `active` (геометрия распарсилась, sampler
# просто ничего не залил). Симптом воспроизводится строго на мобильном бюджете
# и не ловится проверками NaN/degenerate/is_winding_consistent (те смотрят на
# консистентность локальных рёбер, а не на глобальную ориентацию тонкой оболочки).
# Фикс — не бороться с самой децимацией (нет надёжного детектора «сколько граней
# развернулось» дешевле полного рендера), а сделать мобильный ассет терпимым к
# этому классу дефекта: экспортируем его с explicit double-sided материалом,
# чтобы GLTFLoader рисовал обе стороны треугольника независимо от ориентации
# нормали. Десктопный `export_glb` не трогаем — там бюджет мягче и регресса нет,
# double-sided решает symptоm ценой держать в GPU обе стороны, это не бесплатно
# на самом тесном (мобильном) бюджете, поэтому не включаем это по умолчанию.
# Тот же нейтральный матовый серый, что у миниатюры (`_MODEL_ALBEDO` ниже) —
# просто в 0..1 factor-виде, как того требует glTF `baseColorFactor`.
_MOBILE_ALBEDO_FACTOR = (200 / 255.0, 200 / 255.0, 200 / 255.0, 1.0)

# webp-миниатюра каталога: квадрат под слоёный стек `.homeModelLayer*`.
THUMBNAIL_SIZE = 512
# Сглаживание краёв силуэта: рендерим в SSAA-раз крупнее и даунскейлим box-фильтром
# с корректной по альфе усреднялкой (см. `_downsample_rgba`). Без этого контур
# силуэта — «лесенка» из бинарной альфы (0/255); при 2x край получает
# полутона альфы и читается гладким. 2x — компромисс «качество/CPU»: рендер
# растёт ~в 4 раза по пикселям, но растеризатор ограничен числом граней, а не
# площадью, так что реальный оверхед много меньше (см. замеры в результате MF-471).
THUMBNAIL_SSAA = 2
# Растеризатор — чистый Python-цикл по граням; на плотных мешах он линейно
# дорожает. Для 512px-силуэта полный полигонаж не нужен — рендерим с меша,
# уже децимированного под этот порог (визуально миниатюра не отличается).
THUMBNAIL_MAX_FACES = 40_000
# Прозрачный фон — стек каталога сам подкладывает свечение/тень
# (`docs/design/model-preview.md`); токены портала тёмные, но фон рисует CSS, не мы.
_THUMB_BG = (0, 0, 0, 0)
# Матовый нейтральный материал болванки — совпадает с дефолтом конвертера
# (`convert.py` `_DEFAULT_COLOR`), чтобы миниатюра и слайсер выглядели заодно.
_MODEL_ALBEDO = np.array([200, 200, 200], dtype=np.float64)
# 3/4-ракурс: камера чуть сверху-сбоку — «нейтральный ракурс 3/4» из задачи.
_VIEW_AZIMUTH_DEG = 35.0
_VIEW_ELEVATION_DEG = 25.0


class PreviewError(Exception):
    """Не удалось сгенерировать производный ассет превью (GLB/webp)."""


@dataclass(frozen=True)
class PreviewResult:
    """Пути к сгенерированным ассетам превью."""

    glb_path: Path
    thumbnail_path: Path


def _decimate(mesh: trimesh.Trimesh, target_faces: int) -> trimesh.Trimesh:
    """Уменьшает число треугольников до target_faces (если их больше).

    Меши уже под порогом не трогаем — децимация «вверх» бессмысленна и только
    портит геометрию. `fast_simplification` (quadric decimation) — та же
    экосистема trimesh, без внешних бинарей.
    """
    if mesh.faces.shape[0] <= target_faces:
        return mesh
    try:
        return mesh.simplify_quadric_decimation(face_count=target_faces)
    except Exception as exc:  # noqa: BLE001 — сбой децимации = ошибка генерации превью
        raise PreviewError(f"децимация до {target_faces} треугольников не удалась: {exc}") from exc


def _mark_double_sided(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """Возвращает мелкую копию `mesh` с explicit double-sided материалом.

    Не мутирует вход — `_fit_glb_to_budget` передекимирует один и тот же
    исходный `mesh` несколько раз, ему нужна нетронутая геометрия/визуал.
    """
    marked = mesh.copy()
    marked.visual = trimesh.visual.TextureVisuals(
        material=trimesh.visual.material.PBRMaterial(
            baseColorFactor=_MOBILE_ALBEDO_FACTOR,
            metallicFactor=0.0,
            roughnessFactor=1.0,
            doubleSided=True,
        )
    )
    return marked


def _export_glb_bytes(mesh: trimesh.Trimesh, *, double_sided: bool = False) -> bytes:
    if double_sided:
        mesh = _mark_double_sided(mesh)
    try:
        data = mesh.export(file_type="glb")
    except Exception as exc:  # noqa: BLE001
        raise PreviewError(f"GLB-экспорт не удался: {exc}") from exc
    if not isinstance(data, (bytes, bytearray)) or len(data) == 0:
        raise PreviewError("GLB-экспорт вернул пустой результат")
    return bytes(data)


def export_glb(
    mesh: trimesh.Trimesh,
    destination: Path,
    *,
    target_faces: int = PREVIEW_TARGET_FACES,
    max_bytes: int = PREVIEW_MAX_BYTES,
    double_sided: bool = False,
) -> Path:
    """Пишет GLB-ассет: децимация до `target_faces`, гарантия ≤`max_bytes`.

    Сначала децимируем до `target_faces`. Если результат всё ещё тяжелее
    `max_bytes` (плотная/шумная геометрия), понижаем целевое число
    треугольников двоичным поиском, пока не влезем в бюджет или не упрёмся в пол.
    Дефолты — десктопный бюджет вьюера (§1 п.3); мобильный вариант передаёт
    свои, гораздо более тесные пороги и `double_sided=True` (`export_mobile_glb`).
    """
    candidate = _decimate(mesh, target_faces)
    data = _export_glb_bytes(candidate, double_sided=double_sided)

    if len(data) > max_bytes:
        data = _fit_glb_to_budget(mesh, target_faces, max_bytes, double_sided=double_sided)

    destination.write_bytes(data)
    return destination


def export_mobile_glb(mesh: trimesh.Trimesh, destination: Path) -> Path:
    """Пишет мобильный GLB (MF-433): тот же экспорт-путь, тесный VRAM-бюджет.

    Отдельный ассет, не урезанная выдача десктопного preview.glb — мобильный
    вьюер должен грузить именно этот файл, десктопный вариант остаётся
    нетронутым (`export_glb`). `double_sided=True` (MF-1058) — см. комментарий
    у `MOBILE_PREVIEW_TARGET_FACES` про тонкие оболочки и quadric decimation.
    """
    return export_glb(
        mesh,
        destination,
        target_faces=MOBILE_PREVIEW_TARGET_FACES,
        max_bytes=MOBILE_PREVIEW_MAX_BYTES,
        double_sided=True,
    )


def _fit_glb_to_budget(
    mesh: trimesh.Trimesh, target_faces: int, max_bytes: int, *, double_sided: bool = False
) -> bytes:
    """Двоичный поиск по числу треугольников, чтобы GLB влез в `max_bytes`.

    Пол — 5000 треугольников: ниже орбитальный силуэт уже разваливается, лучше
    отдать чуть больше бюджета, чем нечитаемую модель.
    """
    floor_faces = 5_000
    lo, hi = floor_faces, min(mesh.faces.shape[0], target_faces)
    best = _export_glb_bytes(_decimate(mesh, floor_faces), double_sided=double_sided)
    while lo <= hi:
        mid = (lo + hi) // 2
        data = _export_glb_bytes(_decimate(mesh, mid), double_sided=double_sided)
        if len(data) <= max_bytes:
            best = data
            lo = mid + 5_000
        else:
            hi = mid - 5_000
    if len(best) > max_bytes:
        raise PreviewError(
            f"GLB не удалось ужать до {max_bytes} байт даже на {floor_faces} треугольниках"
        )
    return best


def _rotation_matrix(azimuth_deg: float, elevation_deg: float) -> np.ndarray:
    """Матрица поворота мира для камеры (азимут вокруг Z, затем наклон)."""
    az = np.radians(azimuth_deg)
    el = np.radians(elevation_deg)
    rot_z = np.array(
        [[np.cos(az), -np.sin(az), 0.0], [np.sin(az), np.cos(az), 0.0], [0.0, 0.0, 1.0]]
    )
    rot_x = np.array(
        [[1.0, 0.0, 0.0], [0.0, np.cos(el), -np.sin(el)], [0.0, np.sin(el), np.cos(el)]]
    )
    return rot_x @ rot_z


def _render_thumbnail_rgba(mesh: trimesh.Trimesh, size: int) -> np.ndarray:
    """Софт-растеризатор меша в RGBA-массив (H, W, 4), фон прозрачный.

    Ортографическая проекция из 3/4-ракурса, z-буфер, диффузное затенение по
    нормали грани. Без OpenGL — чистый numpy, надёжно работает headless.
    Не претендует на фотореализм: это каталожная миниатюра-силуэт, тяжёлую
    сцену three.js фронт грузит из GLB.
    """
    verts = np.asarray(mesh.vertices, dtype=np.float64)
    faces = np.asarray(mesh.faces, dtype=np.int64)
    if faces.shape[0] == 0:
        raise PreviewError("нельзя отрендерить меш без треугольников")

    # Центрируем модель и поворачиваем под ракурс камеры.
    center = 0.5 * (verts.min(axis=0) + verts.max(axis=0))
    rot = _rotation_matrix(_VIEW_AZIMUTH_DEG, _VIEW_ELEVATION_DEG)
    view = (verts - center) @ rot.T

    # Ортографическое вписывание в кадр с полями.
    xy = view[:, :2]
    extent = np.max(np.abs(xy)) if xy.size else 1.0
    if extent <= 0:
        raise PreviewError("вырожденная геометрия: нулевой габарит на экране")
    margin = 0.9  # 10% поля вокруг силуэта
    scale = (size / 2.0) * margin / extent

    screen_x = view[:, 0] * scale + size / 2.0
    screen_y = -view[:, 1] * scale + size / 2.0  # экранная ось Y вниз
    depth = view[:, 2]  # больше = ближе к камере (сортировка z-буфера)

    # Диффузное освещение: свет из-за плеча камеры (+Z во view-пространстве).
    light_dir = np.array([0.3, 0.4, 1.0])
    light_dir = light_dir / np.linalg.norm(light_dir)
    face_normals = np.asarray(mesh.face_normals, dtype=np.float64) @ rot.T

    rgba = np.zeros((size, size, 4), dtype=np.float64)
    rgba[..., :3] = np.array(_THUMB_BG[:3], dtype=np.float64)
    zbuf = np.full((size, size), -np.inf, dtype=np.float64)

    tri_x = screen_x[faces]
    tri_y = screen_y[faces]
    tri_z = depth[faces]

    ambient = 0.35
    for i in range(faces.shape[0]):
        _rasterize_triangle(
            rgba,
            zbuf,
            tri_x[i],
            tri_y[i],
            tri_z[i],
            face_normals[i],
            light_dir,
            ambient,
            size,
        )

    return np.clip(rgba, 0, 255).astype(np.uint8)


def _rasterize_triangle(
    rgba: np.ndarray,
    zbuf: np.ndarray,
    xs: np.ndarray,
    ys: np.ndarray,
    zs: np.ndarray,
    normal: np.ndarray,
    light_dir: np.ndarray,
    ambient: float,
    size: int,
) -> None:
    """Заливает один треугольник с z-тестом и плоским затенением."""
    min_x = max(int(np.floor(xs.min())), 0)
    max_x = min(int(np.ceil(xs.max())), size - 1)
    min_y = max(int(np.floor(ys.min())), 0)
    max_y = min(int(np.ceil(ys.max())), size - 1)
    if min_x > max_x or min_y > max_y:
        return

    x0, x1, x2 = xs
    y0, y1, y2 = ys
    denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
    if abs(denom) < 1e-9:
        return  # вырожденный треугольник (ребро в профиль)

    ys_grid, xs_grid = np.mgrid[min_y : max_y + 1, min_x : max_x + 1]
    px = xs_grid + 0.5
    py = ys_grid + 0.5

    w0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / denom
    w1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / denom
    w2 = 1.0 - w0 - w1
    inside = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
    if not inside.any():
        return

    frag_z = w0 * zs[0] + w1 * zs[1] + w2 * zs[2]

    sub_z = zbuf[min_y : max_y + 1, min_x : max_x + 1]
    visible = inside & (frag_z > sub_z)
    if not visible.any():
        return

    intensity = ambient + (1.0 - ambient) * max(float(np.dot(normal, light_dir)), 0.0)
    color = _MODEL_ALBEDO * intensity

    sub_rgba = rgba[min_y : max_y + 1, min_x : max_x + 1]
    sub_rgba[visible, 0] = color[0]
    sub_rgba[visible, 1] = color[1]
    sub_rgba[visible, 2] = color[2]
    sub_rgba[visible, 3] = 255.0
    sub_z[visible] = frag_z[visible]


def _downsample_rgba(rgba: np.ndarray, factor: int) -> np.ndarray:
    """Box-даунскейл RGBA в `factor` раз с корректным по альфе усреднением.

    Наивное усреднение RGB через край силуэта затянуло бы прозрачно-чёрный фон
    (RGB=0 при alpha=0) в контур и дало тёмную кайму. Поэтому усредняем
    **предумноженный** цвет (RGB·alpha) и альфу по блоку factor×factor, затем
    восстанавливаем непредумноженный RGB делением на среднюю альфу. Так фоновые
    пиксели с alpha=0 не вносят цвет — только «разбавляют» альфу края, что и даёт
    гладкий полупрозрачный контур вместо «лесенки».
    """
    if factor <= 1:
        return rgba
    h, w, _ = rgba.shape
    out_h, out_w = h // factor, w // factor
    work = rgba[: out_h * factor, : out_w * factor].astype(np.float64)
    # (out_h, factor, out_w, factor, 4) — блоки для усреднения.
    blocks = work.reshape(out_h, factor, out_w, factor, 4)

    alpha = blocks[..., 3:4] / 255.0
    premul = blocks[..., :3] * alpha  # предумноженный цвет
    mean_premul = premul.mean(axis=(1, 3))  # (out_h, out_w, 3)
    mean_alpha = alpha.mean(axis=(1, 3))  # (out_h, out_w, 1)

    out = np.zeros((out_h, out_w, 4), dtype=np.float64)
    nonzero = mean_alpha[..., 0] > 0
    out[nonzero, :3] = mean_premul[nonzero] / mean_alpha[nonzero]
    out[..., 3] = mean_alpha[..., 0] * 255.0
    return np.clip(np.rint(out), 0, 255).astype(np.uint8)


def export_thumbnail(mesh: trimesh.Trimesh, destination: Path, size: int = THUMBNAIL_SIZE) -> Path:
    """Рендерит webp-миниатюру каталога (прозрачный фон) и пишет в файл.

    Сглаживание краёв — SSAA: рендерим в `THUMBNAIL_SSAA`× больше и даунскейлим
    box-фильтром с корректной по альфе усреднялкой (`_downsample_rgba`), чтобы
    контур силуэта был гладким, а не «лесенкой» бинарной альфы. Растеризатор —
    Python-цикл по граням, поэтому плотный меш сперва децимируется до
    `THUMBNAIL_MAX_FACES`: на 512px-силуэте разницы не видно, а рендер не
    деградирует до десятков секунд на промышленных мешах.
    """
    render_mesh = _decimate(mesh, THUMBNAIL_MAX_FACES)
    hi = _render_thumbnail_rgba(render_mesh, size * THUMBNAIL_SSAA)
    rgba = _downsample_rgba(hi, THUMBNAIL_SSAA)
    if not (rgba[..., 3] > 0).any():
        raise PreviewError("миниатюра пуста: модель не попала в кадр")
    image = Image.fromarray(rgba, mode="RGBA")
    try:
        image.save(destination, format="WEBP", lossless=False, quality=90, method=4)
    except Exception as exc:  # noqa: BLE001
        raise PreviewError(f"webp-кодирование не удалось: {exc}") from exc
    return destination


def generate_previews(mesh: trimesh.Trimesh, glb_path: Path, thumbnail_path: Path) -> PreviewResult:
    """Генерирует оба ассета из одной уже распарсенной геометрии.

    Кидает `PreviewError` при любом сбое — воркер обязан поймать и оставить
    модель `ready` без превью (генерация превью не валит конвертацию).
    """
    export_glb(mesh, glb_path)
    export_thumbnail(mesh, thumbnail_path)
    return PreviewResult(glb_path=glb_path, thumbnail_path=thumbnail_path)


def zip_uses_deflate(path: Path) -> bool:
    """True, если ВСЕ части ZIP/OPC (3MF) сжаты deflate, а не stored.

    Требование «сжатый 3MF» (`docs/epics/marketplace.md` §1 п.5): контейнер 3MF —
    это ZIP; убеждаемся, что lib3mf пишет с компрессией, а не хранит как есть.
    """
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        if not infos:
            return False
        return all(info.compress_type == zipfile.ZIP_DEFLATED for info in infos)
