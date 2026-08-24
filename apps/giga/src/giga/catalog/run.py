"""CLI-агент наполнения каталога станков со свободного HTML (MF-649): fetch →
LLM-extract → идемпотентный upsert в `machine_candidates` + аудит-лог в
`ingest_runs` (`db.py`). Источники — те же вендор-ньюсрумы, что уже гоняет
`giga.calendar` (`giga.calendar.sources.SOURCES`/`fetch_articles`): один и тот
же текст статьи параллельно проверяется двумя промптами (событие релиза vs.
характеристики станка) — это та переиспользуемость источника, которую сама
карточка MF-649 предполагала ("питает и эту карточку, и будущий календарь
релизов MF-407").

Запуск (dev-стенд, сеть нужна для fetch): `uv run giga-catalog-agent`.
Опции: `--dry-run` (распарсить и посчитать, не писать в БД), `--source <id>`
(ограничиться одним источником из `giga.calendar.sources`), `--limit N`
(статей на источник — для быстрой проверки). env: `DATABASE_URL`,
`GIGACHAT_CREDENTIALS` (обяз., иначе — no-op с warn, тот же паттерн, что
`giga.calendar.run`).

Лог прогона (найдено/принято/отклонено/добавлено/обновлено/без изменений) —
паттерн `giga.calendar.run`/`apps/api/scripts/import-machines-bootstrap.ts`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import re
from datetime import UTC, datetime

import psycopg

from .. import gigachat_client
from ..calendar.fetch import fetch_articles
from ..calendar.sources import SOURCES, get_source
from . import db
from .extract import ExtractedMachine, ExtractionError, extract_machine_candidates

logger = logging.getLogger("giga.catalog")

SOURCE_ID = "giga-free-html"
_SLUG_RE = re.compile(r"[^a-z0-9]+")


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
            logger.error("источник %r не найден в giga.calendar.sources", args.source)
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
    parser = argparse.ArgumentParser(
        description="Наполнение каталога станков (machine_candidates) со свободного HTML"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="распарсить и посчитать, не писать в БД"
    )
    parser.add_argument(
        "--source", help="ограничиться одним источником по id (см. giga.calendar.sources)"
    )
    parser.add_argument("--limit", type=int, default=20, help="статей на источник")
    return parser.parse_args()


def _slug(text: str) -> str:
    return _SLUG_RE.sub("-", text.lower()).strip("-")


def _content_hash(machine: ExtractedMachine) -> bytes:
    canonical = json.dumps(
        {"vendor": machine.vendor, "model": machine.model, "specs": machine.specs},
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(canonical.encode("utf-8")).digest()


def _run(conn, sources, client, *, dry_run: bool, limit: int) -> None:
    started_at = datetime.now(UTC)
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
                result = extract_machine_candidates(client, article)
            except ExtractionError as exc:
                logger.warning("статья %s: экстракция упала: %s", article.url, exc)
                errors += 1
                continue

            candidates += result.raw_count
            accepted += len(result.machines)
            rejected += result.rejected_count

            for machine in result.machines:
                external_ref = f"{article.url}#{_slug(machine.vendor)}-{_slug(machine.model)}"
                if dry_run:
                    logger.info(
                        "[dry-run] %s | %s %s | confidence=%.2f | %s",
                        source.id,
                        machine.vendor,
                        machine.model,
                        machine.confidence,
                        machine.source_url,
                    )
                    continue
                outcome = db.upsert_machine_candidate(
                    conn,
                    source=SOURCE_ID,
                    source_url=machine.source_url,
                    external_ref=external_ref,
                    raw={"vendor": machine.vendor, "model": machine.model, "specs": machine.specs},
                    content_hash=_content_hash(machine),
                    confidence=machine.confidence,
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

    if not dry_run:
        db.record_ingest_run(
            conn,
            source=SOURCE_ID,
            started_at=started_at,
            found=accepted,
            changed=inserted + updated,
            rejected=rejected,
            error=None,
        )


if __name__ == "__main__":
    main()
