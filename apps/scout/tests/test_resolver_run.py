"""Интеграционные тесты резолвера на фейковом connection/cursor — паттерн
`tests/test_db.py`, без реального Postgres. Покрывает три ветки confidence
(MF-720 § «Merge») + идемпотентность повторного прогона.
"""

from __future__ import annotations

import json

from psycopg.types.json import Jsonb

from scout.resolver import run

# Тот же owner-матрицы срез, что триггер `machine_candidates_set_ownership_trigger`
# (MF-1514, apps/api/db/migrations/20260713140000_machine_candidates_ownership.sql)
# проставляет по `source` при ingest — фейковый connection воспроизводит его,
# чтобы `_claim_pending`/`_pending_snapshot` моделировали реальный `owner = 'scout'`
# claim-predicate (MF-1517, `db.claim_pending_candidate`), а не только статус.
_SCOUT_SOURCES = {"vendor_whitelist", "slicer_profile", "ru_machine_spec"}


def _unwrap(value):
    return value.obj if isinstance(value, Jsonb) else value


def _row_tuple(row: dict) -> tuple:
    return (row["id"], row["source"], row["source_url"], row["external_ref"], row["raw"])


class FakeCursor:
    def __init__(self, conn):
        self.conn = conn
        self._one = None
        self._rows: list | None = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=()):
        text = " ".join(sql.split())
        params = tuple(_unwrap(p) for p in params)

        if "for update skip locked" in text:
            self._one = self.conn._claim_pending()
        elif text.startswith("select id from vendors"):
            (slug,) = params
            vendor = self.conn.vendors.get(slug)
            self._one = (vendor["id"],) if vendor else None
        elif text.startswith("insert into vendors"):
            slug, name = params
            self._one = (self.conn._upsert_vendor(slug, name),)
        elif text.startswith("select id, model, aliases from machines"):
            (vendor_id,) = params
            self._rows = self.conn._machines_for_vendor(vendor_id)
        elif text.startswith("insert into machines"):
            kind, vendor_id, model, specs, field_provenance, content_hash = params
            new_id = self.conn._insert_machine(
                kind, vendor_id, model, specs, field_provenance, content_hash
            )
            self._one = (new_id,)
        elif text.startswith("update machines set aliases"):
            alias, patch, machine_id = params
            self.conn._add_alias(machine_id, alias, patch)
        elif text.startswith("update machine_candidates set status"):
            status, matched_machine_id, confidence, candidate_id = params
            self.conn._mark_resolved(candidate_id, status, matched_machine_id, confidence)
        elif text.startswith("select id, source, source_url, external_ref, raw"):
            self._rows = self.conn._pending_snapshot()
        else:
            raise AssertionError(f"unexpected SQL: {text}")

    def fetchone(self):
        return self._one

    def fetchall(self):
        return self._rows or []


