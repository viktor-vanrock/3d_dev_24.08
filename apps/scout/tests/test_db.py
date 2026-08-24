"""Юнит-тесты Postgres-слоя (`scout.db`) на фейковом connection/cursor —
паттерн `apps/giga/tests/test_calendar_db.py`, без реального Postgres.
"""

from __future__ import annotations

import datetime

from scout import db


class FakeCursor:
    def __init__(self, conn):
        self._conn = conn
        self._last = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=()):
        text = " ".join(sql.split())
        self._conn.executed.append((text, params))

        if "insert into machine_candidates" in text:
            source, source_url, external_ref, raw, content_hash = params
            outcome = self._conn.upsert_candidate(
                self._conn.candidates, source, source_url, external_ref, raw, content_hash
            )
            # `ON CONFLICT ... WHERE ... RETURNING` не возвращает строку при
            # unchanged — эмулируем: None означает "нет строки", не `(None,)`.
            self._last = None if outcome is None else (outcome,)
        elif "insert into material_candidates" in text:
            source, source_url, external_ref, raw, content_hash = params
            outcome = self._conn.upsert_candidate(
                self._conn.material_candidates, source, source_url, external_ref, raw, content_hash
            )
            self._last = None if outcome is None else (outcome,)
        elif "insert into vendors" in text:
            slug, name = params
            self._last = (self._conn.upsert_vendor(slug, name),)
        elif "select id, announced_at" in text:
            vendor_id, model_name, status = params
            self._last = self._conn.find_release_event(vendor_id, model_name, status)
        elif "insert into release_events" in text:
            self._conn.insert_release_event(params)
            self._last = None
        elif "update release_events" in text:
            self._conn.update_release_event(params)
            self._last = None
        else:
            raise AssertionError(f"unexpected SQL: {text}")

    def fetchone(self):
        return self._last


class FakeConn:
    def __init__(self):
        self.executed: list[tuple[str, tuple]] = []
        self.candidates: dict[tuple[str, str], dict] = {}  # (source, external_ref) -> row
        self.material_candidates: dict[tuple[str, str], dict] = {}
        self.vendors: dict[str, str] = {}  # slug -> id
        self.events: dict[str, dict] = {}
        self._seq = 0

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        pass

    def _next_id(self, prefix: str) -> str:
        self._seq += 1
        return f"{prefix}-{self._seq}"

    def upsert_candidate(
        self, table: dict, source, source_url, external_ref, raw, content_hash
    ) -> bool | None:
        """True=inserted, False=updated, None=unchanged (хэш совпал) — эмулирует
        `xmax = 0` RETURNING под `WHERE content_hash is distinct from ...`."""
        key = (source, external_ref)
        existing = table.get(key)
        if existing is None:
            table[key] = {
                "source_url": source_url,
                "raw": raw,
                "content_hash": bytes(content_hash),
            }
            return True
        if existing["content_hash"] == bytes(content_hash):
            return None
        existing.update(source_url=source_url, raw=raw, content_hash=bytes(content_hash))
        return False

    def upsert_vendor(self, slug: str, name: str) -> str:
        vendor_id = self.vendors.get(slug) or self._next_id("vendor")
        self.vendors[slug] = vendor_id
        return vendor_id

    def find_release_event(self, vendor_id: str, model_name: str, status: str) -> tuple | None:
        for event_id, e in self.events.items():
            same_vendor = e["vendor_id"] == vendor_id
            same_model = e["model_name"] == model_name
            same_status = e["status"] == status
            if same_vendor and same_model and same_status:
                return (
                    event_id,
                    e["announced_at"],
                    e["preorder_at"],
                    e["ship_at"],
                    e["eol_at"],
                    e["source_url"],
                )
        return None

    def insert_release_event(self, params) -> None:
        (
            vendor_id,
            model_name,
            status,
            announced_at,
            preorder_at,
            ship_at,
            eol_at,
            source_url,
        ) = params
        event_id = self._next_id("event")
        self.events[event_id] = {
            "vendor_id": vendor_id,
            "model_name": model_name,
            "status": status,
            "announced_at": _to_date(announced_at),
            "preorder_at": _to_date(preorder_at),
            "ship_at": _to_date(ship_at),
            "eol_at": _to_date(eol_at),
            "source_url": source_url,
        }

    def update_release_event(self, params) -> None:
        announced_at, preorder_at, ship_at, eol_at, source_url, event_id = params
        e = self.events[event_id]
        e.update(
            announced_at=_to_date(announced_at),
            preorder_at=_to_date(preorder_at),
            ship_at=_to_date(ship_at),
            eol_at=_to_date(eol_at),
            source_url=source_url,
        )


