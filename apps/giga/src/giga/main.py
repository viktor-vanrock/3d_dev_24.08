"""FastAPI-приложение apps/giga: /health + контракт генерации по тексту (MF-351).

Авторизация — не переизобретаем: `giga` внутренний сервис без публичного порта
(`docs/architecture/readme.md`, `SECURITY.md` § «Сетевые границы») — достучаться
может только `api`, который уже прогнал запрос через свой PlagID-гейт.
`user_id` в теле запроса — уже аутентифицированный пользователь; giga доверяет
ему по границе сети/докера, а не проверяет сессию повторно.

Долгие генерации не блокируют HTTP: POST только создаёт строку со
status='queued' (дефолт схемы), реальная работа — в `lifecycle_worker.py`
(отдельный процесс с lease/heartbeat/reclaim/fencing).
"""

from __future__ import annotations

import os
import uuid
from typing import Any, Literal

import psycopg
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from . import db, gigachat_client
from .assistant import hyperpc_client
from .config import load_s3_config
from .diagnostics import heuristics
from .diagnostics.photos import InvalidPhotoError, process_diagnostic_photo
from .diagnostics.schemas import (
    DefectMatch,
    DiagnosisRequest,
    DiagnosisResponse,
    PhotoUploadResponse,
)
from .guides import draft as guide_draft
from .ideas import enrich as idea_enrich
from .prompt_variants import generate as prompt_variants
from .search import embed as search_embed
from .slicer_ai.matcher_port import NoMatchingProfileError as SlicerNoMatchingProfileError
from .slicer_ai.schemas import AiDeltaResponse
from .slicer_ai.schemas import ProfileIntent as SlicerProfileIntent
from .slicer_ai.service import compute_ai_delta_response
from .storage import ObjectStore, diagnostic_photo_key

app = FastAPI(title="giga")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "giga"}


class EmbedRequest(BaseModel):
    text: str = Field(min_length=1)


class EmbedResponse(BaseModel):
    embedding: list[float]
    model: str
    dim: int


@app.post("/embed")
def embed(body: EmbedRequest) -> EmbedResponse:
    """Эмбеддинг RU-текста для нейропоиска (MF-348). Без `GIGACHAT_CREDENTIALS` — 503,
    как и остальные внешние зависимости сервиса (см. `_connect` выше)."""
    client = gigachat_client.load_client()
    if client is None:
        raise HTTPException(status_code=503, detail="GIGACHAT_CREDENTIALS не сконфигурирован")
    try:
        [vector] = search_embed.embed_texts(client, [body.text])
    except search_embed.EmbeddingError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return EmbedResponse(
        embedding=vector, model=search_embed.EMBEDDING_MODEL, dim=search_embed.EMBEDDING_DIM
    )


class CreateGenerationRequest(BaseModel):
    user_id: str
    branch: Literal["openscad", "kzd", "hueforge", "trellis", "concepts", "scan"]
    prompt: str = Field(min_length=1)
    params: dict[str, Any] = Field(default_factory=dict)


class GenerationResponse(BaseModel):
    id: str
    user_id: str
    branch: str
    prompt: str
    params: dict[str, Any]
    status: str
    artifact_url: str | None
    preview_url: str | None
    error: str | None
    created_at: str
    updated_at: str

    @classmethod
    def from_generation(cls, generation: db.Generation) -> GenerationResponse:
        return cls(
            id=generation.id,
            user_id=generation.user_id,
            branch=generation.branch,
            prompt=generation.prompt,
            params=generation.params,
            status=generation.status,
            artifact_url=generation.artifact_url,
            preview_url=generation.preview_url,
            error=generation.error,
            created_at=generation.created_at,
            updated_at=generation.updated_at,
        )


def _connect() -> psycopg.Connection:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise HTTPException(status_code=503, detail="DATABASE_URL не сконфигурирован")
    return psycopg.connect(database_url)


@app.post("/generations", status_code=201)
def create_generation(body: CreateGenerationRequest) -> GenerationResponse:
    """Создаёт job генерации (status='queued'). Воркер заберёт его отдельно."""
    with _connect() as conn:
        generation = db.create_generation(conn, body.user_id, body.branch, body.prompt, body.params)
    return GenerationResponse.from_generation(generation)


