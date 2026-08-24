"""Ветка scan: сборка модели из фотографий предмета — фотограмметрия, не генерация.

Отличие от `trellis` принципиальное, и его стоит держать в голове при любой правке здесь.
`trellis` ДОРИСОВЫВАЕТ форму: по двум-трём картинкам нейросеть придумывает правдоподобный
объём, и предмет на выходе похож на задуманный, но не равен никакому настоящему. Здесь
форма ИЗМЕРЯЕТСЯ: COLMAP находит одни и те же точки на разных снимках, по ним восстанавливает
положение каждой камеры и триангулирует поверхность. Поэтому и требование к съёмке другое —
не ракурсы, а десятки кадров с перекрытием, снятых обходом вокруг предмета.

Считает не VDS: плотный этап (patch match stereo) — это CUDA, и живёт он на HYPERPC рядом с
ComfyUI, отдельным сервисом `scan` (`C:\\photogrammetry\\scanserver.py`, порт 8190, тот же
приём, что `comfyui_client` — HTTP поверх Tailscale).

Масштаб. Одни фотографии не дают абсолютного размера: увеличенный вдвое предмет, снятый
вдвое дальше, выглядит одинаково. Но приложение шлёт вместе с кадрами позы камеры из ARKit
(manifest.json в том же префиксе), и сервис сборки восстанавливает по ним настоящий размер —
тогда меш приходит уже в миллиметрах и трогать его масштаб НЕЛЬЗЯ. Без манифеста — прежнее
приведение к 80 мм, как в `trellis`.
"""

from __future__ import annotations

import io
import logging
import os
import time
import zipfile

import httpx
import trimesh

from .. import storage
from ..config import load_s3_config
from . import comfyui_client
from .base import NOOP_REPORTER, GenerationError, GenerationJob, GenerationResult, ProgressReporter
from .trellis import (
    _build_multiview_workflow,
    _build_result,
    _job_seed,
    _load_mesh,
    _rescale,
    _running_progress,
    _safe_prefix,
    _target_size_mm,
)

logger = logging.getLogger("giga.branches.scan")

_DEFAULT_URL = "http://100.74.48.83:8190"
# Час — потолок самого сервиса сборки; здесь чуть больше, чтобы отличать «сервис ещё считает»
# от «сервис умер и никогда не ответит».
_MAX_WAIT_SECONDS = 70 * 60
_POLL_SECONDS = 10
_ESTIMATED_SECONDS = 25 * 60
_MAX_MESH_BYTES = 200 * 1024 * 1024


def _service_url() -> str:
    return os.getenv("SCAN_SERVICE_URL", _DEFAULT_URL).rstrip("/")


