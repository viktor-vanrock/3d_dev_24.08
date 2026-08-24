"""CLI ручного прогона источника spoolman (MF-721), паттерн — `scout.sources.run_slicer_profiles`.

Запуск (сеть нужна для фетча GitHub): `uv run scout-spoolman-agent`.
Опции: `--dry-run` (посчитать, не писать в БД). env: `DATABASE_URL`
(обязателен, если не `--dry-run`); `GITHUB_TOKEN` (опционален — поднимает
лимит `api.github.com` с 60/ч).
"""

from __future__ import annotations

import argparse
import logging
import os

import httpx
import psycopg

from . import spoolman as sm

logger = logging.getLogger("scout.sources.spoolman_agent")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    args = _parse_args()

    with httpx.Client() as client:
        if args.dry_run:
            _run_dry(client)
            return

        database_url = os.getenv("DATABASE_URL")
        if not database_url:
            logger.warning("DATABASE_URL не сконфигурирован — прогон пропущен")
            return

        conn = psycopg.connect(database_url)
        try:
            counters = sm.ingest(conn, client)
            logger.info("spoolman: %s", counters)
        finally:
            conn.close()


def _run_dry(client: httpx.Client) -> None:
    candidates = sm.fetch_candidates(client)
    logger.info("[dry-run] spoolman: найдено %d", len(candidates))
    for candidate in candidates[:5]:
        logger.info(
            "[dry-run] %s | %s",
            candidate.raw.get("manufacturer"),
            candidate.external_ref,
        )


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Прогон spoolman → material_candidates")
    parser.add_argument("--dry-run", action="store_true", help="посчитать, не писать в БД")
    return parser.parse_args()


if __name__ == "__main__":
    main()
