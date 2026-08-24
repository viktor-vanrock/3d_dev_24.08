"""Postgres-доступ к календарю релизов (`release_events`/`vendors`/`machines` —
владелец схемы `api`, `giga` пишет через тот же `DATABASE_URL`, см. `giga.db`).

Идемпотентность без миграции схемы (MF-644: в `release_events` сейчас нет
unique-констрейнта под дедуп; добавлять его — вердикт Data, не блокируем этим
карточку) — дедуп на уровне агента: естественный ключ `(vendor_id, model_name,
status)` ищется перед вставкой; при совпадении — молчим (`unchanged`); при
новой информации (даты/источник/найденный machine_id) — обновляем
(`updated`), никогда не вставляем дубль-строку.
"""

from __future__ import annotations

from typing import Literal

import psycopg

UpsertOutcome = Literal["inserted", "updated", "unchanged"]

_DATE_FIELDS = ("announced_at", "preorder_at", "ship_at", "eol_at")


def get_or_create_vendor(conn: psycopg.Connection, slug: str, name: str) -> str:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into vendors (slug, name) values (%s, %s)
            on conflict (slug) do update set name = excluded.name
            returning id
            """,
            (slug, name),
        )
        row = cur.fetchone()
    conn.commit()
    return str(row[0])


def find_machine_id(conn: psycopg.Connection, vendor_id: str, model_name: str) -> str | None:
    """Best-effort матчинг на существующую каноническую запись станка по имени.

    Не находит — штатный кейс (`release_events.machine_id` nullable в
    schema.ts, комментарий "анонс может существовать до полной каноничной
    записи"): пишем событие с `machine_id=null`, `model_name` текстом.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            select id from machines
             where vendor_id = %s and lower(model) = lower(%s)
             order by created_at
             limit 1
            """,
            (vendor_id, model_name),
        )
        row = cur.fetchone()
    return str(row[0]) if row else None


def upsert_release_event(
    conn: psycopg.Connection,
    *,
    vendor_id: str,
    machine_id: str | None,
    model_name: str,
    status: str,
    dates: dict[str, str | None],
    source_url: str,
) -> UpsertOutcome:
    with conn.cursor() as cur:
        cur.execute(
            """
            select id, machine_id, announced_at, preorder_at, ship_at, eol_at, source_url
              from release_events
             where vendor_id = %s and model_name = %s and status = %s
            """,
            (vendor_id, model_name, status),
        )
        existing = cur.fetchone()

        if existing is None:
            cur.execute(
                """
                insert into release_events
                    (machine_id, vendor_id, model_name, status,
                     announced_at, preorder_at, ship_at, eol_at, source_url)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    machine_id,
                    vendor_id,
                    model_name,
                    status,
                    dates.get("announced_at"),
                    dates.get("preorder_at"),
                    dates.get("ship_at"),
                    dates.get("eol_at"),
                    source_url,
                ),
            )
            conn.commit()
            return "inserted"

        event_id, existing_machine_id, *existing_date_values = existing[:6]
        existing_source_url = existing[6]
        existing_dates = {
            field: value.isoformat() if value else None
            for field, value in zip(_DATE_FIELDS, existing_date_values, strict=True)
        }
        # Новые даты дополняют, но не затирают уже известные — повторный
        # прогон с менее полным экстрактом той же статьи не должен "забыть"
        # дату, которую нашёл предыдущий прогон.
        merged_dates = {
            field: dates.get(field) or existing_dates[field] for field in _DATE_FIELDS
        }
        merged_machine_id = machine_id or existing_machine_id

        unchanged = (
            merged_dates == existing_dates
            and merged_machine_id == existing_machine_id
            and source_url == existing_source_url
        )
        if unchanged:
            return "unchanged"

        cur.execute(
            """
            update release_events
               set machine_id = %s, announced_at = %s, preorder_at = %s,
                   ship_at = %s, eol_at = %s, source_url = %s, updated_at = now()
             where id = %s
            """,
            (
                merged_machine_id,
                merged_dates["announced_at"],
                merged_dates["preorder_at"],
                merged_dates["ship_at"],
                merged_dates["eol_at"],
                source_url,
                event_id,
            ),
        )
    conn.commit()
    return "updated"