def _to_date(value: str | None) -> datetime.date | None:
    return datetime.date.fromisoformat(value) if value else None


_RAW = {"model_name": "MK4S", "offers": {"price": "799.20"}}
_HASH = b"\x01" * 32
_HASH_2 = b"\x02" * 32


def test_upsert_machine_candidate_inserts_new_row():
    conn = FakeConn()

    outcome = db.upsert_machine_candidate(
        conn,
        source="vendor_whitelist",
        source_url="https://www.prusa3d.com/product/original-prusa-mk4s-3d-printer/",
        external_ref="https://www.prusa3d.com/product/original-prusa-mk4s-3d-printer/",
        raw=_RAW,
        content_hash=_HASH,
    )

    assert outcome == "inserted"
    assert len(conn.candidates) == 1


def test_upsert_machine_candidate_rerun_same_hash_is_unchanged_not_duplicated():
    conn = FakeConn()
    kwargs = dict(
        source="vendor_whitelist",
        source_url="https://example.invalid/product/x/",
        external_ref="https://example.invalid/product/x/",
        raw=_RAW,
        content_hash=_HASH,
    )

    first = db.upsert_machine_candidate(conn, **kwargs)
    second = db.upsert_machine_candidate(conn, **kwargs)

    assert first == "inserted"
    assert second == "unchanged"
    assert len(conn.candidates) == 1  # повторный прогон не плодит дубли


def test_upsert_machine_candidate_changed_hash_is_updated():
    conn = FakeConn()
    kwargs = dict(
        source="vendor_whitelist",
        source_url="https://example.invalid/product/x/",
        external_ref="https://example.invalid/product/x/",
        raw=_RAW,
    )

    db.upsert_machine_candidate(conn, content_hash=_HASH, **kwargs)
    outcome = db.upsert_machine_candidate(conn, content_hash=_HASH_2, **kwargs)

    assert outcome == "updated"
    assert len(conn.candidates) == 1


def test_upsert_machine_candidate_different_external_ref_is_a_separate_row():
    conn = FakeConn()
    db.upsert_machine_candidate(
        conn,
        source="vendor_whitelist",
        source_url="https://example.invalid/product/a/",
        external_ref="https://example.invalid/product/a/",
        raw=_RAW,
        content_hash=_HASH,
    )
    db.upsert_machine_candidate(
        conn,
        source="vendor_whitelist",
        source_url="https://example.invalid/product/b/",
        external_ref="https://example.invalid/product/b/",
        raw=_RAW,
        content_hash=_HASH,
    )

    assert len(conn.candidates) == 2


def test_upsert_material_candidate_inserts_new_row():
    conn = FakeConn()

    outcome = db.upsert_material_candidate(
        conn,
        source="spoolman",
        source_url="https://raw.githubusercontent.com/Donkie/SpoolmanDB/main/filaments/sunlu.json",
        external_ref="spoolman:sunlu:pla:color-name:1.75:black",
        raw=_RAW,
        content_hash=_HASH,
    )

    assert outcome == "inserted"
    assert len(conn.material_candidates) == 1
    assert len(conn.candidates) == 0  # отдельная таблица от machine_candidates


