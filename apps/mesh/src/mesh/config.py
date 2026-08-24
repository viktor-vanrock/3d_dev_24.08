"""Конфигурация окружения для `apps/mesh`.

Секреты — только из env (никогда в git). Без кредов сервис не падает:
воркер логирует, что S3/БД не сконфигурированы, и простаивает — так HTTP-часть
(/health) продолжает жить, пока Cloud.ru-агент не выдаст сервисный аккаунт
(см. MF-454/MF-455). Имена переменных совпадают с `apps/api` (.env.example).
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class S3Config:
    endpoint: str
    region: str
    access_key: str
    secret_key: str
    bucket_models: str


@dataclass(frozen=True)
class WorkerConfig:
    database_url: str
    poll_interval_seconds: float
    revision_worker_enabled: bool = False
    max_attempts: int = 3
    lease_seconds: int = 120
    heartbeat_interval_seconds: float = 30.0
    shutdown_grace_seconds: float = 30.0
    slice_lifecycle_enabled: bool = False
    slice_max_attempts: int = 3
    slice_lease_seconds: int = 300
    slice_heartbeat_interval_seconds: float = 60.0
    slice_shutdown_grace_seconds: float = 60.0


def load_s3_config() -> S3Config | None:
    """Собирает S3-конфиг из env. None, если не хватает обязательных полей.

    Обязательны endpoint + креды; region/bucket имеют дефолты (cloud.ru, `3mf`).
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


def load_worker_config() -> WorkerConfig | None:
    """Собирает конфиг воркера. None, если нет DATABASE_URL."""
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        return None
    return WorkerConfig(
        database_url=database_url,
        poll_interval_seconds=float(os.getenv("MESH_POLL_INTERVAL_SECONDS", "5")),
        revision_worker_enabled=os.getenv("MESH_REVISION_WORKER_ENABLED") == "1",
        max_attempts=int(os.getenv("MESH_MAX_ATTEMPTS", "3")),
        lease_seconds=int(os.getenv("MESH_LEASE_SECONDS", "120")),
        heartbeat_interval_seconds=float(
            os.getenv("MESH_HEARTBEAT_INTERVAL_SECONDS", "30")
        ),
        shutdown_grace_seconds=float(os.getenv("MESH_SHUTDOWN_GRACE_SECONDS", "30")),
        slice_lifecycle_enabled=os.getenv("MESH_SLICE_LIFECYCLE_ENABLED") == "1",
        slice_max_attempts=int(os.getenv("MESH_SLICE_MAX_ATTEMPTS", "3")),
        slice_lease_seconds=int(os.getenv("MESH_SLICE_LEASE_SECONDS", "300")),
        slice_heartbeat_interval_seconds=float(
            os.getenv("MESH_SLICE_HEARTBEAT_INTERVAL_SECONDS", "60")
        ),
        slice_shutdown_grace_seconds=float(
            os.getenv("MESH_SLICE_SHUTDOWN_GRACE_SECONDS", "60")
        ),
    )
