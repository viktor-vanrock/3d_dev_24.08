"""Сборка модели предмета из набора фотографий — фотограмметрия на GPU.

Отдельный сервис, а не узел ComfyUI: это принципиально другая технология. ComfyUI/TRELLIS
ДОРИСОВЫВАЕТ форму по нескольким картинкам — результат правдоподобный, но выдуманный.
Здесь же форма ИЗМЕРЯЕТСЯ: COLMAP ищет одни и те же точки на разных снимках, по ним
восстанавливает, откуда снят каждый кадр, и триангулирует поверхность. Отсюда и требование
к съёмке — не 3-5 ракурсов, а десятки кадров с перекрытием.

Живёт на HYPERPC рядом с ComfyUI и по тому же принципу: HTTP поверх Tailscale, вызывает
apps/giga. Состояние — в памяти процесса и в папках на диске; очередь не нужна, задания
приходят по одному и считаются минутами.
"""

from __future__ import annotations

import json
import shutil
import statistics
import subprocess
import sys
import threading
import time
import uuid
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import scanscale
import trimesh
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response

# 3.11.1, а не свежая 4.1.1, намеренно: сборка 4.1.1 линкуется с CUDA новее, чем позволяет
# драйвер этой машины (553.35 = CUDA 12.4), и падает на создании контекста ещё до первого
# кадра. Поднимать драйвер нельзя без веской причины — на нём же работают ComfyUI и языковые
# модели. 3.11.1 везёт cudart64_12.dll и с этим драйвером совместима.
COLMAP = Path(r"C:\photogrammetry\c311\bin\colmap.exe")
WORKSPACES = Path(r"C:\photogrammetry\jobs")
WORKSPACES.mkdir(parents=True, exist_ok=True)
# История прогонов — из неё считается честная оценка времени. Раньше клиент рисовал таймер от
# констант («25 минут»), и он не имел отношения к реальной скорости.
STATS = Path(r"C:\photogrammetry\stats.json")
# Словарь признаков для замыкания круга при последовательном сопоставлении сотни кадров.
VOCAB = Path(r"C:\photogrammetry\vocab_tree_flickr100K_words32K.bin")

# Минимум для попытки: ниже COLMAP почти никогда не связывает снимки — GPU сгорит впустую.
# Это защита от заведомо пустой работы, а не планка качества.
MIN_PHOTOS = 10
MAX_PHOTOS = 400

# Poisson выдаёт миллионы треугольников — на эталонном прогоне 4,4 млн. Столько не нужно
# никому: портал такой меш не примет (потолок 2 млн), telefon его не откроет, а `split`
# на нём падает по памяти. Триста тысяч сохраняют форму до неразличимости (габарит на
# проверке не изменился ни на сантиметр) и режутся за шесть секунд.
TARGET_FACES = 300_000


@dataclass
class Job:
    id: str
    status: str = "queued"  # queued | running | done | error
    phase: str = ""
    error: str | None = None
    photos: int = 0
    mesh: Path | None = None
    # normalized — размер условный (приведут к 80 мм); metric — настоящий, восстановлен из
    # поз камеры ARKit. Читает apps/giga, чтобы знать, можно ли трогать масштаб.
    scale: str = "normalized"
    # Монотонные отметки, не стенные часы: на этой машине служба времени шагает часами
    # назад, и elapsed по time.time() схлопывался у живого задания. Монотонному времени
    # шаги часов безразличны.
    started_at: float = 0.0
    finished_at: float = 0.0
    # Оценка полного времени из статистики прошлых прогонов — по ней клиент рисует настоящий
    # таймер вместо выдуманного.
    expected: float = 0.0
    lock: threading.Lock = field(default_factory=threading.Lock)


JOBS: dict[str, Job] = {}
app = FastAPI(title="scan")


@app.get("/health")
def health() -> dict:
    return {"ok": COLMAP.exists(), "colmap": str(COLMAP), "jobs": len(JOBS)}


