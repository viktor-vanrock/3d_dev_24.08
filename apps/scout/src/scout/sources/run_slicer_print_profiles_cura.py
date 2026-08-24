"""CLI ручного прогона источника slicer_print_profiles_cura (MF-411, шаг 3
фазы 1 эпика MF-34, часть Cura — последний хвост шага 3). Паттерн —
`scout.sources.run_slicer_print_profiles_prusa`.

Запуск (сеть нужна для фетча GitHub): `uv run scout-slicer-print-profiles-cura-agent`.
Опции: `--dry-run` (посчитать, не писать в БД); `--skip-quality`/`--skip-materials`
(источник читает два независимых репозитория — `Ultimaker/Cura` для quality-тиров
и `Ultimaker/fdm_materials` для материалов, каждый можно исключить отдельно, напр.
для быстрого повторного прогона только материалов). env: `DATABASE_URL`
(обязателен, если не `--dry-run`); `GITHUB_TOKEN` (опционален).
"""

from __future__ import annotations

import argparse
import logging
import os

import httpx
import psycopg

from . import slicer_print_profiles_cura as sppc

logger = logging.getLogger("scout.sources.slicer_print_profiles_cura_agent")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    args = _parse_args()
    quality = not args.skip_quality
    materials = not args.skip_materials

    with httpx.Client() as client:
        if args.dry_run:
            _run_dry(client, quality, materials)
            return

        database_url = os.getenv("DATABASE_URL")
        if not database_url:
            logger.warning("DATABASE_URL не сконфигурирован — прогон пропущен")
            return

        conn = psycopg.connect(database_url)
        try:
            counters = sppc.ingest(conn, client, quality=quality, materials=materials)
            logger.info("cura print profiles: %s", counters)
        finally:
            conn.close()


def _run_dry(client: httpx.Client, quality: bool, materials: bool) -> None:
    candidates = sppc.fetch_all_candidates(client, quality=quality, materials=materials)
    logger.info("[dry-run] найдено %d профилей (process+filament)", len(candidates))
    by_class: dict[str, int] = {}
    for candidate in candidates:
        by_class[candidate.profile_class] = by_class.get(candidate.profile_class, 0) + 1
    logger.info("[dry-run] по классам: %s", by_class)
    for candidate in candidates[:5]:
        logger.info(
            "[dry-run] %s | %s | setting_id=%s",
            candidate.profile_class,
            candidate.external_ref,
            candidate.setting_id,
        )


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Прогон slicer_print_profiles_cura → slicer_profile_candidates/slicer_profiles"
    )
    parser.add_argument("--dry-run", action="store_true", help="посчитать, не писать в БД")
    parser.add_argument(
        "--skip-quality", action="store_true", help="не тащить Ultimaker/Cura quality-тиры"
    )
    parser.add_argument(
        "--skip-materials", action="store_true", help="не тащить Ultimaker/fdm_materials"
    )
    return parser.parse_args()


if __name__ == "__main__":
    main()