def run_scan(job: GenerationJob, report: ProgressReporter = NOOP_REPORTER) -> GenerationResult:
    """phase: loading (забрать кадры и отдать их на сборку) → geometry (сама фотограмметрия)
    → validation (аудит меша) → export."""
    scan_id = str(job.params.get("scan_id") or "").strip()
    if not scan_id:
        raise GenerationError("scan: в задании нет scan_id — нечего собирать")

    s3_config = load_s3_config()
    if s3_config is None:
        raise GenerationError(
            "scan: S3 не сконфигурирован (S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY)"
        )
    store = storage.ObjectStore(s3_config)

    report("loading", 5, eta_seconds=_ESTIMATED_SECONDS)
    prefix = storage.scan_photo_prefix(scan_id)
    keys = store.list_keys(prefix)
    if not keys:
        raise GenerationError("scan: кадры не доехали в хранилище")

    # Нейро-уровень: телефонам, которым обход не по силам, форму дорисовывает TRELLIS по
    # 2–3 ракурсам. Это набросок, а не обмер — путь другой, очередь и артефакты общие.
    if str(job.params.get("mode") or "") == "neural":
        result = _run_neural(job, store, prefix, keys, report)
        try:
            store.delete_prefix(prefix)
        except Exception:  # noqa: BLE001 — уборка не повод завалить готовую генерацию
            logger.warning("scan: не удалось убрать кадры %s", prefix, exc_info=True)
        return result

    # Архив собираем в памяти: сотня уменьшенных до 2000 точек кадров — это десятки мегабайт,
    # и лишний файл на диске VDS ради них заводить незачем.
    package = io.BytesIO()
    with zipfile.ZipFile(package, "w", zipfile.ZIP_STORED) as zf:
        for key in keys:
            zf.writestr(key.rsplit("/", 1)[-1], store.download_bytes(key))
    package.seek(0)

    report("loading", 15, eta_seconds=_ESTIMATED_SECONDS)
    remote_id = _submit(package.getvalue())

    glb_bytes, scale_mode = _await_mesh(remote_id, report)

    report("validation", 95)
    if len(glb_bytes) > _MAX_MESH_BYTES:
        raise GenerationError(f"scan: меш слишком большой ({len(glb_bytes)} байт)")

    mesh = _load_mesh(glb_bytes)
    mesh = _largest_part(mesh)
    if scale_mode == "metric":
        # Размер настоящий, восстановлен из поз камеры — приведение к 80 мм его бы уничтожило.
        logger.info(
            "scan: метрический масштаб, габарит %s мм",
            [round(float(value), 1) for value in mesh.extents],
        )
    else:
        _rescale(mesh, _target_size_mm(job.params))

    report("export", 98)
    result = _build_result(mesh)

    # Кадры больше не нужны — модель собрана. Держать сотню снимков чужого предмета «на
    # всякий случай» незачем: пересобирать из них мы не умеем, а место и приватность реальны.
    try:
        store.delete_prefix(prefix)
    except Exception:  # noqa: BLE001 — уборка не повод завалить готовую генерацию
        logger.warning("scan: не удалось убрать кадры %s", prefix, exc_info=True)

    return result


def _run_neural(
    job: GenerationJob,
    store: storage.ObjectStore,
    prefix: str,
    keys: list[str],
    report: ProgressReporter,
) -> GenerationResult:
    """Ракурсы → TRELLIS.2 (мультивью-нода ComfyUI) → меш. Тот же граф, что у текстовой ветки
    trellis, только картинки настоящие, снятые телефоном, а не нарисованные по запросу.

    Порядок кадров — договор с приложением: спереди → сбоку → сзади. Нода понимает виды
    front/left/back/right — раскладываем по порядку съёмки.
    """
    config = comfyui_client.load_config()
    if config is None:
        raise GenerationError("scan: ComfyUI не сконфигурирован (COMFYUI_URL)")

    photo_keys = [k for k in keys if k.rsplit("/", 1)[-1].endswith(".jpg")][:4]
    if len(photo_keys) < 2:
        raise GenerationError("scan: нейронке нужно хотя бы два ракурса")

    views = ["front", "left", "back", "right"]
    view_images: dict[str, str] = {}
    for index, key in enumerate(photo_keys):
        content = store.download_bytes(key)
        view_images[views[index]] = comfyui_client.upload_image(config, content, "image/jpeg")

    report("loading", 15, eta_seconds=240)
    workflow = _build_multiview_workflow(view_images, _safe_prefix(job.id), _job_seed(job.id))

    submitted_at = time.time()

    def _on_tick(elapsed_seconds: float) -> None:
        progress, eta_seconds = _running_progress(elapsed_seconds)
        report("geometry", progress, eta_seconds=eta_seconds)

    try:
        comfyui_client.submit_and_wait_with_retry(config, workflow, on_tick=_on_tick)
        glb_bytes = comfyui_client.locate_export(
            config,
            filename_prefix=_safe_prefix(job.id),
            file_format="glb",
            submitted_at=submitted_at,
            completed_at=time.time(),
        )
    except comfyui_client.ComfyUIError as exc:
        raise GenerationError(f"scan: {exc}") from exc

    report("validation", 95)
    mesh = _load_mesh(glb_bytes)
    mesh = _largest_part(mesh)
    # У наброска настоящего размера нет по определению — приводим к целевому, как trellis.
    _rescale(mesh, _target_size_mm(job.params))
    report("export", 98)
    return _build_result(mesh)


