"""CLI ручного прогона источника slicer_print_profiles_prusa (MF-411, шаг 3
фазы 1 эпика MF-34, часть Prusa). Паттерн — `scout.sources.run_slicer_print_profiles`
(OrcaSlicer, шаг 2).

Запуск (сеть нужна для фетча GitHub): `uv run scout-slicer-print-profiles-prusa-agent`.
Опции: `--dry-run` (посчитать, не писать в БД); `--vendor <dir>` (ограничиться
одним vendor-каталогом бандла, повторяемый флаг; по умолчанию — только
`PrusaResearch`, единственный реальный источник в этом репозитории, см.
докстринг `slicer_profiles.py`). env: `DATABASE_URL` (обязателен, если не
`--dry-run`); `GITHUB_TOKEN` (опционален).
"""

from __future__ import annotations

import argparse
import logging
import os

import httpx
import psycopg

from . import slicer_print_profiles_prusa as sppp

logger = logging.getLogger("scout.sources.slicer_print_profiles_prusa_agent")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    args = _parse_args()
    vendors = args.vendor or None

    with httpx.Client() as client:
        if args.dry_run:
            _run_dry(client, vendors)
            return

        database_url = os.getenv("DATABASE_URL")
        if not database_url:
            logger.warning("DATABASE_URL не сконфигурирован — прогон пропущен")
            return

        conn = psycopg.connect(database_url)
        try:
            counters = sppp.ingest(conn, client, vendors)
            logger.info("prusaslicer print profiles: %s", counters)
        finally:
            conn.close()


def _run_dry(client: httpx.Client, vendors: list[str] | None) -> None:
    candidates = sppp.fetch_all_candidates(client, vendors)
    logger.info("[dry-run] найдено %d профилей (process+filament)", len(candidates))
    by_class: dict[str, int] = {}
    for candidate in candidates:
        by_class[candidate.profile_class] = by_class.get(candidate.profile_class, 0) + 1
    logger.info("[dry-run] по классам: %s", by_class)
    for candidate in candidates[:5]:
        logger.info(
            "[dry-run] %s | %s | inherits=%s | instantiable=%s",
            candidate.profile_class,
            candidate.external_ref,
            candidate.inherits,
            candidate.instantiable,
        )


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Прогон slicer_print_profiles_prusa → slicer_profile_candidates/slicer_profiles"
    )
    parser.add_argument("--dry-run", action="store_true", help="посчитать, не писать в БД")
    parser.add_argument(
        "--vendor",
        action="append",
        help="ограничиться одним vendor-каталогом бандла (флаг повторяем); "
        "по умолчанию — PrusaResearch",
    )
    return parser.parse_args()


if __name__ == "__main__":
    main()
