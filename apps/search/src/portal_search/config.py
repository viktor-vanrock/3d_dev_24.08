"""Конфигурация окружения `apps/search` (паттерн — apps/giga/src/giga/config.py).

Секреты — только из env. Без кредов сервис не падает: воркер простаивает и
логирует, что не хватает — тот же паттерн, что giga/mesh. `HYPERPC_URL` —
единственный источник Tailscale-адреса HYPERPC (100.74.48.83:8189 на момент
написания, см. docs/process/hyperpc.local.llm.md): захардкоженного IP в коде
нет — браузер/фронт никогда не должен его узнать (MF-1996 канон продукта),
а смена машины/порта не требует правки кода, только env на VDS.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class HyperpcConfig:
    base_url: str
    timeout_seconds: float
    max_retries: int
    retry_backoff_seconds: float


@dataclass(frozen=True)
class WorkerConfig:
    database_url: str
    poll_interval_seconds: float
    lease_seconds: int
    worker_id: str
    max_attempts: int
    lifecycle_enabled: bool = False
    heartbeat_interval_seconds: float = 30.0
    shutdown_grace_seconds: float = 30.0


@dataclass(frozen=True)
class S3Config:
    endpoint: str
    region: str
    access_key: str
    secret_key: str
    bucket_models: str


def load_hyperpc_config() -> HyperpcConfig | None:
    """Собирает конфиг клиента HYPERPC. `None`, если `HYPERPC_URL` не задан.

    Без URL lifecycle entrypoint работает fail-closed и не забирает джобы.
    """
    base_url = os.getenv("HYPERPC_URL")
    if not base_url:
        return None
    return HyperpcConfig(
        base_url=base_url.rstrip("/"),
        timeout_seconds=float(os.getenv("HYPERPC_TIMEOUT_SECONDS", "10")),
        max_retries=int(os.getenv("HYPERPC_MAX_RETRIES", "2")),
        retry_backoff_seconds=float(os.getenv("HYPERPC_RETRY_BACKOFF_SECONDS", "0.5")),
    )


def load_worker_config() -> WorkerConfig | None:
    """Собирает конфиг воркера индексации. `None`, если нет `DATABASE_URL`."""
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        return None
    return WorkerConfig(
        database_url=database_url,
        poll_interval_seconds=float(os.getenv("SEARCH_POLL_INTERVAL_SECONDS", "5")),
        lease_seconds=int(os.getenv("SEARCH_INDEX_LEASE_SECONDS", "120")),
        worker_id=os.getenv("SEARCH_WORKER_ID") or f"search-worker-{os.getpid()}",
        max_attempts=int(os.getenv("SEARCH_INDEX_MAX_ATTEMPTS", "5")),
        lifecycle_enabled=os.getenv("SEARCH_LIFECYCLE_ENABLED") == "1",
        heartbeat_interval_seconds=float(
            os.getenv("SEARCH_HEARTBEAT_INTERVAL_SECONDS", "30")
        ),
        shutdown_grace_seconds=float(
            os.getenv("SEARCH_SHUTDOWN_GRACE_SECONDS", "30")
        ),
    )


def load_s3_config() -> S3Config | None:
    """Собирает S3-конфиг для чтения `model_files` (геометрия под multi-view рендер).

    `None`, если не хватает обязательных полей — воркер не падает, как и без
    `DATABASE_URL`/`HYPERPC_URL` (см. `bootstrap.py`). Те же имена переменных, что
    `apps/mesh`/`apps/api` (общий сервисный аккаунт cloud.ru, docs/infra/readme.md
    § `portal.mesh-worker-dev`) — отдельного набора кредов под `apps/search` не заводим.
    """
    endpoint = os.getenv("S3_ENDPOINT")
    access_key = os.getenv("S3_ACCESS_KEY")
    secret_key = os.getenv("S3_SECRET_KEY")
    if not endpoint or not access_key or not secret_key:
        return None
    return S3Config(
        endpoint=endpoint,
        region=os.getenv("S3_REGION", "ru-central-1"),
        access_key=access_key,
        secret_key=secret_key,
        bucket_models=os.getenv("S3_BUCKET_MODELS", "3mf"),
    )
