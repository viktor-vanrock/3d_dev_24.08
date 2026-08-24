"""Общий контракт для веток генерации (openscad/kzd/hueforge/trellis/concepts).

Фаза 1 (MF-351) — очередь/статусы/S3, без реальной доменной логики каждой
ветки (рендер OpenSCAD, вызов КЗД, HueForge-квантование — Фаза 2, MF-352).
Исполнитель — функция `(GenerationJob, ProgressReporter) -> GenerationResult`,
которая либо возвращает готовые байты артефакта (и опционально превью), либо
бросает `GenerationError` (провайдер/генерация упали — воркер переводит job в
status='error' с текстом ошибки, не роняя цикл).

`ProgressReporter` (MF-2001, apps/api § queue_position/phase/progress/
eta_seconds) — добавлен вторым аргументом аддитивно: у него есть дефолт
(`NOOP_REPORTER`), поэтому openscad/kzd/hueforge не обязаны его вызывать
(и пока не вызывают — их job'ы короткие, честного "прогресса" внутри нет,
NULL в ответе api для них не ошибка, см. contract.ts). Ветки, которые ЗНАЮТ
свои фазы (trellis — upload/submit/shape/mesh/export), вызывают `report`
по ходу дела; lifecycle worker передаёт fenced writer, который пишет в БД.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


class GenerationError(Exception):
    """Ошибка провайдера/генерации — ловится воркером, job переходит в error."""


@dataclass(frozen=True)
class GenerationJob:
    id: str
    branch: str
    prompt: str
    params: dict[str, Any]


@dataclass(frozen=True)
class GenerationResult:
    artifact_bytes: bytes
    artifact_ext: str
    artifact_content_type: str
    preview_bytes: bytes | None = None
    preview_ext: str | None = None
    preview_content_type: str | None = None


class ProgressReporter(Protocol):
    def __call__(
        self, phase: str, progress: int | None, *, eta_seconds: int | None = None
    ) -> None: ...


def _noop_reporter(phase: str, progress: int | None, *, eta_seconds: int | None = None) -> None:
    return None


NOOP_REPORTER: ProgressReporter = _noop_reporter
