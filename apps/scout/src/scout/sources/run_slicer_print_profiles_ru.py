"""CLI ручного прогона источника slicer_print_profiles_ru (MF-411, шаг 3
фазы 1 эпика MF-34, RU-специфика). В отличие от остальных `run_slicer_*`
CLI — сети не требует (курируемая статическая таблица, не фетч GitHub);
единственная зависимость — `Generic PLA`/`Generic PETG`/`Generic ABS` уже
должны лежать в `slicer_profiles` (прогнать `scout-slicer-print-profiles-agent`
раньше).

Запуск: `uv run scout-slicer-print-profiles-ru-agent`. Опции: `--dry-run`
(только резолвит `Generic *` базы и печатает счётчики — `build_candidates`
ничего не пишет, см. докстринг `slicer_print_profiles_ru.py`). env:
`DATABASE_URL` (обязателен, читается в обоих режимах — резолву кандидатов
нужна БД, отдельного сетевого источника для превью здесь нет).
"""

from __future__ import annotations

import argparse
import logging
import os

import psycopg

from . import slicer_print_profiles_ru as sppr

logger = logging.getLogger("scout.sources.slicer_print_profiles_ru_agent")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    args = _parse_args()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.warning("DATABASE_URL не сконфигурирован — прогон пропущен")
        return

    conn = psycopg.connect(database_url)
    try:
        if args.dry_run:
            candidates, counters = sppr.build_candidates(conn)
            logger.info("[dry-run] ru filament estimates: %s", counters)
            for candidate in candidates:
                logger.info(
                    "[dry-run] %s | extrapolated_from=%s",
                    candidate.external_ref, candidate.extrapolated_from_id,
                )
            return

        counters = sppr.ingest(conn)
        logger.info("ru filament estimates: %s", counters)
    finally:
        conn.close()


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Прогон slicer_print_profiles_ru → slicer_profile_candidates/slicer_profiles"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="посчитать, откатить транзакцию (не коммитить)"
    )
    return parser.parse_args()


if __name__ == "__main__":
    main()
