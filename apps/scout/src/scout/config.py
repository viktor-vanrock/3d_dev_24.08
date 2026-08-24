"""Конфигурация окружения для `apps/scout` (паттерн — apps/mesh/src/mesh/config.py).

Секреты — только из env (никогда в git). Без `DATABASE_URL` воркер не падает:
логирует, что БД не сконфигурирована, и простаивает — HTTP-часть (/health)
продолжает жить. Имя переменной совпадает с `apps/api` (.env.example).
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class WorkerConfig:
    database_url: str
    poll_interval_seconds: float


def load_worker_config() -> WorkerConfig | None:
    """Собирает конфиг воркера. None, если нет DATABASE_URL.

    Дефолт интервала (час) выше, чем у mesh/giga (5с): те поллят живую
    очередь задач в своей БД, scout между прогонами обходит внешние сайты
    вендоров — частый обход не нужен и невежлив к источнику.
    """
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        return None
    return WorkerConfig(
        database_url=database_url,
        poll_interval_seconds=float(os.getenv("SCOUT_POLL_INTERVAL_SECONDS", "3600")),
    )