def _submit(archive: bytes) -> str:
    try:
        response = httpx.post(
            f"{_service_url()}/reconstruct",
            files={"archive": ("photos.zip", archive, "application/zip")},
            timeout=httpx.Timeout(300.0, connect=10.0),
        )
    except httpx.HTTPError as exc:
        raise GenerationError(f"scan: сервис сборки недоступен ({exc})") from exc

    if response.status_code == 422:
        # Сервис отказал по существу (мало кадров, битый архив) — его формулировка человеку
        # понятнее нашей.
        raise GenerationError(f"scan: {_detail(response)}")
    if response.status_code != 201:
        raise GenerationError(
            f"scan: сервис сборки ответил {response.status_code}: {_detail(response)}"
        )
    return str(response.json()["id"])


def _await_mesh(remote_id: str, report: ProgressReporter) -> tuple[bytes, str]:
    """Байты меша и режим масштаба ("metric" — уже в мм, "normalized" — условный)."""
    started = time.time()
    scale_mode = "normalized"
    while True:
        elapsed = time.time() - started
        if elapsed > _MAX_WAIT_SECONDS:
            raise GenerationError("scan: сборка не уложилась во время")

        try:
            status = httpx.get(f"{_service_url()}/jobs/{remote_id}", timeout=20.0).json()
        except (httpx.HTTPError, ValueError) as exc:
            raise GenerationError(f"scan: сервис сборки перестал отвечать ({exc})") from exc

        state = status.get("status")
        if state == "error":
            raise GenerationError(f"scan: {status.get('error') or 'сборка не удалась'}")
        if state == "done":
            scale_mode = str(status.get("scale") or "normalized")
            break

        # Таймер от статистики сервиса сборки: он копит длительности реальных прогонов и
        # отвечает, сколько обычно занимает столько кадров. Раньше оценка была константой
        # («25 минут») — человек справедливо назвал такой таймер фейковым.
        service_elapsed = float(status.get("elapsed") or 0)
        service_expected = float(status.get("expected") or 0)
        if service_expected > 0:
            fraction = min(service_elapsed / service_expected, 0.97)
            report(
                "geometry",
                int(15 + fraction * 80),
                eta_seconds=max(int(service_expected - service_elapsed), 5),
            )
        else:
            fraction = min(elapsed / _ESTIMATED_SECONDS, 0.95)
            report(
                "geometry",
                int(15 + fraction * 75),
                eta_seconds=max(int(_ESTIMATED_SECONDS - elapsed), 0),
            )
        time.sleep(_POLL_SECONDS)

    try:
        mesh = httpx.get(f"{_service_url()}/jobs/{remote_id}/mesh", timeout=300.0)
    except httpx.HTTPError as exc:
        raise GenerationError(f"scan: не забрать готовый меш ({exc})") from exc
    if mesh.status_code != 200:
        raise GenerationError(f"scan: меш не отдался ({mesh.status_code})")
    return mesh.content, scale_mode


def _largest_part(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """Оставляет самый крупный связный кусок.

    Фотограмметрия снимает не предмет, а сцену: вместе с ним в поверхность попадают стол,
    стена и обрывки фона. Целиком отделить предмет от опоры без разметки нельзя — он на ней
    стоит и с ней связан, — но отдельно висящие ошмётки убираются надёжно и всегда к лучшему.

    Компоненты ищем сами, а не через `mesh.split`: тот требует scipy или networkx, которых в
    окружении giga нет (падает «no graph engines available»), а тащить их ради одного обхода
    графа несоразмерно. Система непересекающихся множеств по списку смежных граней делает
    ровно то же на голом numpy.
    """
    faces = len(mesh.faces)
    if faces == 0:
        return mesh

    parent = list(range(faces))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for left, right in mesh.face_adjacency:
        a, b = find(int(left)), find(int(right))
        if a != b:
            parent[a] = b

    sizes: dict[int, int] = {}
    roots = [find(i) for i in range(faces)]
    for root in roots:
        sizes[root] = sizes.get(root, 0) + 1
    if len(sizes) <= 1:
        return mesh

    biggest = max(sizes, key=lambda root: sizes[root])
    keep = [i for i, root in enumerate(roots) if root == biggest]
    logger.info("scan: оставлен крупнейший кусок из %d (%d из %d треугольников)",
                len(sizes), len(keep), faces)
    return mesh.submesh([keep], append=True)


def _detail(response: httpx.Response) -> str:
    try:
        return str(response.json().get("detail") or response.text)[:400]
    except ValueError:
        return response.text[:400]