def test_upsert_material_candidate_rerun_same_hash_is_unchanged_not_duplicated():
    conn = FakeConn()
    kwargs = dict(
        source="spoolman",
        source_url="https://raw.githubusercontent.com/Donkie/SpoolmanDB/main/filaments/sunlu.json",
        external_ref="spoolman:sunlu:pla:color-name:1.75:black",
        raw=_RAW,
        content_hash=_HASH,
    )

    first = db.upsert_material_candidate(conn, **kwargs)
    second = db.upsert_material_candidate(conn, **kwargs)

    assert first == "inserted"
    assert second == "unchanged"
    assert len(conn.material_candidates) == 1  # повторный прогон не плодит дубли


def test_upsert_material_candidate_changed_hash_is_updated():
    conn = FakeConn()
    kwargs = dict(
        source="spoolman",
        source_url="https://raw.githubusercontent.com/Donkie/SpoolmanDB/main/filaments/sunlu.json",
        external_ref="spoolman:sunlu:pla:color-name:1.75:black",
        raw=_RAW,
    )

    db.upsert_material_candidate(conn, content_hash=_HASH, **kwargs)
    outcome = db.upsert_material_candidate(conn, content_hash=_HASH_2, **kwargs)

    assert outcome == "updated"
    assert len(conn.material_candidates) == 1


def test_get_or_create_vendor_reuses_existing_slug():
    conn = FakeConn()
    first = db.get_or_create_vendor(conn, "prusa-research", "Prusa Research")
    second = db.get_or_create_vendor(conn, "prusa-research", "Prusa Research")
    assert first == second


def test_upsert_release_event_inserts_new_row():
    conn = FakeConn()
    vendor_id = conn.upsert_vendor("prusa-research", "Prusa Research")

    outcome = db.upsert_release_event(
        conn,
        vendor_id=vendor_id,
        model_name="MK4S",
        status="announced",
        dates={"announced_at": "2026-07-01", "preorder_at": None, "ship_at": None, "eol_at": None},
        source_url="https://www.prusa3d.com/product/original-prusa-mk4s-3d-printer/",
    )

    assert outcome == "inserted"
    assert len(conn.events) == 1


def test_upsert_release_event_rerun_same_data_is_unchanged_not_duplicated():
    conn = FakeConn()
    vendor_id = conn.upsert_vendor("prusa-research", "Prusa Research")
    kwargs = dict(
        vendor_id=vendor_id,
        model_name="MK4S",
        status="announced",
        dates={"announced_at": "2026-07-01", "preorder_at": None, "ship_at": None, "eol_at": None},
        source_url="https://www.prusa3d.com/product/original-prusa-mk4s-3d-printer/",
    )

    first = db.upsert_release_event(conn, **kwargs)
    second = db.upsert_release_event(conn, **kwargs)

    assert first == "inserted"
    assert second == "unchanged"
    assert len(conn.events) == 1


def test_upsert_release_event_merges_new_date_without_forgetting_old():
    conn = FakeConn()
    vendor_id = conn.upsert_vendor("prusa-research", "Prusa Research")
    db.upsert_release_event(
        conn,
        vendor_id=vendor_id,
        model_name="MK4S",
        status="announced",
        dates={"announced_at": "2026-06-01", "preorder_at": None, "ship_at": None, "eol_at": None},
        source_url="https://www.prusa3d.com/product/original-prusa-mk4s-3d-printer/",
    )

    outcome = db.upsert_release_event(
        conn,
        vendor_id=vendor_id,
        model_name="MK4S",
        status="announced",
        dates={"announced_at": None, "preorder_at": "2026-07-03", "ship_at": None, "eol_at": None},
        source_url="https://www.prusa3d.com/product/original-prusa-mk4s-3d-printer/",
    )

    assert outcome == "updated"
    event = next(iter(conn.events.values()))
    assert event["announced_at"] == datetime.date(2026, 6, 1)
    assert event["preorder_at"] == datetime.date(2026, 7, 3)
