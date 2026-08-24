"""CLI ручного прогона источника vendor_whitelist (MF-623), паттерн —
`giga.calendar.run`.

Запуск (dev-стенд, сеть нужна для fetch): `uv run scout-vendor-whitelist-agent`.
Опции: `--dry-run` (распарсить и посчитать, не писать в БД), `--vendor <slug>`
(один профиль из `vendor_whitelist.VENDOR_PROFILES`), `--limit N` (карточек
товара на вендора — для быстрой проверки). env: `DATABASE_URL` (обяз., если
не `--dry-run`).
"""

from __future__ import annotations

import argparse
import logging
import os

import psycopg

from . import vendor_whitelist as vw

logger = logging.getLogger("scout.sources.vendor_whitelist_agent")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    args = _parse_args()

    profiles = _select_profiles(args.vendor)
    if profiles is None:
        return

    if args.dry_run:
        _run_dry(profiles, limit=args.limit)
        return

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.warning("DATABASE_URL не сконфигурирован — прогон пропущен")
        return

    conn = psycopg.connect(database_url)
    try:
        for profile in profiles:
            counters = vw.ingest_profile(conn, profile, limit=args.limit)
            logger.info("%s: %s", profile.vendor_slug, counters)
    finally:
        conn.close()


def _select_profiles(vendor_slug: str | None) -> list[vw.VendorProfile] | None:
    if vendor_slug is None:
        return vw.VENDOR_PROFILES
    profiles = [p for p in vw.VENDOR_PROFILES if p.vendor_slug == vendor_slug]
    if not profiles:
        logger.error("вендор %r не найден в vendor_whitelist.VENDOR_PROFILES", vendor_slug)
        return None
    return profiles


def _run_dry(profiles: list[vw.VendorProfile], *, limit: int) -> None:
    for profile in profiles:
        candidates = vw.scan_profile(profile, limit=limit)
        for candidate in candidates:
            logger.info(
                "[dry-run] %s | %s | %s",
                profile.vendor_slug,
                candidate.raw["model_name"],
                candidate.source_url,
            )
        logger.info("[dry-run] %s: найдено %d", profile.vendor_slug, len(candidates))


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Прогон vendor_whitelist → machine_candidates")
    parser.add_argument(
        "--dry-run", action="store_true", help="распарсить и посчитать, не писать в БД"
    )
    parser.add_argument("--vendor", help="ограничиться одним вендором по slug")
    parser.add_argument("--limit", type=int, default=50, help="карточек товара на вендора")
    return parser.parse_args()


if __name__ == "__main__":
    main()