@app.post("/reconstruct", status_code=201)
async def reconstruct(archive: UploadFile) -> JSONResponse:
    """Принимает zip со снимками и запускает сборку."""
    job_id = uuid.uuid4().hex
    workspace = WORKSPACES / job_id
    images = workspace / "images"
    images.mkdir(parents=True)

    package = workspace / "photos.zip"
    package.write_bytes(await archive.read())
    try:
        with zipfile.ZipFile(package) as zf:
            for entry in zf.infolist():
                if entry.is_dir():
                    continue
                # Раскладываем плоско и своими именами: имя из архива — чужой ввод, и
                # пути вида `../` в нём писали бы куда угодно.
                name = Path(entry.filename).name
                # Манифест позиций (метры ARKit по именам кадров) — кладём рядом с заданием:
                # из него после сборки восстанавливается настоящий размер предмета.
                if name == "manifest.json":
                    with zf.open(entry) as src, (workspace / "manifest.json").open("wb") as dst:
                        shutil.copyfileobj(src, dst)
                    continue
                if not name.lower().endswith((".jpg", ".jpeg", ".png")):
                    continue
                with zf.open(entry) as src, (images / name).open("wb") as dst:
                    shutil.copyfileobj(src, dst)
    except zipfile.BadZipFile as exc:
        shutil.rmtree(workspace, ignore_errors=True)
        raise HTTPException(status_code=422, detail=f"архив не читается: {exc}") from exc
    finally:
        package.unlink(missing_ok=True)

    count = len(list(images.iterdir()))
    if count < MIN_PHOTOS:
        shutil.rmtree(workspace, ignore_errors=True)
        raise HTTPException(
            status_code=422,
            detail=(
                f"кадров {count}, нужно хотя бы {MIN_PHOTOS} — "
                "фотограмметрии не на чем связать снимки"
            ),
        )
    if count > MAX_PHOTOS:
        raise HTTPException(status_code=422, detail=f"кадров {count}, максимум {MAX_PHOTOS}")

    job = Job(id=job_id, photos=count, expected=_expected_seconds(count))
    JOBS[job_id] = job
    threading.Thread(target=_run, args=(job, workspace), daemon=True).start()
    return JSONResponse({"id": job_id, "photos": count}, status_code=201)


@app.get("/jobs/{job_id}")
def status(job_id: str) -> dict:
    job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="нет такого задания")
    reference = job.finished_at or time.monotonic()
    return {
        "id": job.id,
        "status": job.status,
        "phase": job.phase,
        "error": job.error,
        "photos": job.photos,
        "scale": job.scale,
        # Настоящий таймер: сколько уже идёт и сколько обычно занимает столько кадров.
        "elapsed": round(max(0.0, reference - job.started_at), 1) if job.started_at else 0,
        "expected": round(job.expected, 1),
    }


@app.get("/jobs/{job_id}/mesh")
def mesh(job_id: str) -> Response:
    job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="нет такого задания")
    if job.status != "done" or job.mesh is None:
        raise HTTPException(status_code=409, detail=f"задание в состоянии {job.status}")
    return Response(job.mesh.read_bytes(), media_type="model/gltf-binary")


def _keep_awake(on: bool) -> None:
    """Держит машину бодрой, пока идёт задание: без этого Windows дремлет (Modern Standby),
    и сборка растягивается в разы — ночью это ловилось как «замёрзший» прогресс при живом
    процессе."""
    try:
        import ctypes

        ES_CONTINUOUS = 0x80000000
        ES_SYSTEM_REQUIRED = 0x00000001
        flags = ES_CONTINUOUS | (ES_SYSTEM_REQUIRED if on else 0)
        ctypes.windll.kernel32.SetThreadExecutionState(flags)
    except Exception:  # noqa: BLE001 — не смогли, значит спит как спала
        pass


