"""Юнит-тесты CLI `scout.sources.run` — без сети/БД, `scan_profile`/`ingest_profile`
подменены."""

from __future__ import annotations

from scout.sources import run
from scout.sources.vendor_whitelist import VENDOR_PROFILES


def test_select_profiles_all_by_default():
    assert run._select_profiles(None) == VENDOR_PROFILES


def test_select_profiles_filters_by_vendor_slug():
    slug = VENDOR_PROFILES[0].vendor_slug
    assert run._select_profiles(slug) == [VENDOR_PROFILES[0]]


def test_select_profiles_unknown_vendor_returns_none():
    assert run._select_profiles("unknown-vendor") is None


def test_main_without_database_url_does_not_connect(monkeypatch, capsys):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(
        "sys.argv", ["scout-vendor-whitelist-agent"]
    )
    connected = []
    monkeypatch.setattr("scout.sources.run.psycopg.connect", lambda url: connected.append(url))

    run.main()

    assert connected == []


def test_main_dry_run_uses_scan_profile_not_ingest(monkeypatch):
    monkeypatch.setattr("sys.argv", ["scout-vendor-whitelist-agent", "--dry-run"])
    scanned = []
    ingested = []

    def _fake_scan(profile, limit):
        scanned.append(profile.vendor_slug)
        return []

    def _fake_ingest(conn, profile, limit):
        ingested.append(profile.vendor_slug)

    monkeypatch.setattr("scout.sources.run.vw.scan_profile", _fake_scan)
    monkeypatch.setattr("scout.sources.run.vw.ingest_profile", _fake_ingest)

    run.main()

    assert scanned == [p.vendor_slug for p in VENDOR_PROFILES]
    assert ingested == []
