"""Конфигурация окружения воркера assistant-run (паттерн — `giga.config`,
отдельный модуль, а не расширение общего `giga.config`: эти env-переменные
специфичны очереди `assistant_runs`, роднить с `WorkerConfig` генераций
(другая очередь, другой lease-профиль) не нужно)."""

from __future__ import annotations

import os
from dataclasses import dataclass

# `lease_seconds` должен покрывать худший случай HYPERPC-таймаутов
# (`HYPERPC_TIMEOUT_SECONDS * (HYPERPC_MAX_RETRIES + 1)`, см. `hyperpc_client`)
# с запасом — иначе следующий тик воркера перезаберёт ряд, который другой
# процесс ещё честно обрабатывает. Дефолт 60с считает от дефолтов
# hyperpc_client (20с * 3 попытки = 60с) + запас; операторы с другим
# HYPERPC_TIMEOUT_SECONDS/HYPERPC_MAX_RETRIES должны поднять и это значение.
_DEFAULT_LEASE_SECONDS = 90.0


@dataclass(frozen=True)
class AssistantWorkerConfig:
    database_url: str
    poll_interval_seconds: float
    lease_seconds: float
    evidence_limit: int
    max_response_tokens: int
    lifecycle_enabled: bool = False
    max_attempts: int = 3
    heartbeat_interval_seconds: float = 20.0
    shutdown_grace_seconds: float = 30.0


def load_assistant_worker_config() -> AssistantWorkerConfig | None:
    """`None`, если нет `DATABASE_URL` — воркер простаивает, не падает
    (тот же паттерн, что `giga.config.load_worker_config`)."""
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        return None
    return AssistantWorkerConfig(
        database_url=database_url,
        poll_interval_seconds=float(os.getenv("ASSISTANT_POLL_INTERVAL_SECONDS", "5")),
        lease_seconds=float(os.getenv("ASSISTANT_LEASE_SECONDS", str(_DEFAULT_LEASE_SECONDS))),
        evidence_limit=int(os.getenv("ASSISTANT_EVIDENCE_LIMIT", "6")),
        max_response_tokens=int(os.getenv("ASSISTANT_MAX_RESPONSE_TOKENS", "800")),
        lifecycle_enabled=os.getenv("ASSISTANT_LIFECYCLE_ENABLED") == "1",
        max_attempts=int(os.getenv("ASSISTANT_MAX_ATTEMPTS", "3")),
        heartbeat_interval_seconds=float(
            os.getenv("ASSISTANT_HEARTBEAT_INTERVAL_SECONDS", "20")
        ),
        shutdown_grace_seconds=float(
            os.getenv("ASSISTANT_SHUTDOWN_GRACE_SECONDS", "30")
        ),
    )
