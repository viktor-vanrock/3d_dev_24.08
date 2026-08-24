"""Юнит-тесты Postgres-слоя каталога (`giga.catalog.db`) на фейковом
connection/cursor — паттерн `test_calendar_db.py`/`test_db.py`, без реального
Postgres.
"""

from __future__ import annotations

import datetime
import hashlib
import json

from giga.catalog import db


def _hash(raw: dict) -> bytes:
    return hashlib.sha256(json.dumps(raw, sort_keys=True).encode("utf-8")).digest()


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
            source, source_url, external_ref, raw, content_hash, confidence = params
            self._last = self._conn.upsert_candidate(
                source, source_url, external_ref, raw, bytes(content_hash), confidence
            )
        elif "insert into ingest_runs" in text:
            self._conn.runs.append(params)
            self._last = None
        else:
            raise AssertionError(f"unexpected SQL: {text}")

    def fetchone(self):
        return self._last


class FakeConn:
    def __init__(self):
        self.executed: list[tuple[str, tuple]] = []
        self.candidates: dict[tuple[str, str], dict] = {}
        self.runs: list[tuple] = []

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        pass

    def upsert_candidate(self, source, source_url, external_ref, raw, content_hash, confidence):
        key = (source, external_ref)
        existing = self.candidates.get(key)
        if existing is not None and existing["content_hash"] == content_hash:
            return None  # WHERE content_hash IS DISTINCT FROM excluded — no row returned
        inserted = existing is None
        self.candidates[key] = {
            "source_url": source_url,
            "raw": raw.obj if hasattr(raw, "obj") else raw,
            "content_hash": content_hash,
            "confidence": confidence,
        }
        return (inserted,)


_RAW = {"vendor": "Prusa Research", "model": "CORE Two", "specs": {"kinematics": "corexy"}}


def test_upsert_machine_candidate_inserts_new_row():
    conn = FakeConn()

    outcome = db.upsert_machine_candidate(
        conn,
        source="giga-free-html",
        source_url="https://blog.prusa3d.com/core-two/",
        external_ref="https://blog.prusa3d.com/core-two/#prusa-research-core-two",
        raw=_RAW,
        content_hash=_hash(_RAW),
        confidence=0.9,
    )

    assert outcome == "inserted"
    assert len(conn.candidates) == 1


def test_upsert_machine_candidate_rerun_same_content_is_unchanged_not_duplicated():
    conn = FakeConn()
    kwargs = dict(
        source="giga-free-html",
        source_url="https://blog.prusa3d.com/core-two/",
        external_ref="https://blog.prusa3d.com/core-two/#prusa-research-core-two",
        raw=_RAW,
        content_hash=_hash(_RAW),
        confidence=0.9,
    )

    first = db.upsert_machine_candidate(conn, **kwargs)
    second = db.upsert_machine_candidate(conn, **kwargs)

    assert first == "inserted"
    assert second == "unchanged"
    assert len(conn.candidates) == 1  # повторный прогон не плодит дубли


def test_upsert_machine_candidate_changed_content_is_updated():
    conn = FakeConn()
    db.upsert_machine_candidate(
        conn,
        source="giga-free-html",
        source_url="https://blog.prusa3d.com/core-two/",
        external_ref="https://blog.prusa3d.com/core-two/#prusa-research-core-two",
        raw=_RAW,
        content_hash=_hash(_RAW),
        confidence=0.9,
    )

    changed_raw = {**_RAW, "specs": {"kinematics": "corexy", "max_nozzle_temp_c": 300}}
    outcome = db.upsert_machine_candidate(
        conn,
        source="giga-free-html",
        source_url="https://blog.prusa3d.com/core-two/",
        external_ref="https://blog.prusa3d.com/core-two/#prusa-research-core-two",
        raw=changed_raw,
        content_hash=_hash(changed_raw),
        confidence=0.9,
    )

    assert outcome == "updated"
    assert len(conn.candidates) == 1


def test_upsert_machine_candidate_different_external_ref_is_a_separate_row():
    conn = FakeConn()
    db.upsert_machine_candidate(
        conn,
        source="giga-free-html",
        source_url="https://blog.prusa3d.com/core-two/",
        external_ref="https://blog.prusa3d.com/core-two/#prusa-research-core-two",
        raw=_RAW,
        content_hash=_hash(_RAW),
        confidence=0.9,
    )
    other_raw = {"vendor": "Prusa Research", "model": "CORE One", "specs": {}}
    db.upsert_machine_candidate(
        conn,
        source="giga-free-html",
        source_url="https://blog.prusa3d.com/core-two/",
        external_ref="https://blog.prusa3d.com/core-two/#prusa-research-core-one",
        raw=other_raw,
        content_hash=_hash(other_raw),
        confidence=0.8,
    )

    assert len(conn.candidates) == 2


def test_record_ingest_run_writes_row():
    conn = FakeConn()
    started_at = datetime.datetime(2026, 7, 10, tzinfo=datetime.UTC)

    db.record_ingest_run(
        conn,
        source="giga-free-html",
        started_at=started_at,
        found=3,
        changed=2,
        rejected=1,
        error=None,
    )

    assert len(conn.runs) == 1
    assert conn.runs[0] == ("giga-free-html", started_at, 3, 2, 1, None)
