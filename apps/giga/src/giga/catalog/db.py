"""Postgres-доступ к `machine_candidates`/`ingest_runs` (владелец схемы — `api`,
`apps/api/db/migrations/20260709000001_baseline.sql`) — тот же идемпотентный
контракт, что `apps/api/src/catalog/ingest/run.ts::runIngest` (unique(source,
external_ref) + content_hash, статус сбрасывается в 'pending' при изменившемся
контенте — повторный прогон источника не должен молча похоронить обновлённые
данные под уже обработанным статусом), реализованный на стороне giga напрямую
psycopg (см. `giga.catalog.__init__` docstring — без HTTP между api/giga).
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

import psycopg
from psycopg.types.json import Jsonb

UpsertOutcome = Literal["inserted", "updated", "unchanged"]


def upsert_machine_candidate(
    conn: psycopg.Connection,
    *,
    source: str,
    source_url: str | None,
    external_ref: str,
    raw: dict,
    content_hash: bytes,
    confidence: float,
) -> UpsertOutcome:
    """Идемпотентный ре-ингест по `unique(source, external_ref)`.

    Хэш не изменился → строка не трогается вовсе (резолвер мог уже проставить
    `status`/`matched_machine_id` — повторный прогон источника с тем же текстом
    не должен откатывать его работу). `xmax = 0` в RETURNING — стандартный
    способ psycopg/postgres отличить INSERT от UPDATE у одного `ON CONFLICT`.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into machine_candidates
                (source, source_url, external_ref, raw, content_hash, confidence, status)
            values (%s, %s, %s, %s, %s, %s, 'pending')
            on conflict (source, external_ref) do update
               set raw = excluded.raw,
                   source_url = excluded.source_url,
                   content_hash = excluded.content_hash,
                   confidence = excluded.confidence,
                   status = 'pending',
                   updated_at = now()
             where machine_candidates.content_hash is distinct from excluded.content_hash
            returning (xmax = 0) as inserted
            """,
            (source, source_url, external_ref, Jsonb(raw), content_hash, confidence),
        )
        row = cur.fetchone()
    conn.commit()
    if row is None:
        return "unchanged"
    return "inserted" if row[0] else "updated"


def record_ingest_run(
    conn: psycopg.Connection,
    *,
    source: str,
    started_at: datetime,
    found: int,
    changed: int,
    rejected: int,
    error: str | None,
) -> None:
    """Аудит-лог прогона — та же таблица/форма, что `runIngest` (TS) пишет для
    структурных адаптеров (`ingest_runs`, found/changed/rejected/error)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into ingest_runs (source, started_at, found, changed, rejected, error)
            values (%s, %s, %s, %s, %s, %s)
            """,
            (source, started_at, found, changed, rejected, error),
        )
    conn.commit()
