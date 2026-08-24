"""Запись обработанного фото Make в S3 + `make_photos` (MF-393 шаг 3 / MF-783).

Вызывается синхронно из HTTP-эндпоинта (`mesh.main`), не через очередь конвертации
ревизий (`mesh.revision_worker`): в отличие от геометрии (конвертация/оптимизация — тяжёлая
CPU-работа, см. `docs/architecture/readme.md`), ресайз фото в три webp-варианта —
операция на десятки-сотни мс; отдельная асинхронная очередь ради неё — overengineering
для v0.
"""

from __future__ import annotations

import os
import uuid
from dataclasses import dataclass

import psycopg

from .storage import ObjectStore, make_photo_key


class MakeNotFoundError(Exception):
    """make_id не существует в таблице `makes` — 404 на границе API."""


class DuplicatePhotoError(Exception):
    """Перцептивно совпадающее фото уже опубликовано под другой моделью — 422 (MF-780).

    Фрод-паттерн: один и тот же кадр печати заливается под несколько разных моделей, чтобы
    накрутить агрегаты/вовлечение. Совпадение под ТОЙ ЖЕ моделью (повторная печать/ракурс той
    же вещи) — не фрод, не блокируется.
    """

    def __init__(self, existing_make_id: str):
        self.existing_make_id = existing_make_id
        message = f"perceptually duplicate photo already published under make {existing_make_id}"
        super().__init__(message)


@dataclass(frozen=True)
class MakePhotoRecord:
    id: str
    make_id: str
    s3_key: str
    position: int
    is_cover: bool
    moderation_status: str


# Порог расстояния Хэмминга (0-64 бит) — "похоже настолько, что это тот же кадр" для 64-битного
# aHash; тот же дефолт и та же env-точка расширения, что apps/api/src/security/rateLimit.ts
# держит для лимитов (перечитывается на каждый вызов, без пересборки).
def _duplicate_hamming_threshold() -> int:
    raw = os.getenv("MAKE_PHOTO_DUPLICATE_HAMMING_THRESHOLD")
    if raw is None:
        return 6
    try:
        value = int(raw)
    except ValueError:
        return 6
    return value if value >= 0 else 6


def _make_row(conn: psycopg.Connection, make_id: str) -> tuple[str, str] | None:
    """(id, model_id) существующего Make или None."""
    with conn.cursor() as cur:
        cur.execute("select id, model_id from makes where id = %s", (make_id,))
        row = cur.fetchone()
        return (row[0], str(row[1])) if row else None


def find_cross_model_duplicate(conn: psycopg.Connection, phash: int, model_id: str) -> str | None:
    """id существующего Make с перцептивно совпадающим фото под ДРУГОЙ моделью, если есть.

    Полный скан `make_photo_hashes` (MVP-объём, см. миграцию 20260710300000_make_antiabuse.sql) —
    расстояние Хэмминга через `bit_count` на `bit(64)`, без внешнего ANN-индекса. Специализированный
    индекс заведёт Data по факту роста объёма, не заранее (тот же принцип, что агрегатные view
    make_compat_aggregates.sql).
    """
    threshold = _duplicate_hamming_threshold()
    with conn.cursor() as cur:
        cur.execute(
            """
            select h.make_id
              from make_photo_hashes h
              join makes mk on mk.id = h.make_id
             where mk.model_id <> %s
               and bit_count(h.phash::bit(64) # %s::bigint::bit(64)) <= %s
             order by bit_count(h.phash::bit(64) # %s::bigint::bit(64)) asc
             limit 1
            """,
            (model_id, phash, threshold, phash),
        )
        row = cur.fetchone()
        return str(row[0]) if row else None


def _next_position_and_cover(conn: psycopg.Connection, make_id: str) -> tuple[int, bool]:
    """Следующая позиция и признак «первое фото этого Make» (→ обложка по умолчанию)."""
    with conn.cursor() as cur:
        cur.execute(
            "select count(*), coalesce(max(position), -1) from make_photos where make_id = %s",
            (make_id,),
        )
        count, max_position = cur.fetchone()
    return int(max_position) + 1, count == 0


def insert_make_photo(
    conn: psycopg.Connection,
    store: ObjectStore,
    make_id: str,
    variants: dict[str, bytes],
    moderation_status: str,
    phash: int,
) -> MakePhotoRecord:
    """Заливает варианты в S3, затем пишет строку `make_photos` + перцептивный хэш (MF-780).

    Порядок важен: если заливка в S3 упадёт — строка в БД не появится и не будет
    ссылаться на несуществующий объект (`s3_key` в схеме — not null). `photo_id`
    генерируется ДО загрузки: S3-ключи строятся из него (`make_photo_key`), а не
    наоборот, поэтому вставка с явным `id` не создаёт рассинхрон с уже залитыми ключами.

    Дедуп-проверка (MF-780, анти-фрод «то же фото под другой моделью») идёт ДО заливки в
    S3 — дешевле отказать раньше, чем заливать три webp-варианта впустую.
    """
    make = _make_row(conn, make_id)
    if make is None:
        raise MakeNotFoundError(make_id)
    _, model_id = make

    duplicate_make_id = find_cross_model_duplicate(conn, phash, model_id)
    if duplicate_make_id is not None:
        raise DuplicatePhotoError(duplicate_make_id)

    photo_id = str(uuid.uuid4())
    for variant, data in variants.items():
        key = make_photo_key(make_id, photo_id, variant)
        store.upload_bytes(data, key, content_type="image/webp")

    full_key = make_photo_key(make_id, photo_id, "full")
    position, is_cover = _next_position_and_cover(conn, make_id)
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into make_photos (id, make_id, s3_key, position, is_cover, moderation_status)
            values (%s, %s, %s, %s, %s, %s)
            """,
            (photo_id, make_id, full_key, position, is_cover, moderation_status),
        )
        cur.execute(
            "insert into make_photo_hashes (make_id, photo_id, phash) values (%s, %s, %s)",
            (make_id, photo_id, phash),
        )
    conn.commit()
    return MakePhotoRecord(
        id=photo_id,
        make_id=make_id,
        s3_key=full_key,
        position=position,
        is_cover=is_cover,
        moderation_status=moderation_status,
    )