def _run(job: Job, workspace: Path) -> None:
    try:
        job.status = "running"
        job.started_at = time.monotonic()
        _keep_awake(True)
        job.phase = "reconstruct"

        # Смазанные кадры выкидываются до реконструкции: движение при авто-съёмке даёт
        # мыло, а мыло — это мусорные фичи и дырявая геометрия. Порог откалиброван на живых
        # кадрах: резкие 670–1360, смазанный в движении — 52.
        _drop_blurry(workspace / "images", job)
        job.photos = len(list((workspace / "images").iterdir()))

        # Маски объекта: фон выключается ещё на уровне фич — COLMAP не тратит время на
        # столешницу и не тащит её в облако. Это тот же приём, что «Object Masking» у
        # Polycam. Опционально: без rembg или при недоверии к маскам работаем по-старому.
        _make_masks(workspace, job)
        # `automatic_reconstructor` — весь путь одной командой: поиск особых точек, сшивка
        # снимков, плотное облако, поверхность. Разбирать его на шаги имеет смысл, только
        # когда нужно вмешаться в середину; нам не нужно.
        # Вывод в файл, а не в трубу. С `capture_output=True` задание однажды зависло
        # навсегда: сам colmap.exe уже исчез, а `subprocess.run` продолжал ждать закрытия
        # трубы. Файл этой ловушки лишён, и заодно лог остаётся на диске для разбора.
        log_path = workspace / "colmap.log"
        with log_path.open("w", encoding="utf-8", errors="replace") as log:
            result = subprocess.run(
                [
                    str(COLMAP),
                    "automatic_reconstructor",
                    "--workspace_path", str(workspace),
                    "--image_path", str(workspace / "images"),
                    "--quality", "medium",
                    "--use_gpu", "1",
                # `individual` — полное попарное сопоставление всех снимков. Для обхода
                # предмета это ровно то, что нужно: кадр с начала круга и кадр с конца
                # смотрят на одно и то же, и связать их обязательно, иначе круг рвётся.
                # `video` экономит именно на этом сравнении, а сотня кадров сравнивается
                # целиком за разумное время.
                    "--data_type", "individual",
                ],
                stdout=log,
                stderr=subprocess.STDOUT,
                timeout=60 * 60,
            )
        if result.returncode != 0 and not _finish_poisson(workspace, log_path):
            job.status = "error"
            job.error = _last_error(log_path.read_text(errors="replace")) \
                or f"colmap завершился с кодом {result.returncode}"
            return

        job.phase = "export"
        ply = _find_mesh(workspace)
        if ply is None:
            job.status = "error"
            job.error = (
                "COLMAP отработал, но поверхности не получилось — обычно это мало кадров "
                "или слишком гладкий предмет без фактуры"
            )
            return

        scene = trimesh.load(ply, force="mesh")
        if scene.is_empty or len(scene.faces) == 0:
            job.status = "error"
            job.error = "получилась пустая поверхность"
            return

        if len(scene.faces) > TARGET_FACES:
            before = len(scene.faces)
            scene = scene.simplify_quadric_decimation(face_count=TARGET_FACES)
            job.phase = f"export ({before} → {len(scene.faces)})"

        # Позы камеры от приложения дают больше, чем размер: полное подобие COLMAP → ARKit.
        # После переноса меш в метрах, осью Y вверх (ARKit выровнен по гравитации), и зона
        # съёмки известна в его же координатах — можно вырезать предмет из собранного стола.
        alignment = _ar_alignment(workspace, ply)
        if alignment is not None:
            s_factor, rotation, translation, zone = alignment
            scene.vertices = (
                scene.vertices @ np.asarray(rotation).T
            ) * s_factor + np.asarray(translation)
            if zone is not None:
                _crop_to_zone(scene, zone, job)
            # Портал считает в миллиметрах.
            scene.apply_scale(1000.0)
            job.scale = "metric"

        out = workspace / "model.glb"
        out.write_bytes(trimesh.Scene(scene).export(file_type="glb"))
        job.mesh = out
        job.status = "done"
        job.phase = "done"
        job.finished_at = time.monotonic()
        _record_run(job.photos, job.finished_at - job.started_at)
    except subprocess.TimeoutExpired:
        job.status = "error"
        job.error = "сборка не уложилась в час"
    except Exception as exc:  # noqa: BLE001 — падение задания не должно ронять сервис
        job.status = "error"
        job.error = f"{type(exc).__name__}: {exc}"
    finally:
        _keep_awake(False)


def _expected_seconds(photos: int) -> float:
    """Сколько обычно занимает сборка такого размера — из истории прогонов.

    Медиана секунд-на-кадр и медиана накладных, а не среднее: один аномальный прогон не
    должен искажать таймер всем. Пока истории мало — грубая прикидка по первым живым прогонам.
    """
    try:
        records = json.loads(STATS.read_text())
    except Exception:  # noqa: BLE001
        records = []
    good = [r for r in records if r.get("photos", 0) >= MIN_PHOTOS and r.get("seconds", 0) > 30]
    if len(good) >= 3:
        rate = statistics.median(r["seconds"] / r["photos"] for r in good)
        overhead = statistics.median(max(0.0, r["seconds"] - rate * r["photos"]) for r in good)
        return overhead + rate * photos
    return 60.0 + 9.0 * photos


def _record_run(photos: int, seconds: float) -> None:
    try:
        records = json.loads(STATS.read_text())
    except Exception:  # noqa: BLE001
        records = []
    records.append({"photos": photos, "seconds": round(seconds, 1),
                    "at": time.strftime("%Y-%m-%dT%H:%M:%S")})
    STATS.write_text(json.dumps(records[-200:]))


