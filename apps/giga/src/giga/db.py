"""Read/write API for generation rows owned by the Nest API schema.

Queue lifecycle mutations live in :mod:`giga.generation_lifecycle`; this module
only serves the HTTP surface that creates and reads generations.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

_SELECT_COLUMNS = """
    id, user_id, branch, prompt, params, status, artifact_url,
    preview_url, error, created_at, updated_at
"""


@dataclass(frozen=True)
class Generation:
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


def create_generation(
    conn: psycopg.Connection,
    user_id: str,
    branch: str,
    prompt: str,
    params: dict[str, Any],
) -> Generation:
    """Create a queued job; the lifecycle worker claims it asynchronously."""
    with conn.cursor() as cur:
        cur.execute(
            f"""
            insert into generations (user_id, branch, prompt, params)
            values (%s, %s, %s, %s)
            returning {_SELECT_COLUMNS}
            """,
            (user_id, branch, prompt, Jsonb(params)),
        )
        row = cur.fetchone()
    conn.commit()
    return _row_to_generation(row)


def get_generation(conn: psycopg.Connection, generation_id: str) -> Generation | None:
    with conn.cursor() as cur:
        cur.execute(
            f"select {_SELECT_COLUMNS} from generations where id = %s",
            (generation_id,),
        )
        row = cur.fetchone()
    return _row_to_generation(row) if row else None


def list_generations_by_user(conn: psycopg.Connection, user_id: str) -> list[Generation]:
    with conn.cursor() as cur:
        cur.execute(
            f"""
            select {_SELECT_COLUMNS} from generations
             where user_id = %s
             order by created_at desc
            """,
            (user_id,),
        )
        rows = cur.fetchall()
    return [_row_to_generation(row) for row in rows]


def _row_to_generation(row: tuple[object, ...]) -> Generation:
    return Generation(
        id=str(row[0]),
        user_id=str(row[1]),
        branch=str(row[2]),
        prompt=str(row[3]),
        params=dict(row[4]) if isinstance(row[4], dict) else {},
        status=str(row[5]),
        artifact_url=None if row[6] is None else str(row[6]),
        preview_url=None if row[7] is None else str(row[7]),
        error=None if row[8] is None else str(row[8]),
        created_at=str(row[9]),
        updated_at=str(row[10]),
    )
