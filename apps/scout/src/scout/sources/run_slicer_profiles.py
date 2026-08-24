"""CLI ручного прогона источника slicer_profiles (MF-627) + RU-принтеров (MF-1803),
паттерн — `scout.sources.run`.

Запуск (сеть нужна для фетча GitHub, `ru_printers` — курируемые данные, сети не
требует): `uv run scout-slicer-profiles-agent`. Опции: `--dry-run` (посчитать, не
писать в БД), `--source {orca,prusa,ru_printers,all}` (дефолт `all`). env:
`DATABASE_URL` (обязателен, если не `--dry-run`); `GITHUB_TOKEN` (опционален —
поднимает лимит `api.github.com` с 60/ч, `ru_printers` его не использует).
"""

from __future__ import annotations

import argparse
import logging
import os

import httpx
import psycopg

from . import slicer_profiles as sp

logger = logging.getLogger("scout.sources.slicer_profiles_agent")

_FETCHERS = {
    "orca": sp.fetch_orca_candidates,
    "prusa": sp.fetch_prusa_candidates,
    "ru_printers": lambda _client: sp.fetch_ru_printer_candidates(),
}
_INGESTERS = {
    "orca": sp.ingest_orca,
    "prusa": sp.ingest_prusa,
    "ru_printers": lambda conn, _client: sp.ingest_ru_printers(conn),
}


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    args = _parse_args()
    sources = list(_FETCHERS) if args.source == "all" else [args.source]

    with httpx.Client() as client:
        if args.dry_run:
            _run_dry(sources, client)
            return

        database_url = os.getenv("DATABASE_URL")
        if not database_url:
            logger.warning("DATABASE_URL не сконфигурирован — прогон пропущен")
            return

        conn = psycopg.connect(database_url)
        try:
            for source in sources:
                counters = _INGESTERS[source](conn, client)
                logger.info("%s: %s", source, counters)
        finally:
            conn.close()


def _run_dry(sources: list[str], client: httpx.Client) -> None:
    for source in sources:
        candidates = _FETCHERS[source](client)
        logger.info("[dry-run] %s: найдено %d", source, len(candidates))
        for candidate in candidates[:5]:
            logger.info(
                "[dry-run] %s | %s | %s",
                source,
                candidate.raw.get("model"),
                candidate.external_ref,
            )


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Прогон slicer_profiles → machine_candidates")
    parser.add_argument(
        "--dry-run", action="store_true", help="посчитать, не писать в БД"
    )
    parser.add_argument(
        "--source",
        choices=["orca", "prusa", "ru_printers", "all"],
        default="all",
        help="ограничиться одним источником",
    )
    return parser.parse_args()


if __name__ == "__main__":
    main()
