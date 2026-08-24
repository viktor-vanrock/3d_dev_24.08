import json
import os
import shutil
import tempfile
from pathlib import Path

import psycopg
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from . import metrics
from .config import load_s3_config
from .convert import ConversionError, ModelMetadata, convert_to_3mf
from .errors import RejectCode, RejectionError
from .limits import Limits, load_limits
from .make_photos import DuplicatePhotoError, MakeNotFoundError, insert_make_photo
from .photo import InvalidPhotoError, process_photo
from .slicer_engine import UnsupportedSlicerError, resolve_prusa_ini
from .storage import ObjectStore

app = FastAPI(title="mesh")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "mesh"}


class MakePhotoResponse(BaseModel):
    id: str
    make_id: str
    s3_key: str
    position: int
    is_cover: bool
    moderation_status: str


# Приём фото Make (MF-393 шаг 3 / MF-783): api вызывает этот эндпоинт внутри
# приватной сети ПОСЛЕ проверки авторства/владения make_id — mesh доверяет
# вызывающему коду (см. docs/architecture/readme.md — mesh без публичного домена).
_PHOTO_FORM = Form(...)
_PHOTO_FILE = File(...)

_CONVERT_FORM = Form(...)
_CONVERT_FILE = File(...)
_CONVERT_MEDIA_TYPE = "application/vnd.ms-package.3dmanufacturing-3mf"


@app.post("/make-photos", status_code=201, response_model=MakePhotoResponse)
async def create_make_photo(
    make_id: str = _PHOTO_FORM,
    file: UploadFile = _PHOTO_FILE,
) -> MakePhotoResponse:
    data = await file.read()
    try:
        processed = process_photo(data)
    except InvalidPhotoError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    s3_config = load_s3_config()
    database_url = os.getenv("DATABASE_URL")
    if s3_config is None or database_url is None:
        raise HTTPException(
            status_code=503, detail="фото-пайплайн не сконфигурирован (S3/DATABASE_URL)"
        )

    store = ObjectStore(s3_config)
    with psycopg.connect(database_url) as conn:
        try:
            record = insert_make_photo(
                conn,
                store,
                make_id,
                processed.variants,
                processed.moderation_status,
                processed.phash,
            )
        except MakeNotFoundError as exc:
            raise HTTPException(status_code=404, detail=f"make {make_id} не найден") from exc
        except DuplicatePhotoError as exc:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "DUPLICATE_PHOTO",
                    "message": "Это фото уже опубликовано под другой моделью",
                    "existing_make_id": exc.existing_make_id,
                },
            ) from exc

    return MakePhotoResponse(
        id=record.id,
        make_id=record.make_id,
        s3_key=record.s3_key,
        position=record.position,
        is_cover=record.is_cover,
        moderation_status=record.moderation_status,
    )


class PrusaIniResponse(BaseModel):
    profile_id: str
    ini: str
    params: dict


# MF-1942 (эпик MF-34 v2 «best-effort отправка»): единственный сегодня рабочий,
# проверенный на реальном headless-слайсе (slicing_worker.py::execute_slice_job)
# резолвер unified-профиля в нативный текст — `resolve_prusa_ini` (slicer_engine.py).
# Ф1-экспортёр (slicer_profile_export.py, MF-413) под Orca/Cura/полный Prusa-bundle
# сюда сознательно не подключён: у api нет причины дублировать str()-сериализацию
# params (числа/bool из jsonb) на другом языке — расхождение форматирования (Python
# str(False) != JS String(false)) было бы непроверенным риском для файла, который
# реально уходит на устройство. api вызывает этот internal-only HTTP-путь тем же
# паттерном, что makes/meshClient.ts::uploadMakePhoto (mesh на 127.0.0.1, без auth).
@app.get("/slicer-profiles/{profile_id}/prusa-ini", response_model=PrusaIniResponse)
def get_prusa_ini(profile_id: str) -> PrusaIniResponse:
    database_url = os.getenv("DATABASE_URL")
    if database_url is None:
        raise HTTPException(status_code=503, detail="DATABASE_URL не сконфигурирован")
    with psycopg.connect(database_url) as conn:
        try:
            ini, params = resolve_prusa_ini(conn, profile_id)
        except UnsupportedSlicerError as exc:
            raise HTTPException(
                status_code=422, detail={"error": "unsupported_slicer", "message": str(exc)}
            ) from exc
    return PrusaIniResponse(profile_id=profile_id, ini=ini, params=params)


