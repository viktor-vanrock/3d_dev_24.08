"""CLI ручного прогона источника slicer_print_profiles (MF-411, шаг 2 эпика
MF-34). Паттерн — `scout.sources.run_slicer_profiles`.

Запуск (сеть нужна для фетча GitHub): `uv run scout-slicer-print-profiles-agent`.
Опции: `--dry-run` (посчитать, не писать в БД); `--vendor <name>` (ограничиться
одним вендором, повторяемый флаг — удобно для инкрементальных прогонов на
большом наборе). env: `DATABASE_URL` (обязателен, если не `--dry-run`);
`GITHUB_TOKEN` (опционален — поднимает лимит `api.github.com` с 60/ч).
"""

from __future__ import annotations

import argparse
import logging
import os

import httpx
import psycopg

from . import slicer_print_profiles as spp

logger = logging.getLogger("scout.sources.slicer_print_profiles_agent")


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
            counters = spp.ingest(conn, client, vendors)
            logger.info("orcaslicer print profiles: %s", counters)
        finally:
            conn.close()


def _run_dry(client: httpx.Client, vendors: list[str] | None) -> None:
    candidates = spp.fetch_all_candidates(client, vendors)
    logger.info("[dry-run] найдено %d профилей (process+filament)", len(candidates))
    by_class: dict[str, int] = {}
    for candidate in candidates:
        by_class[candidate.profile_class] = by_class.get(candidate.profile_class, 0) + 1
    logger.info("[dry-run] по классам: %s", by_class)
    for candidate in candidates[:5]:
        logger.info(
            "[dry-run] %s | %s | %s | inherits=%s",
            candidate.profile_class,
            candidate.external_ref,
            candidate.setting_id,
            candidate.inherits,
        )


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Прогон slicer_print_profiles → slicer_profile_candidates/slicer_profiles"
    )
    parser.add_argument("--dry-run", action="store_true", help="посчитать, не писать в БД")
    parser.add_argument(
        "--vendor",
        action="append",
        help="ограничиться одним вендором (флаг повторяем); по умолчанию — все вендоры OrcaSlicer",
    )
    return parser.parse_args()


if __name__ == "__main__":
    main()