@app.get("/generations/{generation_id}")
def get_generation(generation_id: str) -> GenerationResponse:
    """Статус (queued/running/done/error) и ссылка на артефакт в S3, если готов."""
    with _connect() as conn:
        generation = db.get_generation(conn, generation_id)
    if generation is None:
        raise HTTPException(status_code=404, detail="генерация не найдена")
    return GenerationResponse.from_generation(generation)


@app.get("/generations")
def list_generations(user_id: str = Query(...)) -> list[GenerationResponse]:
    """История генераций пользователя, новые сначала."""
    with _connect() as conn:
        generations = db.list_generations_by_user(conn, user_id)
    return [GenerationResponse.from_generation(generation) for generation in generations]


class GuideDraftRequest(BaseModel):
    instructions_text: str = Field(min_length=1, max_length=20_000)


class GuideDraftStep(BaseModel):
    title: str
    body: str
    parts: list[str]


class GuideDraftResponse(BaseModel):
    steps: list[GuideDraftStep]


@app.post("/guides/draft")
def create_guide_draft(body: GuideDraftRequest) -> GuideDraftResponse:
    """Черновик шагов гайда сборки из текста инструкции/BOM (MF-1007).

    Синхронно (текст короткий, один вызов GigaChat) — в отличие от
    `/generations`, автор ждёт результат прямо в редакторе, очередь через
    очередь генераций тут не нужна. Шаги — черновик, автор правит их перед
    сохранением как обычного гайда (`apps/api` `build_guides`/`build_steps`).
    """
    client = gigachat_client.load_client()
    if client is None:
        raise HTTPException(status_code=503, detail="GIGACHAT_CREDENTIALS не сконфигурирован")
    try:
        steps = guide_draft.draft_build_steps(client, body.instructions_text)
    except guide_draft.DraftError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return GuideDraftResponse(
        steps=[GuideDraftStep(title=s.title, body=s.body, parts=s.parts) for s in steps]
    )


class IdeaEnrichRequest(BaseModel):
    free_text: str = Field(min_length=1, max_length=4_000)


class IdeaEnrichResponse(BaseModel):
    title: str
    body: str
    category: str


@app.post("/ideas/enrich")
def create_idea_enrichment(body: IdeaEnrichRequest) -> IdeaEnrichResponse:
    """Черновик идеи (title/body/category) из свободного текста (MF-565).

    Синхронно, как `/guides/draft` — `apps/api` держит свой таймаут 5с и
    дизейблит кнопку «Оформить с ИИ» при недоступности/просрочке, эта ручка
    сама по бюджету времени не режет сверх `gigachat_client`. Пустой `title`
    в ответе — штатный исход (see `giga.ideas.enrich`), не 502.
    """
    client = gigachat_client.load_client()
    if client is None:
        raise HTTPException(status_code=503, detail="GIGACHAT_CREDENTIALS не сконфигурирован")
    try:
        draft = idea_enrich.enrich_idea_draft(client, body.free_text)
    except idea_enrich.EnrichError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return IdeaEnrichResponse(title=draft.title, body=draft.body, category=draft.category)


class PromptVariantsRequest(BaseModel):
    query: str = Field(min_length=1, max_length=300)
    limit: int = Field(default=6, ge=4, le=6)
    batch: int = Field(default=0, ge=0, le=10_000)
    exclude_labels: list[str] = Field(default_factory=list, max_length=48)


class PromptVariantItem(BaseModel):
    label: str
    prompt: str
    motif: str | None
    confidence: float


class PromptVariantsResponse(BaseModel):
    normalized_query: str
    motif: str | None
    variants: list[PromptVariantItem]


@app.post("/assistant/prompt-variants")
def create_prompt_variants(body: PromptVariantsRequest) -> PromptVariantsResponse:
    """Нормализованный intent + 4-6 вариантов промпта из свободного запроса главной (MF-2068).

    Синхронно, как `/ideas/enrich` — `apps/api` держит свой таймаут и деградирует на
    heuristic-фоллбэк при недоступности/просрочке. Используется только локальная Gemma
    (`HYPERPC_FAST_URL`), платный GigaChat из этого пути исключён.
    """
    config = hyperpc_client.load_fast_config()
    if config is None:
        raise HTTPException(status_code=503, detail="HYPERPC_FAST_URL не сконфигурирован")
    try:
        draft = prompt_variants.generate_prompt_variants(
            config,
            body.query,
            body.limit,
            body.batch,
            body.exclude_labels,
        )
    except prompt_variants.PromptVariantsError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return PromptVariantsResponse(
        normalized_query=draft.normalized_query,
        motif=draft.motif,
        variants=[
            PromptVariantItem(
                label=v.label, prompt=v.prompt, motif=v.motif, confidence=v.confidence
            )
            for v in draft.variants
        ],
    )