class FakeConn:
    def __init__(self):
        self.candidates: dict[str, dict] = {}
        self._candidate_order: list[str] = []
        self.vendors: dict[str, dict] = {}
        self.machines: dict[str, dict] = {}
        self._seq = 0
        self.commits = 0
        self.rollbacks = 0

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def _next_id(self, prefix: str) -> str:
        self._seq += 1
        return f"{prefix}-{self._seq}"

    def seed_candidate(
        self, cid: str, *, source: str, raw: dict, source_url: str | None = None
    ) -> str:
        self.candidates[cid] = {
            "id": cid,
            "source": source,
            "source_url": source_url,
            "external_ref": cid,
            "raw": raw,
            "status": "pending",
            "matched_machine_id": None,
            "confidence": None,
        }
        self._candidate_order.append(cid)
        return cid

    def seed_vendor(self, slug: str, name: str, *, vendor_id: str | None = None) -> str:
        vid = vendor_id or self._next_id("vendor")
        self.vendors[slug] = {"id": vid, "name": name}
        return vid

    def seed_machine(
        self,
        *,
        vendor_id: str,
        model: str,
        aliases: tuple[str, ...] = (),
        specs: dict | None = None,
        content_hash: bytes | None = None,
        machine_id: str | None = None,
    ) -> str:
        mid = machine_id or self._next_id("machine")
        self.machines[mid] = {
            "id": mid,
            "vendor_id": vendor_id,
            "model": model,
            "aliases": list(aliases),
            "specs": specs or {},
            "content_hash": content_hash,
            "field_provenance": {},
        }
        return mid

    def _claim_pending(self):
        for cid in self._candidate_order:
            row = self.candidates[cid]
            if row["status"] == "pending" and row["source"] in _SCOUT_SOURCES:
                return _row_tuple(row)
        return None

    def _pending_snapshot(self):
        return [
            _row_tuple(row)
            for cid in self._candidate_order
            if (row := self.candidates[cid])["status"] == "pending"
            and row["source"] in _SCOUT_SOURCES
        ]

    def _upsert_vendor(self, slug: str, name: str) -> str:
        existing = self.vendors.get(slug)
        if existing:
            existing["name"] = name
            return existing["id"]
        vendor_id = self._next_id("vendor")
        self.vendors[slug] = {"id": vendor_id, "name": name}
        return vendor_id

    def _machines_for_vendor(self, vendor_id: str):
        return [
            (m["id"], m["model"], m["aliases"])
            for m in self.machines.values()
            if m["vendor_id"] == vendor_id
        ]

    def _insert_machine(self, kind, vendor_id, model, specs, field_provenance, content_hash):
        if content_hash is not None:
            for m in self.machines.values():
                if m["content_hash"] == content_hash:
                    return m["id"]  # тот же путь, что `machines_content_hash_uidx` в Postgres
        machine_id = self._next_id("machine")
        self.machines[machine_id] = {
            "id": machine_id,
            "vendor_id": vendor_id,
            "model": model,
            "aliases": [],
            "specs": specs,
            "content_hash": content_hash,
            "kind": kind,
            "field_provenance": field_provenance,
        }
        return machine_id

    def _add_alias(self, machine_id, alias, patch):
        m = self.machines[machine_id]
        m["aliases"].append(alias)
        m["field_provenance"].update(patch)

    def _mark_resolved(self, candidate_id, status, matched_machine_id, confidence):
        self.candidates[candidate_id].update(
            status=status, matched_machine_id=matched_machine_id, confidence=confidence
        )


_PLAUSIBLE_SPECS_RAW = {
    "printable_area": ["0x0", "220x0", "220x220", "0x220"],
    "printable_height": "250",
    "nozzle_diameter_mm": ["0.4"],
    "machine_tech": "FFF",
}
_K1_MAX_RAW = {"vendor": "Creality", "model": "Creality K1 Max", **_PLAUSIBLE_SPECS_RAW}


def test_exact_duplicate_updates_existing_machine_not_insert():
    conn = FakeConn()
    vendor_id = conn.seed_vendor("creality", "Creality")
    machine_id = conn.seed_machine(vendor_id=vendor_id, model="Creality Ender-3 V2")
    conn.seed_candidate(
        "c1", source="slicer_profile", raw={"vendor": "Creality", "model": "Creality Ender-3 V2"}
    )

    counters = run.run_once(conn)

    assert counters == {"merged_update": 1, "merged_insert": 0, "matched": 0, "rejected": 0}
    assert len(conn.machines) == 1  # не завёл вторую запись
    row = conn.candidates["c1"]
    assert row["status"] == "merged"
    assert row["matched_machine_id"] == machine_id
    assert row["confidence"] == 1.0


def test_exact_duplicate_with_different_casing_adds_alias_not_new_row():
    conn = FakeConn()
    vendor_id = conn.seed_vendor("prusa-research", "Prusa Research")
    machine_id = conn.seed_machine(vendor_id=vendor_id, model="Prusa MK4S")
    conn.seed_candidate(
        "c1",
        source="vendor_whitelist",
        raw={"vendor_name": "Prusa Research", "model_name": "Original Prusa MK4S 3D Printer"},
    )

    run.run_once(conn)

    machine = conn.machines[machine_id]
    assert machine["aliases"] == ["Original Prusa MK4S 3D Printer"]
    assert "aliases" in machine["field_provenance"]
    assert machine["model"] == "Prusa MK4S"  # канонический model не тронут


