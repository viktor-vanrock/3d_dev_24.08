"""Курируемый seed RU-филаментов (FDplast/Bestfilament/REC/PLASTICO) → unified
schema (MF-411, шаг 3 фазы 1 эпика MF-34, RU-специфика — ров: связки, которых
нет ни у одного западного профиля, см. эпик § «RU-специфика»).

В отличие от `slicer_print_profiles(_prusa).py`, здесь нет живого источника,
который можно распарсить: RU-вендоры не публикуют профили слайсеров ни в
OrcaSlicer, ни в PrusaSlicer апстримах. Вместо парсинга — курируемая таблица
вендор×материал, где КАЖДАЯ запись записывается как экстраполяция от
ближайшего родственного материала (уже загруженный OrcaSlicer/BBL generic-
профиль — самый широко протестированный апстримом дефолт для этого класса
материала), а не как измеренные данные:

- `confidence` = 0.40 (ниже дефолтного 1.0 обычного прямого импорта) — честно
  ниже, чем степень доверия к самому OrcaSlicer-источнику.
- `extrapolated_from_id`/`extrapolation_reason` заполнены на каждой записи
  (эпик прямо требует: «не выдавать экстраполяцию за проверенный профиль»).
- `params` — НЕ придуманные вендор-специфичные числа (было бы гаданием,
  запрещённым принципами зоны Mesh), а буквально смёрдженные значения
  generic-профиля класса материала (`Generic PLA`/`Generic PETG`/`Generic
  ABS`, OrcaSlicer/BBL) — placeholder до появления реального калибровочного
  сигнала (эпик v2: калибровки/Make-фидбэк).

Требует, чтобы `slicer_print_profiles.py` (шаг 2, OrcaSlicer) уже прогонялся
на `dev`/прод и загрузил `Generic PLA`/`Generic PETG`/`Generic ABS` — если
generic-профиль ещё не найден, запись этого вендора×материала пропускается
(явный `skipped_no_base` в счётчиках, не тихий silent no-op)."""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, field
from typing import Any

import psycopg

from .. import db

logger = logging.getLogger("scout.sources.slicer_print_profiles_ru")

SOURCE_ID = "ru_filament_estimate"
SLICER = "orcaslicer"
_LICENSE = "unverified-estimate"
_SOURCE_NAME = "manual_ru_vendor_estimate"
_CONFIDENCE = 0.40

# (vendor_slug, отображаемое имя) — RU-вендоры филамента без собственного
# профиля в открытых репозиториях слайсеров (эпик MF-34 § «RU-специфика»,
# перечислены в vision.md/features.md как ров против MakerWorld/Printables).
RU_VENDORS: tuple[tuple[str, str], ...] = (
    ("fdplast", "FDplast"),
    ("bestfilament", "Bestfilament"),
    ("rec", "REC"),
    ("plastico", "PLASTICO"),
)

# (material_slug, отображаемое имя, имя generic-профиля OrcaSlicer/BBL —
# точка экстраполяции). Материалы — те же три, что порог эпика (PLA/PETG/ABS).
RU_MATERIALS: tuple[tuple[str, str, str], ...] = (
    ("pla", "PLA", "Generic PLA"),
    ("petg", "PETG", "Generic PETG"),
    ("abs", "ABS", "Generic ABS"),
)


def content_hash(payload: dict[str, Any]) -> bytes:
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).digest()


def external_ref(vendor_slug: str, material_slug: str) -> str:
    return f"ru:{vendor_slug}:filament:{material_slug}"


def build_extrapolation_reason(vendor_name: str, generic_name: str) -> str:
    return (
        f"у {vendor_name} нет собственного профиля в открытых репозиториях "
        f"слайсеров (OrcaSlicer/PrusaSlicer) — параметры экстраполированы от "
        f"ближайшего родственного материала «{generic_name}» (OrcaSlicer/BBL) "
        f"без вендор-специфичной калибровки; заменить точными значениями, "
        f"когда появится калибровочный сигнал (эпик MF-34, v2: калибровки/"
        f"Make-фидбэк)."
    )


