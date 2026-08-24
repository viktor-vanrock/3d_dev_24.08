from mesh.config import load_s3_config, load_worker_config


def test_s3_config_none_without_creds(monkeypatch):
    for var in ("S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY"):
        monkeypatch.delenv(var, raising=False)
    assert load_s3_config() is None


def test_s3_config_defaults(monkeypatch):
    monkeypatch.setenv("S3_ENDPOINT", "https://s3.cloud.ru")
    monkeypatch.setenv("S3_ACCESS_KEY", "ak")
    monkeypatch.setenv("S3_SECRET_KEY", "sk")
    monkeypatch.delenv("S3_REGION", raising=False)
    monkeypatch.delenv("S3_BUCKET_MODELS", raising=False)

    cfg = load_s3_config()

    assert cfg is not None
    assert cfg.region == "ru-central-1"
    assert cfg.bucket_models == "3mf"
    assert cfg.access_key == "ak"


def test_worker_config_none_without_database_url(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert load_worker_config() is None


def test_worker_config_from_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgres://portal:portal@localhost:5432/portal")
    monkeypatch.setenv("MESH_POLL_INTERVAL_SECONDS", "2.5")
    cfg = load_worker_config()
    assert cfg is not None
    assert cfg.poll_interval_seconds == 2.5
    assert cfg.revision_worker_enabled is False


def test_revision_worker_requires_explicit_enable(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgres://portal:portal@localhost:5432/portal")
    monkeypatch.setenv("MESH_REVISION_WORKER_ENABLED", "1")

    cfg = load_worker_config()

    assert cfg is not None
    assert cfg.revision_worker_enabled is True
    assert cfg.max_attempts == 3
    assert cfg.heartbeat_interval_seconds <= cfg.lease_seconds / 3


def test_slice_lifecycle_requires_explicit_enable(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgres://portal:portal@localhost:5432/portal")
    monkeypatch.setenv("MESH_SLICE_LIFECYCLE_ENABLED", "1")

    cfg = load_worker_config()

    assert cfg is not None
    assert cfg.slice_lifecycle_enabled is True
    assert cfg.slice_max_attempts == 3
    assert cfg.slice_heartbeat_interval_seconds <= cfg.slice_lease_seconds / 3