def test_no_similar_machine_but_plausible_specs_inserts_new_machine():
    conn = FakeConn()
    conn.seed_vendor("creality", "Creality")  # блок вендора существует, но без похожих моделей
    conn.seed_candidate("c1", source="slicer_profile", raw=_K1_MAX_RAW)

    counters = run.run_once(conn)

    assert counters == {"merged_update": 0, "merged_insert": 1, "matched": 0, "rejected": 0}
    assert len(conn.machines) == 1
    (new_machine,) = conn.machines.values()
    assert new_machine["model"] == "Creality K1 Max"
    assert new_machine["kind"] == "fdm_printer"
    assert set(new_machine["field_provenance"]) == {"model", "specs", "kind"}
    row = conn.candidates["c1"]
    assert row["status"] == "merged"
    assert row["matched_machine_id"] == new_machine["id"]
    assert row["confidence"] >= 0.9


def test_sibling_model_with_shared_prefix_is_matched_for_review_not_auto_merged():
    conn = FakeConn()
    vendor_id = conn.seed_vendor("creality", "Creality")
    machine_id = conn.seed_machine(vendor_id=vendor_id, model="Creality Ender-3 V3 KE")
    conn.seed_candidate(
        "c1", source="slicer_profile", raw={"vendor": "Creality", "model": "Creality Ender-3 V3"}
    )

    counters = run.run_once(conn)

    assert counters == {"merged_update": 0, "merged_insert": 0, "matched": 1, "rejected": 0}
    assert len(conn.machines) == 1  # не создал новую и не тронул существующую
    assert conn.machines[machine_id]["aliases"] == []
    row = conn.candidates["c1"]
    assert row["status"] == "matched"
    assert row["matched_machine_id"] == machine_id
    assert 0.6 <= row["confidence"] < 1.0


def test_unresolvable_vendor_and_no_specs_is_rejected():
    conn = FakeConn()
    raw = {"vendor": "Custom", "model": "Generic Klipper Printer"}
    conn.seed_candidate("c1", source="slicer_profile", raw=raw)

    counters = run.run_once(conn)

    assert counters == {"merged_update": 0, "merged_insert": 0, "matched": 0, "rejected": 1}
    assert conn.machines == {}
    assert conn.candidates["c1"]["status"] == "rejected"


def test_candidate_missing_vendor_or_model_fields_is_rejected():
    conn = FakeConn()
    conn.seed_candidate("c1", source="vendor_whitelist", raw={"price": {"amount": 10}})

    counters = run.run_once(conn)

    assert counters["rejected"] == 1
    assert conn.candidates["c1"]["status"] == "rejected"


def test_catalog_owned_candidate_is_not_claimed_by_scout():
    """Namespace-изоляция (MF-1517): `cura-definitions` — Catalog namespace
    (docs/epics/domain.model.md § «Ownership contract», `catalog.v1`), Scout
    не имеет права его claim-ить/резолвить, даже если `raw` в catalog-форме
    (`vendor`/`model`) технически парсится тем же generic-дистпатчем
    (`normalize.extract_vendor_and_model`) — форма данных не разрешение."""
    conn = FakeConn()
    conn.seed_vendor("creality", "Creality")
    conn.seed_candidate("catalog-owned", source="cura-definitions", raw=_K1_MAX_RAW)
    conn.seed_candidate("scout-owned", source="slicer_profile", raw=_K1_MAX_RAW)

    counters = run.run_once(conn)

    assert counters == {"merged_update": 0, "merged_insert": 1, "matched": 0, "rejected": 0}
    catalog_row = conn.candidates["catalog-owned"]
    assert catalog_row["status"] == "pending"  # нетронут — не claim-ился вовсе
    assert catalog_row["matched_machine_id"] is None
    scout_row = conn.candidates["scout-owned"]
    assert scout_row["status"] == "merged"
    assert len(conn.machines) == 1  # ровно одна машина — от scout-owned кандидата


def test_unmapped_owner_candidate_is_not_claimed_by_scout():
    """Ещё не размеченный namespace (`owner is null`, `source_owner_unmapped`
    в терминах домен-документа) — тоже не claimable ни одним резолвером, не
    только Catalog-owned."""
    conn = FakeConn()
    conn.seed_candidate("unmapped", source="unknown-future-source", raw=_K1_MAX_RAW)

    counters = run.run_once(conn)

    assert counters == {"merged_update": 0, "merged_insert": 0, "matched": 0, "rejected": 0}
    assert conn.candidates["unmapped"]["status"] == "pending"


