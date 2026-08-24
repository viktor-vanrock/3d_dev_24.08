"""Конфигурация окружения для `apps/giga` (паттерн — apps/mesh/src/mesh/config.py).

Секреты — только из env (никогда в git). Без кредов сервис не падает: воркер
логирует, что S3/БД не сконфигурированы, и простаивает — HTTP-часть (/health,
/generations) продолжает жить. Имена переменных совпадают с `apps/api`
(.env.example): `giga` использует тот же `DATABASE_URL`, что и остальной портал.
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
    bucket_generations: str
    bucket_diagnostics: str


@dataclass(frozen=True)
class WorkerConfig:
    database_url: str
    poll_interval_seconds: float
    lifecycle_enabled: bool = False
    max_attempts: int = 3
    lease_seconds: int = 300
    heartbeat_interval_seconds: float = 60.0
    shutdown_grace_seconds: float = 60.0


def load_s3_config() -> S3Config | None:
    """Собирает S3-конфиг из env. None, если не хватает обязательных полей.

    Обязательны endpoint + креды; region/bucket имеют дефолты (cloud.ru,
    отдельные от `3mf` бакеты `generations`/`diagnostics`).
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
        bucket_generations=os.getenv("S3_BUCKET_GENERATIONS", "generations"),
        bucket_diagnostics=os.getenv("S3_BUCKET_DIAGNOSTICS", "diagnostics"),
    )


def load_worker_config() -> WorkerConfig | None:
    """Собирает конфиг воркера. None, если нет DATABASE_URL."""
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        return None
    return WorkerConfig(
        database_url=database_url,
        poll_interval_seconds=float(os.getenv("GIGA_POLL_INTERVAL_SECONDS", "5")),
        lifecycle_enabled=os.getenv("GIGA_LIFECYCLE_ENABLED") == "1",
        max_attempts=int(os.getenv("GIGA_MAX_ATTEMPTS", "3")),
        lease_seconds=int(os.getenv("GIGA_LEASE_SECONDS", "300")),
        heartbeat_interval_seconds=float(
            os.getenv("GIGA_HEARTBEAT_INTERVAL_SECONDS", "60")
        ),
        shutdown_grace_seconds=float(os.getenv("GIGA_SHUTDOWN_GRACE_SECONDS", "60")),
    )
