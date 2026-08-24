from giga.config import load_s3_config, load_worker_config


def test_s3_config_none_without_creds(monkeypatch):
    for var in ("S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY"):
        monkeypatch.delenv(var, raising=False)
    assert load_s3_config() is None


def test_s3_config_defaults(monkeypatch):
    monkeypatch.setenv("S3_ENDPOINT", "https://s3.cloud.ru")
    monkeypatch.setenv("S3_ACCESS_KEY", "ak")
    monkeypatch.setenv("S3_SECRET_KEY", "sk")
    monkeypatch.delenv("S3_REGION", raising=False)
    monkeypatch.delenv("S3_BUCKET_GENERATIONS", raising=False)

    cfg = load_s3_config()

    assert cfg is not None
    assert cfg.region == "ru-central-1"
    assert cfg.bucket_generations == "generations"
    assert cfg.access_key == "ak"


def test_worker_config_none_without_database_url(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert load_worker_config() is None


def test_worker_config_from_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgres://portal:portal@localhost:5432/portal")
    monkeypatch.setenv("GIGA_POLL_INTERVAL_SECONDS", "2.5")
    cfg = load_worker_config()
    assert cfg is not None
    assert cfg.poll_interval_seconds == 2.5
    assert cfg.lifecycle_enabled is False


def test_generation_lifecycle_requires_explicit_enable(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgres://portal:portal@localhost:5432/portal")
    monkeypatch.setenv("GIGA_LIFECYCLE_ENABLED", "1")

    cfg = load_worker_config()

    assert cfg is not None
    assert cfg.lifecycle_enabled is True
    assert cfg.max_attempts == 3
    assert cfg.heartbeat_interval_seconds <= cfg.lease_seconds / 3
