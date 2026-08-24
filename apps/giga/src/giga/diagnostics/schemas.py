"""Pydantic-контракт эндпоинтов `/diagnostics*` (MF-360 шаг 2).

Авторизация — не переизобретаем (см. `main.py` docstring про PlagID):
`user_id` уже аутентифицирован вызывающим `api`.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from .catalog import KNOWN_MATERIALS, DefectInfo

FilamentMaterial = Literal["PLA", "PETG", "ABS", "TPU"]

assert set(FilamentMaterial.__args__) == KNOWN_MATERIALS  # каталог и контракт не разъехались


class PhotoUploadResponse(BaseModel):
    # Ключ в S3, не публичный URL — тот же паттерн, что MakePhotoResponse.s3_key
    # (apps/mesh/src/mesh/main.py): подпись/раздачу URL решает `api`, не giga.
    photo_key: str
    width: int
    height: int


class DiagnosisRequest(BaseModel):
    user_id: str = Field(min_length=1)
    printer: str | None = None
    filament_material: FilamentMaterial | None = None
    description: str = Field(default="", max_length=2000)
    photo_key: str | None = None

    @model_validator(mode="after")
    def _require_photo_or_description(self) -> DiagnosisRequest:
        if not self.photo_key and not self.description.strip():
            raise ValueError("нужен photo_key и/или непустой description")
        return self


class DefectMatch(BaseModel):
    defect_id: str
    name_ru: str
    causes: list[str]
    recommendations: list[str]

    @classmethod
    def from_defect(cls, defect: DefectInfo, material: str | None) -> DefectMatch:
        return cls(
            defect_id=defect.id,
            name_ru=defect.name_ru,
            causes=defect.causes,
            recommendations=defect.recommendations_for(material),
        )


class DiagnosisResponse(BaseModel):
    matches: list[DefectMatch]
    # Пока нет GigaChat Vision (MF-361/362) — матчинг эвристический по тексту
    # описания, не по содержимому фото; note — честно об этом сообщает
    # вызывающей стороне, а не выдаёт эвристику за полноценный анализ фото
    # (CLAUDE.md § «ВХОД ВРАЖДЕБЕН» про непомеченные выводы модели тем же
    # принципом распространяется на выводы эвристики).
    note: str