def _laplacian_variance(path: Path) -> float:
    """Резкость кадра: дисперсия лапласиана. У смазанного движением кадра края размыты, и
    дисперсия проседает на порядок."""
    from PIL import Image

    image = Image.open(path).convert("L")
    image.thumbnail((640, 640))
    a = np.asarray(image, dtype=np.float32)
    lap = a[:-2, 1:-1] + a[2:, 1:-1] + a[1:-1, :-2] + a[1:-1, 2:] - 4 * a[1:-1, 1:-1]
    return float(lap.var())


def _drop_blurry(images: Path, job: Job) -> None:
    """Убирает смазанные кадры. Порог относительный (0.22 медианы): абсолютный зависел бы от
    устройства и сцены. Минимум кадров неприкосновенен — лучше мыло, чем отказ."""
    files = sorted(images.iterdir())
    if len(files) <= MIN_PHOTOS:
        return
    scores: dict[Path, float] = {}
    for f in files:
        try:
            scores[f] = _laplacian_variance(f)
        except Exception:  # noqa: BLE001 — нечитаемый кадр пусть отсеет сам COLMAP
            scores[f] = float("inf")
    cut = statistics.median(scores.values()) * 0.22
    blurry = sorted((f for f, v in scores.items() if v < cut), key=lambda f: scores[f])
    removable = min(len(blurry), len(files) - MIN_PHOTOS)
    for f in blurry[:removable]:
        f.unlink()
    if removable:
        job.phase = f"reconstruct (отсеяно смазанных: {removable})"


def _make_masks(workspace: Path, job: Job) -> Path | None:
    """Маски объекта: белое — предмет, чёрное — фон, который COLMAP не смотрит вовсе.

    Сегментация — ОТДЕЛЬНЫМ процессом (`maskgen.py`): onnxruntime на этой машине уже
    показал нрав (DLL-падения), а нативный крах внутри сервиса убил бы и все задания разом.
    Упал процесс масок — собираем без масок; маскам с неправдоподобной медианной долей
    предмета (<4% или >60% кадра) тоже не доверяем.
    """
    masks = workspace / "masks"
    script = Path(__file__).with_name("maskgen.py")
    python = Path(sys.executable)
    try:
        result = subprocess.run(
            [str(python), str(script), str(workspace / "images"), str(masks)],
            capture_output=True,
            text=True,
            timeout=15 * 60,
        )
        if result.returncode != 0:
            return None
        share = 0.0
        for line in result.stdout.splitlines():
            if line.startswith("share="):
                share = float(line.split("=", 1)[1])
        if not 0.04 <= share <= 0.6:
            return None
        job.phase = f"reconstruct (маска объекта: ~{int(share * 100)}% кадра)"
        return masks
    except Exception:  # noqa: BLE001 — сегментация упала, сборке это не мешает
        return None


def _finish_poisson(workspace: Path, log_path: Path) -> bool:
    """Дотягивает сборку, если COLMAP упал на последнем шаге.

    Живой случай: 37 кадров прошли весь путь, плотное облако на 482 тысячи точек записано —
    и процесс умер на триангуляции Пуассона, не оставив ни строки об ошибке. Тот же шаг,
    запущенный отдельно, прошёл без вопросов. Облако — почти вся работа; выбрасывать его из-за
    падения финального шага нельзя.
    """
    fused = sorted(
        workspace.glob("dense/*/fused.ply"),
        key=lambda p: p.stat().st_size,
        reverse=True,
    )
    if not fused or fused[0].stat().st_size == 0:
        return False
    target = fused[0].parent / "meshed-poisson.ply"
    try:
        with log_path.open("a", encoding="utf-8", errors="replace") as log:
            log.write("\n--- повтор триангуляции отдельным вызовом ---\n")
            retry = subprocess.run(
                [str(COLMAP), "poisson_mesher",
                 "--input_path", str(fused[0]), "--output_path", str(target)],
                stdout=log,
                stderr=subprocess.STDOUT,
                timeout=20 * 60,
            )
        return retry.returncode == 0 and target.exists() and target.stat().st_size > 0
    except Exception:  # noqa: BLE001 — не получилось, значит честная ошибка исходного запуска
        return False


def _last_error(stderr: str | None) -> str | None:
    """Внятная строка из вывода COLMAP — последняя с glog-префиксом E/F (`E20260803 …`).

    Именно с префиксом: сперва фильтр брал любую строку на «E»/«F», и последним совпадением
    оказался баннер стадии «Feature matching» — человеку показали его вместо ошибки.
    """
    def is_error(ln: str) -> bool:
        return len(ln) > 9 and ln[0] in "EF" and ln[1:9].isdigit()

    lines = [ln.strip() for ln in (stderr or "").splitlines() if is_error(ln)]
    return lines[-1][:600] if lines else (stderr or "").strip()[-600:] or None


