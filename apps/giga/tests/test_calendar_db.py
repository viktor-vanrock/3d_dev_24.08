"""Юнит-тесты Postgres-слоя календаря (`giga.calendar.db`) на фейковом
connection/cursor — паттерн `tests/test_db.py`, без реального Postgres.
"""

from __future__ import annotations

import datetime

from giga.calendar import db


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

        if "insert into vendors" in text:
            slug, name = params
            self._last = (self._conn.upsert_vendor(slug, name),)
        elif "select id from machines" in text:
            vendor_id, model_name = params
            self._last = self._conn.find_machine(vendor_id, model_name)
        elif "select id, machine_id, announced_at" in text:
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
        self.vendors: dict[str, str] = {}  # slug -> id
        self.machines: list[dict] = []
        self.events: dict[str, dict] = {}
        self._seq = 0

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        pass

    def _next_id(self, prefix: str) -> str:
        self._seq += 1
        return f"{prefix}-{self._seq}"

    def upsert_vendor(self, slug: str, name: str) -> str:
        vendor_id = self.vendors.get(slug) or self._next_id("vendor")
        self.vendors[slug] = vendor_id
        return vendor_id

    def add_machine(self, vendor_id: str, model: str) -> str:
        machine_id = self._next_id("machine")
        self.machines.append({"id": machine_id, "vendor_id": vendor_id, "model": model})
        return machine_id

    def find_machine(self, vendor_id: str, model_name: str) -> tuple | None:
        for m in self.machines:
            if m["vendor_id"] == vendor_id and m["model"].lower() == model_name.lower():
                return (m["id"],)
        return None

    def find_release_event(self, vendor_id: str, model_name: str, status: str) -> tuple | None:
        for event_id, e in self.events.items():
            same_vendor = e["vendor_id"] == vendor_id
            same_model = e["model_name"] == model_name
            same_status = e["status"] == status
            if same_vendor and same_model and same_status:
                return (
                    event_id,
                    e["machine_id"],
                    e["announced_at"],
                    e["preorder_at"],
                    e["ship_at"],
                    e["eol_at"],
                    e["source_url"],
                )
        return None

    def insert_release_event(self, params) -> None:
        (
            machine_id,
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
            "machine_id": machine_id,
            "model_name": model_name,
            "status": status,
            "announced_at": _to_date(announced_at),
            "preorder_at": _to_date(preorder_at),
            "ship_at": _to_date(ship_at),
            "eol_at": _to_date(eol_at),
            "source_url": source_url,
        }

    def update_release_event(self, params) -> None:
        machine_id, announced_at, preorder_at, ship_at, eol_at, source_url, event_id = params
        e = self.events[event_id]
        e.update(
            machine_id=machine_id,
            announced_at=_to_date(announced_at),
            preorder_at=_to_date(preorder_at),
            ship_at=_to_date(ship_at),
            eol_at=_to_date(eol_at),
            source_url=source_url,
        )


def _to_date(value: str | None) -> datetime.date | None:
    return datetime.date.fromisoformat(value) if value else None


_DATES = {"announced_at": None, "preorder_at": None, "ship_at": "2026-07-03", "eol_at": None}


def test_get_or_create_vendor_reuses_existing_slug():
    conn = FakeConn()
    first = db.get_or_create_vendor(conn, "prusa-research", "Prusa Research")
    second = db.get_or_create_vendor(conn, "prusa-research", "Prusa Research")
    assert first == second


def test_find_machine_id_matches_case_insensitively():
    conn = FakeConn()
    vendor_id = conn.upsert_vendor("prusa-research", "Prusa Research")
    machine_id = conn.add_machine(vendor_id, "CORE One")

    found = db.find_machine_id(conn, vendor_id, "core one")

    assert found == machine_id


def test_find_machine_id_returns_none_when_no_match():
    conn = FakeConn()
    vendor_id = conn.upsert_vendor("prusa-research", "Prusa Research")
    assert db.find_machine_id(conn, vendor_id, "Unknown Model") is None


def test_upsert_release_event_inserts_new_row():
    conn = FakeConn()
    vendor_id = conn.upsert_vendor("prusa-research", "Prusa Research")

    outcome = db.upsert_release_event(
        conn,
        vendor_id=vendor_id,
        machine_id=None,
        model_name="INDX",
        status="shipping",
        dates=_DATES,
        source_url="https://blog.prusa3d.com/indx/",
    )

    assert outcome == "inserted"
    assert len(conn.events) == 1


def test_upsert_release_event_rerun_same_data_is_unchanged_not_duplicated():
    conn = FakeConn()
    vendor_id = conn.upsert_vendor("prusa-research", "Prusa Research")
    kwargs = dict(
        vendor_id=vendor_id,
        machine_id=None,
        model_name="INDX",
        status="shipping",
        dates=_DATES,
        source_url="https://blog.prusa3d.com/indx/",
    )

    first = db.upsert_release_event(conn, **kwargs)
    second = db.upsert_release_event(conn, **kwargs)

    assert first == "inserted"
    assert second == "unchanged"
    assert len(conn.events) == 1  # повторный прогон не плодит дубли


def test_upsert_release_event_merges_new_date_without_forgetting_old():
    conn = FakeConn()
    vendor_id = conn.upsert_vendor("prusa-research", "Prusa Research")
    db.upsert_release_event(
        conn,
        vendor_id=vendor_id,
        machine_id=None,
        model_name="INDX",
        status="shipping",
        dates={"announced_at": "2026-06-01", "preorder_at": None, "ship_at": None, "eol_at": None},
        source_url="https://blog.prusa3d.com/indx/",
    )

    outcome = db.upsert_release_event(
        conn,
        vendor_id=vendor_id,
        machine_id=None,
        model_name="INDX",
        status="shipping",
        dates={"announced_at": None, "preorder_at": None, "ship_at": "2026-07-03", "eol_at": None},
        source_url="https://blog.prusa3d.com/indx/",
    )

    assert outcome == "updated"
    event = next(iter(conn.events.values()))
    assert event["announced_at"] == datetime.date(2026, 6, 1)
    assert event["ship_at"] == datetime.date(2026, 7, 3)


def test_upsert_release_event_different_status_is_a_separate_row():
    conn = FakeConn()
    vendor_id = conn.upsert_vendor("prusa-research", "Prusa Research")
    db.upsert_release_event(
        conn,
        vendor_id=vendor_id,
        machine_id=None,
        model_name="INDX",
        status="announced",
        dates={"announced_at": "2026-05-01", "preorder_at": None, "ship_at": None, "eol_at": None},
        source_url="https://blog.prusa3d.com/indx/",
    )
    outcome = db.upsert_release_event(
        conn,
        vendor_id=vendor_id,
        machine_id=None,
        model_name="INDX",
        status="shipping",
        dates=_DATES,
        source_url="https://blog.prusa3d.com/indx/",
    )

    assert outcome == "inserted"
    assert len(conn.events) == 2