@dataclass(frozen=True)
class RuFilamentCandidate:
    vendor_slug: str
    material_slug: str
    name: str
    params: dict[str, Any] = field(compare=False)
    extrapolated_from_id: str
    extrapolation_reason: str = field(compare=False)

    @property
    def external_ref(self) -> str:
        return external_ref(self.vendor_slug, self.material_slug)


def build_candidate(
    *,
    vendor_slug: str,
    vendor_name: str,
    material_slug: str,
    material_name: str,
    generic_name: str,
    base_id: str,
    base_params: dict[str, Any],
) -> RuFilamentCandidate:
    return RuFilamentCandidate(
        vendor_slug=vendor_slug,
        material_slug=material_slug,
        name=f"{vendor_name} {material_name} (RU, экстраполировано)",
        params=dict(base_params),
        extrapolated_from_id=base_id,
        extrapolation_reason=build_extrapolation_reason(vendor_name, generic_name),
    )


# --- Резолв кандидатов (только чтение — под dry-run) -------------------------


def build_candidates(
    conn: psycopg.Connection,
) -> tuple[list[RuFilamentCandidate], dict[str, int]]:
    """Резолвит `Generic *`-базы и строит кандидатов — ЧИСТОЕ чтение, ничего не
    пишет (в отличие от Orca/Prusa-источников здесь нет отдельного сетевого
    фетча, который можно превью без БД: единственный якорь — уже загруженные
    generic-профили в `slicer_profiles`). CLI `--dry-run` вызывает эту функцию
    напрямую, не `ingest`, поэтому дальше правда ничего не коммитится."""
    candidates: list[RuFilamentCandidate] = []
    counters = {"found": 0, "skipped_no_base": 0}

    for vendor_slug, vendor_name in RU_VENDORS:
        for material_slug, material_name, generic_name in RU_MATERIALS:
            counters["found"] += 1
            base = db.find_slicer_profile_by_name(
                conn, slicer=SLICER, profile_class="filament", name=generic_name
            )
            if base is None:
                logger.warning(
                    "ru filament %s/%s: base profile %r not loaded yet, skipped",
                    vendor_slug, material_slug, generic_name,
                )
                counters["skipped_no_base"] += 1
                continue
            base_id, _own_params = base
            base_params = db.resolve_slicer_profile_params(conn, base_id)

            candidates.append(
                build_candidate(
                    vendor_slug=vendor_slug,
                    vendor_name=vendor_name,
                    material_slug=material_slug,
                    material_name=material_name,
                    generic_name=generic_name,
                    base_id=base_id,
                    base_params=base_params,
                )
            )

    return candidates, counters


# --- Ingest ------------------------------------------------------------------


def ingest(conn: psycopg.Connection) -> dict[str, int]:
    candidates, counters = build_candidates(conn)
    counters = dict(counters)
    counters["candidates"] = 0
    counters["promoted"] = 0

    for candidate in candidates:
        raw = {
            "vendor_slug": candidate.vendor_slug,
            "material_slug": candidate.material_slug,
            "extrapolated_from": candidate.extrapolation_reason,
            "params": candidate.params,
        }
        raw_hash = content_hash(raw)
        db.upsert_slicer_profile_candidate(
            conn,
            source=SOURCE_ID,
            source_url=None,
            external_ref=candidate.external_ref,
            raw=raw,
            content_hash=raw_hash,
        )
        counters["candidates"] += 1

        profile_hash = content_hash(
            {
                "profile_class": "filament",
                "slicer": SLICER,
                "name": candidate.name,
                "params": candidate.params,
            }
        )
        profile_id = db.upsert_slicer_profile(
            conn,
            profile_class="filament",
            slicer=SLICER,
            setting_id=None,
            name=candidate.name,
            params=candidate.params,
            source_name=_SOURCE_NAME,
            source_url=None,
            source_ref=None,
            license=_LICENSE,
            confidence=_CONFIDENCE,
            content_hash=profile_hash,
            extrapolated_from_id=candidate.extrapolated_from_id,
            extrapolation_reason=candidate.extrapolation_reason,
        )
        db.mark_slicer_profile_candidate_merged(
            conn, source=SOURCE_ID, external_ref=candidate.external_ref, profile_id=profile_id
        )
        counters["promoted"] += 1

    return counters
