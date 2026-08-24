"""CLI-агент наполнения календаря релизов (MF-644): fetch → LLM-extract →
матчинг → идемпотентный upsert в `release_events`.

Запуск (dev-стенд, сеть нужна для fetch): `uv run giga-calendar-agent`.
Опции: `--dry-run` (распарсить и посчитать, не писать в БД), `--source <id>`
(ограничиться одним источником из `sources.py`), `--limit N` (статей на
источник — для быстрой проверки). env: `DATABASE_URL`, `GIGACHAT_CREDENTIALS`
(обяз., иначе — no-op с warn).

Лог прогона (найдено/принято/отклонено/добавлено/обновлено/без изменений) —
паттерн `apps/api/scripts/import-machines-bootstrap.ts`.
"""

from __future__ import annotations

import argparse
import logging
import os

import psycopg

from .. import gigachat_client
from . import db
from .extract import ExtractionError, extract_events
from .fetch import fetch_articles
from .sources import SOURCES, get_source

logger = logging.getLogger("giga.calendar")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    args = _parse_args()

    client = gigachat_client.load_client()
    if client is None:
        logger.warning(
            "GIGACHAT_CREDENTIALS не сконфигурирован — экстракция невозможна, прогон пропущен"
        )
        return

    database_url = os.getenv("DATABASE_URL")
    if not database_url and not args.dry_run:
        logger.warning("DATABASE_URL не сконфигурирован — прогон пропущен")
        return

    if args.source:
        source = get_source(args.source)
        if source is None:
            logger.error("источник %r не найден в sources.py", args.source)
            return
        sources = [source]
    else:
        sources = SOURCES

    conn = None if args.dry_run else psycopg.connect(database_url)
    try:
        _run(conn, sources, client, dry_run=args.dry_run, limit=args.limit)
    finally:
        if conn is not None:
            conn.close()


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Наполнение календаря релизов (release_events)")
    parser.add_argument(
        "--dry-run", action="store_true", help="распарсить и посчитать, не писать в БД"
    )
    parser.add_argument("--source", help="ограничиться одним источником по id (см. sources.py)")
    parser.add_argument("--limit", type=int, default=20, help="статей на источник")
    return parser.parse_args()


def _run(conn, sources, client, *, dry_run: bool, limit: int) -> None:
    found = candidates = accepted = rejected = inserted = updated = unchanged = errors = 0

    for source in sources:
        try:
            articles = fetch_articles(source, limit=limit)
        except Exception as exc:  # noqa: BLE001 — сбой одного источника не должен ронять прогон
            logger.error("источник %s: fetch упал: %s", source.id, exc)
            errors += 1
            continue
        found += len(articles)

        for article in articles:
            try:
                result = extract_events(client, article)
            except ExtractionError as exc:
                logger.warning("статья %s: экстракция упала: %s", article.url, exc)
                errors += 1
                continue

            candidates += result.raw_count
            accepted += len(result.events)
            rejected += result.rejected_count

            for event in result.events:
                if dry_run:
                    logger.info(
                        "[dry-run] %s | %s | %s | %s",
                        source.vendor_slug,
                        event.model_name,
                        event.status,
                        event.source_url,
                    )
                    continue
                vendor_id = db.get_or_create_vendor(conn, source.vendor_slug, source.vendor_name)
                machine_id = db.find_machine_id(conn, vendor_id, event.model_name)
                outcome = db.upsert_release_event(
                    conn,
                    vendor_id=vendor_id,
                    machine_id=machine_id,
                    model_name=event.model_name,
                    status=event.status,
                    dates={
                        "announced_at": event.announced_at,
                        "preorder_at": event.preorder_at,
                        "ship_at": event.ship_at,
                        "eol_at": event.eol_at,
                    },
                    source_url=event.source_url,
                )
                if outcome == "inserted":
                    inserted += 1
                elif outcome == "updated":
                    updated += 1
                else:
                    unchanged += 1

    logger.info(
        "прогон завершён: источников=%d статей=%d кандидатов=%d принято=%d отклонено=%d "
        "добавлено=%d%s обновлено=%d без_изменений=%d ошибок=%d",
        len(sources),
        found,
        candidates,
        accepted,
        rejected,
        inserted,
        " (dry-run)" if dry_run else "",
        updated,
        unchanged,
        errors,
    )


if __name__ == "__main__":
    main()