def _diagnostics_report(result, *, source_filename: str, unit: str, mode: str) -> dict:
    return {
        "source_filename": source_filename,
        "unit": unit,
        "mode": mode,
        "bbox": result.bbox,
        "duration_ms": round(result.duration_ms, 3),
        "memory_peak_bytes": result.memory_peak_bytes,
        "toolchain_versions": result.toolchain_versions,
        "parts": [
            {
                "name": report.name,
                "mode": report.mode,
                "before": report.before.to_dict(),
                "after": report.after.to_dict() if report.after is not None else None,
            }
            for report in result.reports
        ],
    }


def _rejection_response(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": "conversion_rejected", "code": code, "message": message},
    )


async def _save_upload(upload: UploadFile, destination: Path, limits: Limits) -> None:
    """Пишет upload чанками, не выделяя память под весь пользовательский файл."""
    total = 0
    with destination.open("wb") as output:
        while chunk := await upload.read(1024 * 1024):
            total += len(chunk)
            if total > limits.max_file_bytes:
                raise ValueError(
                    f"входной файл превышает лимит {limits.max_file_bytes} байт"
                )
            output.write(chunk)


# Внутренний endpoint: api вызывает его внутри приватной сети.  Результат —
# бинарный 3MF, а JSON-отчёт передаётся в X-Mesh-Report, чтобы не кодировать
# потенциально большой архив в JSON и не держать его в памяти. Ошибки всегда
# имеют один JSON-контракт {error, code, message}.
@app.post("/convert")
async def convert_mesh(
    file: UploadFile = _CONVERT_FILE,
    unit: str = Form("mm"),
    mode: str = Form("repair"),
    title: str | None = Form(None),
    author: str | None = Form(None),
    license: str | None = Form(None),
    model_id: str | None = Form(None),
    source: str | None = Form(None),
):
    limits = load_limits()
    temp_dir = Path(tempfile.mkdtemp(prefix="mesh-convert-"))
    filename = Path(file.filename or "source.stl").name
    suffix = Path(filename).suffix or ".stl"
    source_path = temp_dir / f"source{suffix.lower()}"
    destination = temp_dir / "canonical.3mf"

    def reject(status_code: int, code: str, message: str) -> JSONResponse:
        shutil.rmtree(temp_dir, ignore_errors=True)
        return _rejection_response(status_code, code, message)

    try:
        try:
            await _save_upload(file, source_path, limits)
        except ValueError as exc:
            metrics.record_rejection(RejectCode.TOO_LARGE)
            return reject(413, "too_large", str(exc))

        try:
            result = convert_to_3mf(
                source_path,
                destination,
                limits=limits,
                unit=unit,
                mode=mode,
                metadata=ModelMetadata(
                    title=title,
                    author=author,
                    license=license,
                    model_id=model_id,
                    source=source,
                ),
            )
        except ConversionError as exc:
            metrics.record_rejection(exc.code)
            return reject(422, exc.code.value, str(exc))
        except RejectionError as exc:
            metrics.record_rejection(exc.code)
            return reject(422, exc.code.value, str(exc))
        except ValueError as exc:
            metrics.record_rejection(RejectCode.PARSE_ERROR)
            return reject(422, "invalid_mode", str(exc))
        except OSError as exc:
            metrics.record_rejection(RejectCode.PARSE_ERROR)
            return reject(422, "parse_error", f"не удалось прочитать файл: {exc}")

        report = _diagnostics_report(result, source_filename=filename, unit=unit, mode=mode)
        metrics.record_success(
            result.duration_ms,
            repaired=any(not item.before.is_clean for item in result.reports),
            memory_peak_bytes=result.memory_peak_bytes,
        )
        headers = {
            "X-Mesh-Report": json.dumps(report, ensure_ascii=True, separators=(",", ":")),
            "X-Mesh-Metrics": json.dumps(metrics.snapshot(), separators=(",", ":")),
        }
        return FileResponse(
            destination,
            media_type=_CONVERT_MEDIA_TYPE,
            filename="canonical.3mf",
            headers=headers,
            background=BackgroundTask(shutil.rmtree, temp_dir, ignore_errors=True),
        )
    except Exception:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise
