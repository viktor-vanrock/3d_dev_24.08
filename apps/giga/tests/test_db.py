"""Unit tests for the generation HTTP repository."""

from __future__ import annotations

from psycopg.types.json import Jsonb

from giga import db


class FakeCursor:
    def __init__(self, conn):
        self._conn = conn
        self._last = None
        self._last_many: list | None = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=()):
        text = " ".join(sql.split())
        if "insert into generations" in text:
            user_id, branch, prompt, params_jsonb = params
            self._last = self._conn.insert(user_id, branch, prompt, params_jsonb)
        elif "where id = %s" in text:
            self._last = self._conn.get(params[0])
        elif "where user_id = %s" in text:
            self._last_many = self._conn.list_by_user(params[0])
        else:
            raise AssertionError(f"unexpected SQL: {text}")

    def fetchone(self):
        return self._last

    def fetchall(self):
        return self._last_many or []


class FakeConn:
    def __init__(self):
        self.rows: dict[str, dict] = {}
        self._seq = 0

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        pass

    @staticmethod
    def _as_row(row: dict) -> tuple:
        return (
            row["id"],
            row["user_id"],
            row["branch"],
            row["prompt"],
            row["params"],
            row["status"],
            None,
            None,
            None,
            row["created_at"],
            row["updated_at"],
        )

    def insert(self, user_id, branch, prompt, params_jsonb) -> tuple:
        self._seq += 1
        generation_id = f"gen-{self._seq}"
        row = {
            "id": generation_id,
            "user_id": user_id,
            "branch": branch,
            "prompt": prompt,
            "params": params_jsonb.obj if isinstance(params_jsonb, Jsonb) else params_jsonb,
            "status": "queued",
            "created_at": f"2026-01-01T00:00:{self._seq:02d}",
            "updated_at": f"2026-01-01T00:00:{self._seq:02d}",
        }
        self.rows[generation_id] = row
        return self._as_row(row)

    def get(self, generation_id: str) -> tuple | None:
        row = self.rows.get(generation_id)
        return self._as_row(row) if row else None

    def list_by_user(self, user_id: str) -> list[tuple]:
        rows = [row for row in self.rows.values() if row["user_id"] == user_id]
        rows.sort(key=lambda row: row["created_at"], reverse=True)
        return [self._as_row(row) for row in rows]


def test_create_and_get_generation():
    conn = FakeConn()
    generation = db.create_generation(
        conn, "user-1", "openscad", "phone stand", {"width": 70}
    )

    assert generation.status == "queued"
    assert generation.branch == "openscad"
    fetched = db.get_generation(conn, generation.id)
    assert fetched is not None
    assert fetched.prompt == "phone stand"
    assert fetched.params == {"width": 70}


def test_get_generation_missing_returns_none():
    assert db.get_generation(FakeConn(), "missing") is None


def test_list_generations_by_user_orders_newest_first():
    conn = FakeConn()
    db.create_generation(conn, "user-1", "kzd", "first", {})
    db.create_generation(conn, "user-1", "hueforge", "second", {})
    db.create_generation(conn, "user-2", "openscad", "other", {})

    generations = db.list_generations_by_user(conn, "user-1")

    assert [generation.prompt for generation in generations] == ["second", "first"]
