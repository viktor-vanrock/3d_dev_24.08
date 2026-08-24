"""Юнит-тесты `scout.worker.run_once` на фейковом psycopg.connect/ingest_profile —
без реального Postgres/сети. run_loop (бесконечный цикл) здесь не тестируется —
тот же выбор, что apps/mesh и apps/giga делают для своих run_loop.
"""

from __future__ import annotations

from scout import worker
from scout.config import WorkerConfig
from scout.sources.vendor_whitelist import VENDOR_PROFILES


class _DummyConn:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def test_run_once_ingests_every_configured_profile(monkeypatch):
    monkeypatch.setattr("scout.worker.psycopg.connect", lambda url: _DummyConn())
    calls = []
    monkeypatch.setattr(
        "scout.worker.ingest_profile",
        lambda conn, profile: calls.append(profile.vendor_slug) or {"found": 0},
    )

    worker.run_once(WorkerConfig(database_url="postgres://x", poll_interval_seconds=1))

    assert calls == [p.vendor_slug for p in VENDOR_PROFILES]


def test_run_once_one_profile_failure_does_not_stop_the_others(monkeypatch):
    monkeypatch.setattr("scout.worker.psycopg.connect", lambda url: _DummyConn())
    monkeypatch.setattr(
        "scout.worker.VENDOR_PROFILES",
        [
            *VENDOR_PROFILES,
            VENDOR_PROFILES[0].__class__(
                vendor_slug="broken-vendor",
                vendor_name="Broken Vendor",
                listing_url="https://example.invalid/",
                product_link_re=VENDOR_PROFILES[0].product_link_re,
            ),
        ],
    )
    calls = []

    def _fake_ingest(conn, profile):
        if profile.vendor_slug == "broken-vendor":
            raise RuntimeError("сеть недоступна")
        calls.append(profile.vendor_slug)
        return {"found": 0}

    monkeypatch.setattr("scout.worker.ingest_profile", _fake_ingest)

    worker.run_once(WorkerConfig(database_url="postgres://x", poll_interval_seconds=1))

    assert calls == [p.vendor_slug for p in VENDOR_PROFILES]
