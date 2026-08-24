"""Воркер apps/scout: периодический прогон всех `VENDOR_PROFILES` (MF-623).

В отличие от mesh/giga воркер здесь не клеймит строки БД `for update skip
locked` — эта карта только продюсер (пишет `machine_candidates`/
`release_events`), консьюмерской очереди пока нет (см. докстринг `scout.db`).
Поллинг здесь — пауза между полными прогонами по таймеру
(`SCOUT_POLL_INTERVAL_SECONDS`), не клейм отдельной строки задания.
"""

from __future__ import annotations

import logging
import signal
import time

import psycopg

from .config import WorkerConfig, load_worker_config
from .sources.vendor_whitelist import VENDOR_PROFILES, ingest_profile

logger = logging.getLogger("scout.worker")


def run_once(config: WorkerConfig) -> None:
    """Один полный прогон всех источников. Сбой одного вендора не должен
    ронять остальные (тот же принцип, что `vendor_whitelist.scan_profile`
    применяет на уровне отдельной карточки товара)."""
    with psycopg.connect(config.database_url) as conn:
        for profile in VENDOR_PROFILES:
            try:
                counters = ingest_profile(conn, profile)
                logger.info("%s: %s", profile.vendor_slug, counters)
            except Exception as exc:  # noqa: BLE001 — сбой вендора не должен ронять прогон
                logger.exception("%s: прогон упал: %s", profile.vendor_slug, exc)


def run_loop() -> None:
    """Бесконечный цикл: прогон всех источников, сон, повтор. Без DATABASE_URL
    — простаивает, не падает (тот же паттерн, что `mesh.worker.run_loop`)."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    worker_config = load_worker_config()
    if worker_config is None:
        logger.warning("воркер простаивает: DATABASE_URL не сконфигурирован")
        _sleep_until_signal()
        return

    stop = _install_signal_handler()
    logger.info(
        "воркер запущен: poll=%.0fs источников=%d",
        worker_config.poll_interval_seconds,
        len(VENDOR_PROFILES),
    )

    while not stop["flag"]:
        try:
            run_once(worker_config)
        except Exception as exc:  # noqa: BLE001 — сбой тика не должен ронять цикл
            logger.exception("тик воркера упал: %s", exc)
        _sleep_with_early_exit(worker_config.poll_interval_seconds, stop)
    logger.info("воркер остановлен по сигналу")


def _sleep_with_early_exit(seconds: float, stop: dict) -> None:
    """Спит короткими интервалами, чтобы SIGTERM (от systemd) подхватывался
    быстро, а не через весь час дефолтного poll_interval_seconds."""
    remaining = seconds
    while remaining > 0 and not stop["flag"]:
        time.sleep(min(1.0, remaining))
        remaining -= 1.0


def _install_signal_handler() -> dict:
    stop = {"flag": False}

    def _handler(_signum, _frame):
        stop["flag"] = True

    signal.signal(signal.SIGTERM, _handler)
    signal.signal(signal.SIGINT, _handler)
    return stop


def _sleep_until_signal() -> None:
    stop = _install_signal_handler()
    while not stop["flag"]:
        time.sleep(1)


if __name__ == "__main__":
    run_loop()
