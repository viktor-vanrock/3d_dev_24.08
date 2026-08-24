from scout.config import load_worker_config


def test_worker_config_none_without_database_url(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert load_worker_config() is None


def test_worker_config_defaults(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgres://portal:portal@localhost:5432/portal")
    monkeypatch.delenv("SCOUT_POLL_INTERVAL_SECONDS", raising=False)

    cfg = load_worker_config()

    assert cfg is not None
    assert cfg.poll_interval_seconds == 3600.0


def test_worker_config_from_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgres://portal:portal@localhost:5432/portal")
    monkeypatch.setenv("SCOUT_POLL_INTERVAL_SECONDS", "120")

    cfg = load_worker_config()

    assert cfg is not None
    assert cfg.poll_interval_seconds == 120.0