# Диагностика печати по фото — Фаза 1 (MF-360). Реальный анализ фото через
# GigaChat Vision — MF-361/362, ещё не реализован; см. `diagnostics/heuristics.py`.
_DIAGNOSTIC_PHOTO_FILE = File(...)


@app.post("/diagnostics/photos", status_code=201)
async def upload_diagnostic_photo(file: UploadFile = _DIAGNOSTIC_PHOTO_FILE) -> PhotoUploadResponse:
    """Валидирует фото дефекта, ресайзит/стрипает EXIF и заливает в S3.

    Синхронно (не через очередь генераций): предобработка — дёшево по CPU
    (один webp-вариант, не три, как у Make-фото в `mesh`), а результат нужен
    сразу — `photo_key` идёт следующим вызовом в `/diagnostics`.
    """
    data = await file.read()
    try:
        processed = process_diagnostic_photo(data)
    except InvalidPhotoError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    s3_config = load_s3_config()
    if s3_config is None:
        raise HTTPException(status_code=503, detail="S3 не сконфигурирован")

    photo_id = str(uuid.uuid4())
    key = diagnostic_photo_key(photo_id, "webp")
    store = ObjectStore(s3_config, bucket=s3_config.bucket_diagnostics)
    store.upload_bytes(key, processed.data, processed.content_type)

    return PhotoUploadResponse(photo_key=key, width=processed.width, height=processed.height)


@app.post("/diagnostics")
def create_diagnosis(body: DiagnosisRequest) -> DiagnosisResponse:
    """Возвращает вероятные дефекты по описанию/фото и рекомендации по настройкам.

    Пока без GigaChat Vision (MF-361/362) — матчинг эвристический по тексту
    `description`; `photo_key` в контракте уже есть и валидируется (см.
    `DiagnosisRequest`), чтобы вызывающая сторона (`api`) не переделывала
    форму запроса, когда MF-362 подключит реальный анализ фото.
    """
    defects = heuristics.match_defects(body.description)
    matches = [DefectMatch.from_defect(defect, body.filament_material) for defect in defects]
    note = (
        "Эвристика по тексту описания, без анализа содержимого фото "
        "(GigaChat Vision — MF-361/362, ещё не подключён)."
        if matches
        else "Совпадений по описанию не найдено. Уточните описание или дождитесь "
        "анализа фото (GigaChat Vision — MF-361/362, ещё не подключён)."
    )
    return DiagnosisResponse(matches=matches, note=note)


@app.get("/slicer-profiles/{printer_id}/{filament_id}/ai-delta")
def get_slicer_profile_ai_delta(
    printer_id: str,
    filament_id: str,
    intent: SlicerProfileIntent = "appearance",
) -> AiDeltaResponse:
    """AI-дельты поверх детерминированного профиля MF-412 (MF-1941, стадия 4
    эпика MF-34 v2). Внутренний эндпоинт — вызывается `apps/api`, который уже
    прогнал auth/rate-limit на своей стороне `GET /slicer-profiles/:printerId/
    :filamentId` (см. `docs/contracts/slicer.profile-recommendation.v1.md`);
    `giga` доверяет вызывающей стороне по границе сети (см. докстринг файла).

    Без `GIGACHAT_CREDENTIALS` — 200 с честным no-op AI-слоем (`ai.note`
    объясняет причину), не 503: детерминированный `base`-профиль сам по себе
    валиден и полезен вызывающей стороне даже без AI-дельт (см. `delta.py`).
    """
    with _connect() as conn:
        client = gigachat_client.load_client()
        try:
            return compute_ai_delta_response(conn, client, printer_id, filament_id, intent)
        except SlicerNoMatchingProfileError as exc:
            raise HTTPException(status_code=404, detail="профиль не найден") from exc