def _ar_alignment(workspace: Path, ply: Path):
    """Подобие COLMAP → ARKit (s, R, t) и зона съёмки, если приложение её прислало.

    Позы COLMAP лежат в бинарной sparse-модели с тем же номером, что у выбранного dense-куска
    (dense/N строится из sparse/N) — конвертируем её в текст его же инструментом и разбираем.
    Любой сбой здесь — не ошибка задания: без переноса сборка остаётся полезной, просто размер
    будет условным, а сцена — целой.
    """
    manifest_path = workspace / "manifest.json"
    if not manifest_path.exists():
        return None
    try:
        manifest = json.loads(manifest_path.read_text())
        ar_positions = manifest.get("photos") or {}
        model_index = ply.parent.name
        sparse = workspace / "sparse" / model_index
        if not sparse.exists():
            return None
        txt_dir = workspace / "sparse-txt"
        txt_dir.mkdir(exist_ok=True)
        converted = subprocess.run(
            [str(COLMAP), "model_converter", "--input_path", str(sparse),
             "--output_path", str(txt_dir), "--output_type", "TXT"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=300,
        )
        if converted.returncode != 0:
            return None
        centers = scanscale.parse_images_txt(txt_dir / "images.txt")

        zone = None
        center = manifest.get("center")
        radius = manifest.get("radius")
        if center is not None and radius:
            zone = {
                "center": center,
                "radius": float(radius),
                # Границы по высоте задаёт человек на предподготовке; без них — умолчания
                # от точки удара луча о стол.
                "floor": manifest.get("floor"),
                "top": manifest.get("top"),
            }
        fit = scanscale.similarity_transform(ar_positions, centers)
        if fit is not None:
            s_factor, rotation, translation = fit
            return s_factor, rotation, translation, zone

        # Подобие не сошлось — хотя бы размер медианой отношений. Без поворота зону съёмки в
        # сцену не перенести, поэтому вырезания не будет.
        s_factor = scanscale.metric_scale(ar_positions, centers)
        if s_factor is None:
            return None
        return s_factor, np.eye(3), np.zeros(3), None
    except Exception:  # noqa: BLE001 — перенос опционален, сборку не роняем
        return None


def _crop_to_zone(scene: trimesh.Trimesh, zone: dict, job: Job) -> None:
    """Оставляет только зону съёмки: цилиндр вокруг предмета со срезами сверху и снизу.

    Фотограмметрия собирает всё, что видела камера, — столешницу, инструменты, провода (живой
    прогон: дезодорант на коврике превращался в кусок стола с бугорком). Печатать человек
    хочет вещь. Границы задаёт стадия предподготовки в приложении; без неё срез снизу — 3 мм
    выше точки удара луча о стол. Плоский низ печати только помогает.
    """
    c = np.asarray(zone["center"], dtype=np.float64)
    r = float(zone["radius"])
    bottom = float(zone["floor"]) if zone.get("floor") is not None else c[1] + 0.003
    top = float(zone["top"]) if zone.get("top") is not None else c[1] + r * 1.4
    v = scene.vertices
    horizontal = np.sqrt((v[:, 0] - c[0]) ** 2 + (v[:, 2] - c[2]) ** 2)
    inside = (horizontal < r * 1.05) & (v[:, 1] > bottom) & (v[:, 1] < top)
    face_keep = inside[scene.faces].all(axis=1)
    kept = int(face_keep.sum())
    if kept < 500:
        # Вырезалось в ничто (промах наведения?) — целая сцена честнее пустоты.
        job.phase = "export (зона пуста, оставлена вся сцена)"
        return
    before = len(scene.faces)
    scene.update_faces(face_keep)
    scene.remove_unreferenced_vertices()
    job.phase = f"export (вырезан предмет: {before} → {len(scene.faces)})"


def _find_mesh(workspace: Path) -> Path | None:
    """Poisson-поверхность лежит в dense/<N>/. Номеров может быть несколько, если COLMAP
    не смог связать все снимки в один кусок — берём самый крупный файл, то есть самую
    полную из восстановленных частей."""
    candidates = sorted(
        workspace.glob("dense/*/meshed-poisson.ply"),
        key=lambda p: p.stat().st_size,
        reverse=True,
    )
    return candidates[0] if candidates else None