def test_claim_and_resolve_emit_audit_events(caplog):
    """Acceptance MF-1517: audit-событие содержит owner/source/status transition
    и (для отказа) причину — `machine_candidate.audit.v1` (`resolver/audit.py`)."""
    conn = FakeConn()
    conn.seed_candidate("c1", source="slicer_profile", raw={"vendor": "Custom", "model": "x"})

    with caplog.at_level("INFO", logger="scout.audit"):
        run.run_once(conn)

    events = [json.loads(r.getMessage()) for r in caplog.records if r.name == "scout.audit"]
    assert len(events) == 2  # claim_acquired + status_transition
    claimed, transitioned = events
    assert claimed["event"] == "machine_candidate.audit.v1"
    assert claimed["kind"] == "claim_acquired"
    assert claimed["owner"] == "scout"
    assert claimed["source"] == "slicer_profile"
    assert claimed["candidate_id"] == "c1"
    assert transitioned["kind"] == "status_transition"
    assert transitioned["from_status"] == "pending"
    assert transitioned["to_status"] == "rejected"
    assert transitioned["reason"] == "rejected"
    assert transitioned["correlation_id"] == claimed["correlation_id"]


def test_rerun_after_resolution_is_a_noop_idempotent():
    conn = FakeConn()
    vendor_id = conn.seed_vendor("creality", "Creality")
    conn.seed_machine(vendor_id=vendor_id, model="Creality Ender-3 V2")
    conn.seed_candidate(
        "c1", source="slicer_profile", raw={"vendor": "Creality", "model": "Creality Ender-3 V2"}
    )

    first = run.run_once(conn)
    machines_after_first = len(conn.machines)
    second = run.run_once(conn)

    assert first == {"merged_update": 1, "merged_insert": 0, "matched": 0, "rejected": 0}
    assert second == {"merged_update": 0, "merged_insert": 0, "matched": 0, "rejected": 0}
    assert len(conn.machines) == machines_after_first  # второй прогон канон не изменил


def test_two_candidates_resolving_to_same_content_hash_reuse_one_machine():
    """Дефенс-в-глубину: даже если два pending-кандидата независимо решают
    вставить один и тот же (vendor, model, specs), `machines_content_hash_uidx`
    не даёт завести дубль-строку — второй insert возвращает id первой (см.
    `db.insert_machine` докстринг)."""
    conn = FakeConn()
    conn.seed_vendor("creality", "Creality")
    conn.seed_candidate("c1", source="slicer_profile", raw=_K1_MAX_RAW)
    conn.seed_candidate("c2", source="vendor_whitelist", raw=_K1_MAX_RAW)

    run.run_once(conn)

    assert len(conn.machines) == 1
    c1, c2 = conn.candidates["c1"], conn.candidates["c2"]
    assert c1["matched_machine_id"] == c2["matched_machine_id"]


def test_failing_candidate_is_marked_rejected_and_does_not_block_the_queue(monkeypatch):
    conn = FakeConn()
    vendor_id = conn.seed_vendor("creality", "Creality")
    conn.seed_machine(vendor_id=vendor_id, model="Creality Ender-3 V2")
    ender_raw = {"vendor": "Creality", "model": "Creality Ender-3 V2"}
    conn.seed_candidate("bad", source="slicer_profile", raw=ender_raw)
    conn.seed_candidate("good", source="slicer_profile", raw=ender_raw)

    real_resolve = run.resolve_candidate

    def _boom(conn_, candidate):
        if candidate.id == "bad":
            raise RuntimeError("boom")
        return real_resolve(conn_, candidate)

    monkeypatch.setattr(run, "resolve_candidate", _boom)

    counters = run.run_once(conn)

    assert conn.candidates["bad"]["status"] == "rejected"
    assert conn.candidates["good"]["status"] == "merged"
    assert counters["rejected"] == 1
    assert counters["merged_update"] == 1
